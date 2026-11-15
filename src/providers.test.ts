import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as accounts from './accounts'
import { decodeId, imapQuery, validateImap } from './imap'
import { graphMessage } from './outlook'

test('IMAP search translates supported filters and rejects unsupported syntax', () => {
 const q = imapQuery('in:sent from:person@example.com is:unread subject:"Weekly report"')
 assert.equal(q.folder, '\\Sent'); assert.equal(q.search.seen, false); assert.equal(q.search.subject, 'Weekly report')
 assert.throws(() => imapQuery('has:attachment')); assert.throws(() => decodeId('broken'))
 assert.throws(() => validateImap({ email: 'a@example.com', password: 'pw', host: 'imap.example.com', port: 143, smtpHost: 'smtp.example.com', smtpPort: 25 }))
 validateImap({ email: 'a@example.com', password: 'pw', host: 'imap.example.com', port: 993, smtpHost: 'smtp.example.com', smtpPort: 587 })
})

test('Microsoft mapping preserves unread, draft and flagged status', () => {
 const m = graphMessage({ id: 'one', isRead: false, isDraft: true, flag: { flagStatus: 'flagged' }, from: { emailAddress: { address: 'a@example.com' } }, body: { content: 'Hello' } })
 assert.deepEqual(m.labels, ['UNREAD', 'STARRED', 'DRAFT']); assert.equal(m.body, 'Hello')
})

test('accounts preserve legacy Gmail tokens and bind review tickets to their account', async () => {
 const host = mockHost({ capabilities: ['secrets:own'], results: { 'secrets.protection': { status: 'os-keyring' } }, secrets: { token: JSON.stringify({ email: 'original@example.com', access_token: 'original', expires: Date.now() + 3600000 }) } })
 const worker = await mountWorker(accounts, { host })
 try {
  assert.equal((await worker.request('status')).email, 'original@example.com')
  const second = await worker.request('accounts.add', { provider: 'gmail', label: 'Second' })
  assert.equal((await worker.request('status')).connected, false)
  const reviewed = await worker.request('draft.review', { to: 'a@example.com', subject: 'A', body: 'B' })
  await worker.request('accounts.select', { id: 'default' })
  await assert.rejects(() => worker.request('draft.send', { ticket: reviewed.ticket }))
  assert.equal((await worker.request('status')).email, 'original@example.com')
  await worker.request('accounts.select', { id: second.id }); await worker.request('disconnect')
  assert.ok(host.data().secrets.token)
 } finally { await worker.deactivate() }
})

test('explicit mailbox requests do not follow another panel active account', async () => {
 const old = globalThis.fetch; const auth: string[] = []
 const host = mockHost({ capabilities: ['secrets:own'], secrets: {
  'accounts.v1': JSON.stringify([{ id: 'default', label: 'A', provider: 'gmail' }, { id: 'second', label: 'B', provider: 'gmail' }]),
  token: JSON.stringify({ access_token: 'a', expires: Date.now() + 3600000 }),
  'account.second.token': JSON.stringify({ access_token: 'b', expires: Date.now() + 3600000 })
 } })
 globalThis.fetch = (async (_url: any, init: any) => { auth.push(init.headers.Authorization); return Response.json({ messages: [] }) }) as typeof fetch
 const worker = await mountWorker(accounts, { host })
 try {
  await worker.request('accounts.select', { id: 'second' })
  await worker.request('mail.list', { q: 'in:inbox', accountId: 'default' } as any)
  await worker.request('mail.list', { q: 'in:inbox', accountId: 'second' } as any)
  assert.deepEqual(auth, ['Bearer a', 'Bearer b'])
 } finally { globalThis.fetch = old; await worker.deactivate() }
})
