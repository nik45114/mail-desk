import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'
import { googleClient } from './google-client'

test('reopens plain drafts and refuses lossy editing of rich drafts', async () => {
 const original = globalThis.fetch; let rich = false
 const host = mockHost({ capabilities: ['secrets:own'], secrets: { token: JSON.stringify({ access_token: 'test', expires: Date.now() + 3600000 }) } })
 globalThis.fetch = (async (url: any) => {
  if (String(url).includes('/drafts?')) return Response.json({ drafts: [{ id: 'd1', message: { id: 'm1' } }] })
  return Response.json({ id: 'd1', message: { id: 'm1', threadId: 't1', payload: { mimeType: rich ? 'multipart/alternative' : 'text/plain', headers: [{ name: 'To', value: 'Person <person@example.com>' }, { name: 'Subject', value: 'Continue' }], body: { data: Buffer.from('Saved text').toString('base64url') } } } })
 }) as typeof fetch
 const worker = await mountWorker(main, { host })
 try {
  const d = await worker.request('draft.open', { messageId: 'm1' })
  assert.equal(d.draftId, 'd1'); assert.equal(d.to, 'person@example.com'); assert.equal(d.body, 'Saved text')
  rich = true; await assert.rejects(() => worker.request('draft.open', { messageId: 'm1' }))
 } finally { globalThis.fetch = original; await worker.deactivate() }
})
test('disconnected worker does not expose tokens; stale send tickets are refused', async () => {
 const host = mockHost({ capabilities: ['secrets:own'] }); const worker = await mountWorker(main, { host })
 assert.deepEqual(await worker.request('status'), { connected: false, configured: !!googleClient, email: '', auth: '', error: '' })
 await assert.rejects(() => worker.request('draft.send', { ticket: 'invented' }))
 const review = await worker.request('draft.review', { to: 'to@example.com', subject: 'Test', body: 'Hello' })
 await assert.rejects(() => worker.request('draft.send', { ticket: review.ticket }))
 await assert.rejects(() => worker.request('draft.send', { ticket: review.ticket }))
 assert.deepEqual(host.data().storage, {}); await worker.deactivate()
})
test('expired token refreshes once; drafts update; failed send never retries', async () => {
 const original = globalThis.fetch; let refreshes = 0; let sends = 0; const calls: string[] = []
 const host = mockHost({ capabilities: ['secrets:own'], secrets: {
  client: JSON.stringify({ client_id: 'test.apps.googleusercontent.com', client_secret: 'test' }),
  token: JSON.stringify({ access_token: 'expired', refresh_token: 'refresh', expires: 0, email: 'me@example.com' })
 } })
 globalThis.fetch = (async (url: any, init: any) => {
  const path = String(url); calls.push(`${init.method || 'GET'} ${path}`)
  if (path.endsWith('/token')) { refreshes++; return Response.json({ access_token: 'fresh', expires_in: 3600 }) }
  assert.equal(init.headers.Authorization, 'Bearer fresh')
  if (path.endsWith('/profile')) return Response.json({ emailAddress: 'me@example.com' })
  if (path.endsWith('/messages/send')) { sends++; throw new Error('connection lost after acceptance') }
  return Response.json({ id: 'draft1' })
 }) as typeof fetch
 const worker = await mountWorker(main, { host })
 try {
  const d = { to: 'to@example.com', subject: 'Тест', body: 'Привет' }
  const saved = await worker.request('draft.save', d)
  await worker.request('draft.save', { ...d, draftId: saved.id, body: 'Правка' })
  assert.equal(refreshes, 1); assert.ok(calls.some(x => x.includes('PUT ') && x.endsWith('/drafts/draft1')))
  const review = await worker.request('draft.review', d)
  await assert.rejects(() => worker.request('draft.send', { ticket: review.ticket }))
  await assert.rejects(() => worker.request('draft.send', { ticket: review.ticket }))
  assert.equal(sends, 1)
  await worker.request('disconnect'); assert.deepEqual(host.data().secrets, {})
 } finally { globalThis.fetch = original; await worker.deactivate() }
})
test('OAuth uses loopback, state and PKCE; bad state is rejected; tokens stay in secrets', async () => {
 const original = globalThis.fetch; let challenge = ''; let exchanges = 0
 const host = mockHost({ capabilities: ['secrets:own'], results: { 'secrets.protection': { status: 'os-keyring' } }, secrets: { client: JSON.stringify({ client_id: 'test.apps.googleusercontent.com', client_secret: 'test' }) } })
 globalThis.fetch = (async (url: any, init: any) => {
  if (String(url).startsWith('http://127.0.0.1:')) return original(url, init)
  if (String(url).endsWith('/token')) {
   exchanges++; const { createHash } = await import('node:crypto')
   assert.equal(createHash('sha256').update(init.body.get('code_verifier')).digest('base64url'), challenge)
   return Response.json({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.modify' })
  }
  return Response.json({ emailAddress: 'me@example.com' })
 }) as typeof fetch
 const worker = await mountWorker(main, { host })
 try {
  const result = await worker.request('auth.start'); const url = new URL(result.url); challenge = url.searchParams.get('code_challenge')!
  assert.equal(url.origin, 'https://accounts.google.com'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  const callback = new URL(url.searchParams.get('redirect_uri')!); callback.searchParams.set('code', 'test-code'); callback.searchParams.set('state', 'bad-state')
  assert.equal((await fetch(callback)).status, 400); assert.equal(exchanges, 0)
  callback.searchParams.set('state', url.searchParams.get('state')!)
  assert.equal((await fetch(callback)).status, 200); assert.equal(exchanges, 1)
  assert.equal((await worker.request('status')).email, 'me@example.com')
  assert.ok(host.data().secrets.token); assert.deepEqual(host.data().storage, {})
 } finally { globalThis.fetch = original; await worker.deactivate() }
})
