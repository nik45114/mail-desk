import type { ImapFlow } from 'imapflow'
import { randomBytes } from 'node:crypto'
import type { OrcaWorkerApi } from 'orca/worker'
import type { Mail, Draft } from './protocol'
import { rawMail, validateDraft } from './mail'

export interface ImapConfig { email: string; password: string; host: string; port: number; smtpHost: string; smtpPort: number }
export function validateImap(c: ImapConfig) {
 if (!c || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(c.email) || !c.password || c.password.length > 2048) throw new Error('Укажите email и пароль приложения.')
 for (const host of [c.host, c.smtpHost]) if (typeof host !== 'string' || !/^[a-zA-Z0-9.-]{1,253}$/.test(host)) throw new Error('Укажите имя сервера без протокола и пути.')
 if (Number(c.port) !== 993 || ![465, 587].includes(Number(c.smtpPort))) throw new Error('Поддерживаются IMAP TLS 993 и SMTP TLS 465 / STARTTLS 587.')
}
export function imapQuery(q: string) {
 const search: any = { deleted: false }; let folder = 'INBOX'; const words: string[] = []
 for (const part of q.match(/(?:[^\s"]+|"[^"]*")+/g) || []) {
  if (part === 'in:inbox') folder = 'INBOX'
  else if (part === 'in:sent') folder = '\\Sent'
  else if (part === 'in:drafts') folder = '\\Drafts'
  else if (part === 'is:unread') search.seen = false
  else if (part === 'is:starred') search.flagged = true
  else if (part.startsWith('from:')) search.from = part.slice(5).replace(/"/g, '')
  else if (part.startsWith('subject:')) search.subject = part.slice(8).replace(/"/g, '')
  else if (/^newer_than:\d+d$/.test(part)) search.since = new Date(Date.now() - Number(part.slice(11, -1)) * 86400000)
  else if (part.includes(':')) throw new Error('IMAP: доступны in:inbox, in:sent, in:drafts, is:unread, is:starred, from:, subject:, newer_than:7d и обычный текст.')
  else words.push(part.replace(/"/g, ''))
 }
 if (words.length) search.text = words.join(' ')
 return { folder, search }
}
const encodeId = (folder: string, validity: string, uid: number) => Buffer.from(JSON.stringify([folder, validity, uid])).toString('base64url')
export function decodeId(value: string): [string, string, number] {
 let parsed: any
 try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) } catch { throw new Error('Неверный ID письма.') }
 if (!Array.isArray(parsed) || parsed.length !== 3 || typeof parsed[0] !== 'string' || parsed[0].length > 1000 || !/^\d+$/.test(parsed[1]) || !Number.isSafeInteger(parsed[2]) || parsed[2] < 1) throw new Error('Неверный ID письма.')
 return parsed as [string, string, number]
}
export default function activate(orca: OrcaWorkerApi) {
 const tickets = new Map<string, { draft: Draft; expires: number }>()
 async function config(): Promise<ImapConfig> { const s = await orca.secrets.get('client'); if (!s) throw new Error('Сначала подключите IMAP.'); return JSON.parse(s) }
 async function connect(c: ImapConfig, fn: (client: ImapFlow) => Promise<any>) {
  const { ImapFlow } = await import('imapflow')
  const client = new ImapFlow({ host: c.host, port: Number(c.port), secure: true, auth: { user: c.email, pass: c.password }, logger: false, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000, disableAutoIdle: true, tls: { rejectUnauthorized: true } })
  client.on('error', () => {})
  try { await client.connect(); return await fn(client) }
  finally { await client.logout().catch(() => client.close()) }
 }
 async function withClient(fn: (client: ImapFlow) => Promise<any>) { try { return await connect(await config(), fn) } catch (e) { if ((e as any).code || (e as any).authenticationFailed || (e as any).response) throw new Error('Ошибка подключения IMAP. Проверьте сервер, доступ IMAP и пароль приложения.'); throw e } }
 async function folder(c: ImapFlow, name: string) {
  if (name === 'INBOX') return name
  const found = (await c.list()).find(box => box.specialUse === name)
  if (!found) throw new Error('Сервер не сообщил системную папку ' + name + '. Настройте её в веб-почте.')
  return found.path
 }
 async function selected(c: ImapFlow, key: string, fn: (uid: number, path: string) => Promise<any>) {
  const [path, version, uid] = decodeId(key); const lock = await c.getMailboxLock(path)
  try { if (!c.mailbox || String(c.mailbox.uidValidity) !== version) throw new Error('Папка изменилась. Обновите список.'); return await fn(uid, path) } finally { lock.release() }
 }
 function summary(m: any, path: string, version: string): Mail {
  const flags = m.flags as Set<string>; const e = m.envelope || {}
  const addresses = (a: any[]) => (a || []).map(x => x.name ? `${x.name} <${x.address}>` : x.address).join(', ')
  const id = encodeId(path, version, m.uid)
  return { id, threadId: id, subject: e.subject || '(Без темы)', from: addresses(e.from), to: addresses(e.to), date: e.date?.toISOString() || '', snippet: '', labels: [...(!flags.has('\\Seen') ? ['UNREAD'] : []), ...(flags.has('\\Flagged') ? ['STARRED'] : []), ...(flags.has('\\Draft') ? ['DRAFT'] : []), ...(path === 'INBOX' ? ['INBOX'] : [])], messageId: e.messageId }
 }
 async function readMail(c: ImapFlow, key: string) {
  return selected(c, key, async (uid, path) => {
   const metadata = await c.fetchOne(uid, { size: true, envelope: true, flags: true }, { uid: true })
   if (!metadata) throw new Error('Письмо не найдено.')
   if ((metadata.size || 0) > 10 * 1024 * 1024) throw new Error('Письмо больше 10 МБ. Откройте его в веб-почте.')
   const full = await c.fetchOne(uid, { source: true }, { uid: true }); if (!full || !full.source) throw new Error('Не удалось прочитать письмо.')
   const { default: PostalMime } = await import('postal-mime')
   const parsed = await PostalMime.parse(full.source, { maxNestingDepth: 30, maxHeadersSize: 262144, maxRfc822NestingDepth: 3 })
   const body = parsed.text || (parsed.html || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ')
   const mail = { ...summary(metadata, path, String(c.mailbox && c.mailbox.uidValidity)), body: body.slice(0, 100000), replyTo: parsed.replyTo?.map(x => 'address' in x ? x.address : '').join(', '), attachments: parsed.attachments.map(a => a.filename || 'attachment') }
   return { mail, parsed, body }
  })
 }
 orca.panels.handle('status', async () => { const c = await orca.secrets.get('client'); return { connected: !!c, configured: !!c, email: c ? JSON.parse(c).email : '', auth: '', error: '' } })
 orca.panels.handle('configure', async ({ json }) => {
  const c = JSON.parse(json); validateImap(c)
  if ((await orca.host.call('secrets.protection')).status !== 'os-keyring') throw new Error('Защищённое хранилище недоступно.')
  try { await connect(c, async () => {}) } catch { throw new Error('Не удалось войти в IMAP. Проверьте сервер, email и пароль приложения.') }
  await orca.secrets.set('client', JSON.stringify(c)); return { ok: true }
 })
 orca.panels.handle('disconnect', async () => { tickets.clear(); await orca.secrets.delete('client'); return { ok: true } })
 orca.panels.handle('auth.cancel', async () => ({ ok: true }))
 orca.panels.handle('mail.list', async ({ q, page }) => withClient(async c => {
  const query = imapQuery(q); const path = await folder(c, query.folder); const lock = await c.getMailboxLock(path)
  try {
   const version = String(c.mailbox && c.mailbox.uidValidity)
   if (page) { const [prevPath, prevVersion, before] = decodeId(page); if (prevPath !== path || prevVersion !== version) throw new Error('Папка изменилась. Обновите список.'); query.search.uid = `1:${before - 1}`; if (before <= 1) return { messages: [], next: '' } }
   const found = await c.search(query.search, { uid: true }); const ids = (Array.isArray(found) ? found : []).sort((a, b) => b - a)
   const batch = ids.slice(0, 15)
   const fetched = batch.length ? await c.fetchAll(batch, { envelope: true, flags: true }, { uid: true }) : []
   return { messages: fetched.sort((a, b) => b.uid - a.uid).map(m => summary(m, path, version)), next: ids.length > 15 ? encodeId(path, version, batch[batch.length - 1]) : '' }
  } finally { lock.release() }
 }))
 orca.panels.handle('mail.get', async ({ id }) => withClient(async c => (await readMail(c, id)).mail))
 orca.panels.handle('mail.modify', async ({ id, add, remove }) => withClient(async c => {
  if ([...add, ...remove].some(x => !['UNREAD', 'STARRED', 'INBOX'].includes(x))) throw new Error('Неподдерживаемая метка.')
  const archive = remove.includes('INBOX') ? await folder(c, '\\Archive') : ''
  return selected(c, id, async uid => {
   for (const [tag, flag, inverted] of [['UNREAD', '\\Seen', true], ['STARRED', '\\Flagged', false]] as const) {
    if (add.includes(tag)) await (inverted ? c.messageFlagsRemove(uid, [flag], { uid: true }) : c.messageFlagsAdd(uid, [flag], { uid: true }))
    if (remove.includes(tag)) await (inverted ? c.messageFlagsAdd(uid, [flag], { uid: true }) : c.messageFlagsRemove(uid, [flag], { uid: true }))
   }
   if (archive) await c.messageMove(uid, archive, { uid: true })
   else if (add.includes('INBOX')) await c.messageMove(uid, 'INBOX', { uid: true })
   return { ok: true }
  })
 }))
 orca.panels.handle('draft.open', async ({ messageId }) => withClient(async c => {
  const { mail, parsed, body } = await readMail(c, messageId)
  if (!mail.labels.includes('DRAFT') || parsed.html || parsed.attachments.length || parsed.cc?.length || parsed.bcc?.length || body.length > 100000) throw new Error('Этот черновик нужно редактировать в веб-почте: форматирование, вложения или неподдерживаемые поля.')
  return { to: parsed.to?.map((x: any) => 'address' in x ? x.address : '').join(', ') || '', subject: parsed.subject || '', body, draftId: messageId, inReplyTo: parsed.inReplyTo }
 }))
 orca.panels.handle('draft.save', async d => withClient(async c => {
  validateDraft(d, true); const cfg = await config(); const path = await folder(c, '\\Drafts')
  if (d.draftId) { const old = await readMail(c, d.draftId); if (!old.mail.labels.includes('DRAFT')) throw new Error('Это не черновик.'); if (decodeId(d.draftId)[0] !== path) throw new Error('Черновик находится в другой папке.') }
  if (!c.capabilities.has('UIDPLUS')) throw new Error('Для сохранения черновиков требуется UIDPLUS. Используйте веб-почту.')
  const raw = Buffer.concat([Buffer.from(`From: ${cfg.email}\r\n`), Buffer.from(rawMail(d, true), 'base64url')])
  const saved = await c.append(path, raw, ['\\Draft', '\\Seen'])
  if (!saved || !saved.uid || !saved.uidValidity) throw new Error('Сервер не вернул ID. Проверьте папку черновиков перед повтором.')
  if (d.draftId) await selected(c, d.draftId, async uid => { await c.messageFlagsAdd(uid, ['\\Deleted'], { uid: true }) }).catch(() => {})
  return { id: encodeId(path, String(saved.uidValidity), saved.uid) }
 }))
 orca.panels.handle('draft.review', async d => { validateDraft(d); const ticket = randomBytes(24).toString('hex'); tickets.clear(); tickets.set(ticket, { draft: { ...d }, expires: Date.now() + 300000 }); return { ticket } })
 orca.panels.handle('draft.send', async ({ ticket }) => {
  const entry = tickets.get(ticket); tickets.delete(ticket); if (!entry || entry.expires < Date.now()) throw new Error('Предпросмотр истёк.')
  const c = await config(); const d = entry.draft; validateDraft(d)
  const { default: nodemailer } = await import('nodemailer')
  const transport = nodemailer.createTransport({ host: c.smtpHost, port: Number(c.smtpPort), secure: Number(c.smtpPort) === 465, requireTLS: true, tls: { rejectUnauthorized: true }, auth: { user: c.email, pass: c.password }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000, logger: false, disableFileAccess: true, disableUrlAccess: true })
  try {
   const result = await transport.sendMail({ envelope: { from: c.email, to: d.to.split(',').map(s => s.trim()) }, raw: Buffer.concat([Buffer.from(`From: ${c.email}\r\n`), Buffer.from(rawMail(d), 'base64url')]) })
   return { id: result.messageId || 'accepted' }
  } catch { throw new Error('SMTP не подтвердил отправку. Проверьте почту перед повтором: письмо могло быть принято сервером.') }
  finally { transport.close() }
 })
}
