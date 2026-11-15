import { randomBytes } from 'node:crypto'
import type { OrcaWorkerApi } from 'orca/worker'
import type { Draft, Mail } from './protocol'
import { validateDraft } from './mail'

const ROOT = 'https://graph.microsoft.com/v1.0/me'
const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const SCOPES = 'offline_access User.Read Mail.ReadWrite Mail.Send'
export function graphMessage(m: any): Mail {
 const addr = (r: any) => r?.emailAddress?.name ? `${r.emailAddress.name} <${r.emailAddress.address}>` : r?.emailAddress?.address || ''
 return { id: m.id, threadId: m.id, subject: m.subject || '(Без темы)', from: addr(m.from), to: (m.toRecipients || []).map(addr).join(', '), date: m.receivedDateTime || m.sentDateTime || '', snippet: m.bodyPreview || '', labels: [...(!m.isRead ? ['UNREAD'] : []), ...(m.flag?.flagStatus === 'flagged' ? ['STARRED'] : []), ...(m.isDraft ? ['DRAFT'] : [])], body: m.body?.content?.slice(0, 100000), messageId: m.internetMessageId, replyTo: (m.replyTo || []).map(addr).join(', '), webUrl: m.webLink }
}
export default function activate(orca: OrcaWorkerApi) {
 let timer: ReturnType<typeof setTimeout> | undefined; let generation = 0; let auth = ''; let error = ''; let refreshing: Promise<any> | undefined
 const tickets = new Map<string, { draft: Draft; expires: number }>()
 const stop = () => { generation++; if (timer) clearTimeout(timer); timer = undefined }
 async function secret(key: string) { const s = await orca.secrets.get(key); return s ? JSON.parse(s) : null }
 async function request(url: string, init: RequestInit = {}) {
  let response: Response
  try { response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) }) } catch { throw new Error('Microsoft не отвечает. При отправке проверьте «Отправленные» перед повтором.') }
  const data = response.status === 204 || response.status === 202 ? {} : await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error('Microsoft API: ' + response.status + '. Проверьте вход и разрешения приложения.'), { code: data.error?.code || data.error })
  return data
 }
 async function token() {
  const t = await secret('token'); if (!t) throw new Error('Сначала войдите в Microsoft.')
  if (t.expires > Date.now() + 60000) return t.access_token
  if (!refreshing) refreshing = (async () => {
   const epoch = generation; const c = await secret('client')
   const n = await request(AUTH + '/token', { method: 'POST', body: new URLSearchParams({ client_id: c.clientId, refresh_token: t.refresh_token, grant_type: 'refresh_token', scope: SCOPES }) })
   if (epoch !== generation) throw new Error('Подключение изменилось.')
   await orca.secrets.set('token', JSON.stringify({ ...t, ...n, expires: Date.now() + n.expires_in * 1000 })); return n.access_token
  })().finally(() => { refreshing = undefined })
  return refreshing
 }
 async function api(path: string, method = 'GET', body?: unknown, plain = true) {
  return request(ROOT + path, { method, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...(plain ? { Prefer: 'outlook.body-content-type="text"' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
 }
 const id = (s: string) => { if (typeof s !== 'string' || !s || s.length > 2000) throw new Error('Неверный ID.'); return encodeURIComponent(s) }
 const payload = (d: Draft) => ({ subject: d.subject, body: { contentType: 'Text', content: d.body }, toRecipients: d.to.trim() ? d.to.split(',').map(address => ({ emailAddress: { address: address.trim() } })) : [] })
 orca.panels.handle('status', async () => { const t = await secret('token'); return { connected: !!t, configured: !!await secret('client'), email: t?.email || '', auth, error } })
 orca.panels.handle('configure', async ({ json }) => {
  const c = JSON.parse(json); if (!/^[0-9a-f-]{36}$/i.test(c.clientId)) throw new Error('Укажите Application (client) ID своего Microsoft-приложения.')
  if ((await orca.host.call('secrets.protection')).status !== 'os-keyring') throw new Error('Защищённое хранилище недоступно.')
  stop(); tickets.clear(); await orca.secrets.delete('token'); await orca.secrets.set('client', JSON.stringify({ clientId: c.clientId })); error = ''; auth = ''; return { ok: true }
 })
 orca.panels.handle('auth.start', async () => {
  const c = await secret('client'); if (!c) throw new Error('Сначала укажите Microsoft Client ID.')
  stop(); const epoch = generation; error = ''; auth = 'waiting'
  const device = await request(AUTH + '/devicecode', { method: 'POST', body: new URLSearchParams({ client_id: c.clientId, scope: SCOPES }) })
  const expires = Date.now() + device.expires_in * 1000; let interval = Math.max(5, device.interval || 5) * 1000
  async function poll() {
   if (epoch !== generation) return
   try {
    if (Date.now() >= expires) throw new Error('Время входа истекло.')
    const t = await request(AUTH + '/token', { method: 'POST', body: new URLSearchParams({ client_id: c.clientId, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device.device_code }) })
    const profile = await request(ROOT + '?$select=mail,userPrincipalName', { headers: { Authorization: `Bearer ${t.access_token}` } })
    if (epoch !== generation) return
    if (!t.refresh_token) throw new Error('Microsoft не предоставил offline_access.')
    await orca.secrets.set('token', JSON.stringify({ ...t, email: profile.mail || profile.userPrincipalName, expires: Date.now() + t.expires_in * 1000 })); auth = 'done'; orca.panels.post('auth.changed', { state: auth })
   } catch (e) {
    if (epoch !== generation) return
    const code = (e as any).code
    if (code === 'authorization_pending' || code === 'slow_down') { if (code === 'slow_down') interval += 5000; timer = setTimeout(poll, interval); timer.unref(); return }
    auth = 'error'; error = (e as Error).message; orca.panels.post('auth.changed', { state: auth })
   }
  }
  timer = setTimeout(poll, interval); timer.unref()
  return { url: device.verification_uri, code: device.user_code }
 })
 orca.panels.handle('auth.cancel', async () => { stop(); auth = ''; return { ok: true } })
 orca.panels.handle('disconnect', async () => { stop(); tickets.clear(); await orca.secrets.delete('token'); await orca.secrets.delete('client'); auth = ''; error = ''; return { ok: true } })
 orca.panels.handle('mail.list', async ({ q, page }) => {
  let path = '/messages'; let rest = q; const filters: string[] = []
  for (const [term, name] of [['in:inbox', 'inbox'], ['in:sent', 'sentitems'], ['in:drafts', 'drafts']] as const) if (rest.includes(term)) { path = `/mailFolders/${name}/messages`; rest = rest.replace(term, '') }
  rest = rest.replace('-in:trash', '').replace('-in:spam', '')
  if (rest.includes('is:unread')) { filters.push('isRead eq false'); rest = rest.replace('is:unread', '') }
  if (rest.includes('is:starred')) { filters.push("flag/flagStatus eq 'flagged'"); rest = rest.replace('is:starred', '') }
  if (rest.includes('has:attachment')) { filters.push('hasAttachments eq true'); rest = rest.replace('has:attachment', '') }
  rest = rest.replace(/newer_than:(\d+)d/g, (_: string, days: string) => { filters.unshift(`receivedDateTime ge ${new Date(Date.now() - Number(days) * 86400000).toISOString()}`); return '' }).trim()
  const params = new URLSearchParams({ '$top': '15', '$select': 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,isDraft,flag,internetMessageId,webLink' })
  if (rest && filters.length) throw new Error('Outlook: используйте текстовый поиск отдельно от фильтров статуса и даты.')
  if (rest) params.set('$search', '"' + rest.replace(/["\\]/g, '') + '"')
  else if (filters.length) params.set('$filter', filters.join(' and '))
  else params.set('$orderby', 'receivedDateTime desc')
  let url = path + '?' + params
  if (page) { const next = new URL(page); if (next.origin !== 'https://graph.microsoft.com' || !next.pathname.startsWith('/v1.0/me/')) throw new Error('Неверная страница Outlook.'); url = next.pathname.slice('/v1.0/me'.length) + next.search }
  const result = await api(url)
  return { messages: (result.value || []).map((m: any) => { const mail = graphMessage(m); if (path.includes('/inbox/')) mail.labels.push('INBOX'); return mail }), next: result['@odata.nextLink'] || '' }
 })
 orca.panels.handle('mail.get', async ({ id: messageId }) => graphMessage(await api('/messages/' + id(messageId))))
 orca.panels.handle('mail.modify', async ({ id: messageId, add, remove }) => {
  if ([...add, ...remove].some(x => !['INBOX', 'UNREAD', 'STARRED'].includes(x))) throw new Error('Неподдерживаемая метка.')
  const patch: any = {}; if (add.includes('UNREAD')) patch.isRead = false; if (remove.includes('UNREAD')) patch.isRead = true
  if (add.includes('STARRED')) patch.flag = { flagStatus: 'flagged' }; if (remove.includes('STARRED')) patch.flag = { flagStatus: 'notFlagged' }
  if (Object.keys(patch).length) await api('/messages/' + id(messageId), 'PATCH', patch)
  if (remove.includes('INBOX') || add.includes('INBOX')) await api('/messages/' + id(messageId) + '/move', 'POST', { destinationId: add.includes('INBOX') ? 'inbox' : 'archive' })
  return { ok: true }
 })
 orca.panels.handle('draft.open', async ({ messageId }) => {
  const m = await api('/messages/' + id(messageId), 'GET', undefined, false); const mail = graphMessage(m)
  if (!m.isDraft || m.body?.contentType?.toLowerCase() === 'html' || m.hasAttachments || m.ccRecipients?.length || m.bccRecipients?.length || (m.body?.content || '').length > 100000) throw new Error('Откройте этот черновик в Outlook, чтобы сохранить форматирование, вложения и все поля.')
  return { to: (m.toRecipients || []).map((x: any) => x.emailAddress.address).join(', '), subject: m.subject || '', body: mail.body || '', draftId: m.id }
 })
 async function save(d: Draft) {
  validateDraft(d, true)
  if (d.draftId) { const prior = await api('/messages/' + id(d.draftId) + '?$select=isDraft'); if (!prior.isDraft) throw new Error('Это не черновик.'); return api('/messages/' + id(d.draftId), 'PATCH', payload(d)) }
  if (d.threadId) { const reply = await api('/messages/' + id(d.threadId) + '/createReply', 'POST', {}); return api('/messages/' + id(reply.id), 'PATCH', payload(d)) }
  return api('/messages', 'POST', payload(d))
 }
 orca.panels.handle('draft.save', async d => ({ id: (await save(d)).id }))
 orca.panels.handle('draft.review', async d => { validateDraft(d); const ticket = randomBytes(24).toString('hex'); tickets.clear(); tickets.set(ticket, { draft: { ...d }, expires: Date.now() + 300000 }); return { ticket } })
 orca.panels.handle('draft.send', async ({ ticket }) => {
  const entry = tickets.get(ticket); tickets.delete(ticket); if (!entry || entry.expires < Date.now()) throw new Error('Предпросмотр истёк.')
  validateDraft(entry.draft); const m = await save(entry.draft); await api('/messages/' + id(m.id) + '/send', 'POST'); return { id: m.id }
 })
 return stop
}
