import type { OrcaWorkerApi } from 'orca/worker'
import { createServer, type Server } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { parseMail, rawMail, validateDraft } from './mail'
import type { Draft } from './protocol'
import { googleClient } from './google-client'
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
let server: Server | undefined; let timer: ReturnType<typeof setTimeout> | undefined
export function deactivate() { if (timer) clearTimeout(timer); server?.close(); server = undefined }
export default function activate(orca: OrcaWorkerApi) {
 let auth = ''; let error = ''; let refreshTask: Promise<any> | undefined; let epoch = 0
 const tickets = new Map<string, { draft: Draft; expires: number }>()
 async function secret(key: string) { const value = await orca.secrets.get(key); return value ? JSON.parse(value) : null }
 async function client() { return await secret('client') || googleClient }
 async function request(url: string, init: RequestInit = {}) {
  let res: Response
  try { res = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) }) } catch { throw new Error('Нет ответа от Google. Если отправляли письмо, проверьте «Отправленные» перед повтором.') }
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) { const code = data.error?.status || data.error; throw new Error(res.status === 401 || code === 'invalid_grant' ? 'Вход Google истёк. Подключите аккаунт заново.' : `Google API: ${res.status}. Проверьте доступ, Gmail API и лимиты проекта.`) }
  return data
 }
 async function token() {
  const t = await secret('token'); if (!t) throw new Error('Сначала подключите Google.')
  if (t.expires > Date.now() + 60000) return t.access_token
  if (!refreshTask) refreshTask = (async () => {
   const generation = epoch; const c = await client()
   if (!c) throw new Error('Подключение Google ещё не настроено издателем плагина.')
   const n = await request('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }) })
   if (generation !== epoch) throw new Error('Подключение изменилось.')
   await orca.secrets.set('token', JSON.stringify({ ...t, ...n, expires: Date.now() + n.expires_in * 1000 })); return n.access_token
  })().finally(() => { refreshTask = undefined })
  return refreshTask
 }
 async function api(path: string, method = 'GET', body?: unknown) {
  return request(API + path, { method, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
 }
 const id = (value: string) => { if (!/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new Error('Неверный ID письма.'); return value }
 orca.panels.handle('status', async () => { const t = await secret('token'); return { connected: !!t, configured: !!await client(), email: t?.email || '', auth, error } })
 orca.panels.handle('configure', async ({ json }) => {
  const protection = await orca.host.call('secrets.protection'); if (protection.status !== 'os-keyring') throw new Error('Защищённое хранилище ОС недоступно.')
  let c: any; try { c = JSON.parse(json).installed } catch { throw new Error('Нужен JSON OAuth-клиента Google типа Desktop app.') }
  if (!c || typeof c.client_id !== 'string' || !c.client_id.endsWith('.apps.googleusercontent.com') || typeof c.client_secret !== 'string') throw new Error('Нужен JSON OAuth-клиента Google типа Desktop app.')
  epoch++; deactivate(); tickets.clear(); await orca.secrets.delete('token'); await orca.secrets.set('client', JSON.stringify({ client_id: c.client_id, client_secret: c.client_secret })); auth = ''; error = ''; return { ok: true }
 })
 orca.panels.handle('auth.start', async () => {
  const c = await client(); if (!c) throw new Error('Издатель ещё не зарегистрировал подключение Google для этой сборки.')
  const protection = await orca.host.call('secrets.protection'); if (protection.status !== 'os-keyring') throw new Error('Защищённое хранилище ОС недоступно.')
  deactivate(); const generation = ++epoch; tickets.clear(); error = ''; auth = 'waiting'
  const state = randomBytes(32).toString('hex'); const verifier = randomBytes(32).toString('base64url'); let processing = false
  server = createServer(async (req, res) => {
   const u = new URL(req.url || '/', 'http://127.0.0.1')
   res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer')
   if (req.method !== 'GET' || u.pathname !== '/oauth/callback' || u.searchParams.get('state') !== state || processing) { res.writeHead(400); res.end('Invalid callback'); return }
   processing = true
   try {
    if (!u.searchParams.get('code')) throw new Error('Вход отменён в Google.')
    const t = await request('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, code: u.searchParams.get('code')!, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' }) })
    if (!t.refresh_token || !t.scope?.split(' ').includes(SCOPE)) throw new Error('Google не предоставил нужный доступ. Повторите подключение.')
    const profile = await request(API + '/profile', { headers: { Authorization: `Bearer ${t.access_token}` } })
    if (generation !== epoch) throw new Error('Подключение отменено.')
    await orca.secrets.set('token', JSON.stringify({ ...t, email: profile.emailAddress, expires: Date.now() + t.expires_in * 1000 })); auth = 'done'; res.end('Gmail подключён. Можно закрыть эту вкладку и вернуться в Orca.'); orca.panels.post('auth.changed', { state: auth })
   } catch (e) { if (generation === epoch) { error = (e as Error).message; auth = 'error'; orca.panels.post('auth.changed', { state: auth }) }; res.writeHead(400); res.end('Не удалось подключиться. Подробности в панели Orca.') }
   finally { if (generation === epoch) deactivate() }
  })
  await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve) })
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Не удалось открыть локальный вход.')
  const redirect = `http://127.0.0.1:${address.port}/oauth/callback`
  timer = setTimeout(() => { epoch++; auth = 'error'; error = 'Время входа истекло. Начните заново.'; deactivate(); orca.panels.post('auth.changed', { state: auth }) }, 300000); timer.unref()
  const q = new URLSearchParams({ client_id: c.client_id, redirect_uri: redirect, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` }
 })
 orca.panels.handle('auth.cancel', async () => { epoch++; deactivate(); auth = ''; error = ''; orca.panels.post('auth.changed', { state: auth }); return { ok: true } })
 orca.panels.handle('disconnect', async () => { epoch++; deactivate(); tickets.clear(); await orca.secrets.delete('token'); await orca.secrets.delete('client'); auth = ''; error = ''; return { ok: true } })
 orca.panels.handle('mail.list', async ({ q, page }) => {
  const query = new URLSearchParams({ q: String(q).slice(0, 2000), maxResults: '15', ...(page ? { pageToken: page } : {}) }); const result = await api('/messages?' + query)
  const messages = []
  const found = result.messages || []
  for (let offset = 0; offset < found.length; offset += 5) messages.push(...await Promise.all(found.slice(offset, offset + 5).map(async (m: any) => parseMail(await api(`/messages/${id(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)))))
  return { messages, next: result.nextPageToken || '' }
 })
 orca.panels.handle('mail.get', async ({ id: messageId }) => parseMail(await api(`/messages/${id(messageId)}?format=full`), true))
 orca.panels.handle('mail.modify', async ({ id: messageId, add, remove }) => {
  if ([...add, ...remove].some(x => !['INBOX', 'UNREAD', 'STARRED'].includes(x))) throw new Error('Неподдерживаемая метка.')
  await api(`/messages/${id(messageId)}/modify`, 'POST', { addLabelIds: add, removeLabelIds: remove }); return { ok: true }
 })
 orca.panels.handle('draft.open', async ({ messageId }) => {
  id(messageId)
  let page = ''
  do {
   const result = await api('/drafts?' + new URLSearchParams({ maxResults: '100', ...(page ? { pageToken: page } : {}) }))
   const found = (result.drafts || []).find((d: any) => d.message?.id === messageId)
   if (found) {
    const full = await api(`/drafts/${id(found.id)}?format=full`)
    const mail = parseMail(full.message, true)
    if (full.message.payload?.mimeType !== 'text/plain' || mail.attachments?.length || full.message.payload?.headers?.some((h: any) => ['cc', 'bcc'].includes(h.name.toLowerCase()) && h.value)) throw new Error('Этот черновик содержит форматирование, вложения или CC/BCC. Отредактируйте его в Gmail, чтобы сохранить все поля.')
    const to = mail.to.split(',').map(s => s.match(/<([^>]+)>/)?.[1] || s.trim()).join(', ')
    return { to, subject: mail.subject === '(Без темы)' ? '' : mail.subject, body: mail.body || '', draftId: full.id, threadId: mail.threadId, inReplyTo: full.message.payload?.headers?.find((h: any) => h.name.toLowerCase() === 'in-reply-to')?.value }
   }
   page = result.nextPageToken || ''
  } while (page)
  throw new Error('Черновик больше не существует. Обновите список.')
 })
 orca.panels.handle('draft.save', async d => { const message = { raw: rawMail(d, true), ...(d.threadId ? { threadId: id(d.threadId) } : {}) }; const result = await api(d.draftId ? `/drafts/${id(d.draftId)}` : '/drafts', d.draftId ? 'PUT' : 'POST', { message }); return { id: result.id } })
 orca.panels.handle('draft.review', async d => { validateDraft(d); const ticket = randomBytes(24).toString('hex'); tickets.clear(); tickets.set(ticket, { draft: { ...d }, expires: Date.now() + 300000 }); return { ticket } })
 orca.panels.handle('draft.send', async ({ ticket }) => {
  const entry = tickets.get(ticket); tickets.delete(ticket)
  if (!entry || entry.expires < Date.now()) throw new Error('Предпросмотр истёк. Проверьте письмо ещё раз.')
  const d = entry.draft; const message = { raw: rawMail(d), ...(d.threadId ? { threadId: id(d.threadId) } : {}) }
  if (d.draftId) { await api(`/drafts/${id(d.draftId)}`, 'PUT', { message }); return { id: (await api('/drafts/send', 'POST', { id: d.draftId })).id } }
  return { id: (await api('/messages/send', 'POST', message)).id }
 })
}
