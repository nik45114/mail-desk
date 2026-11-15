import { assert, test } from 'orca/testing'
import { rawMail, parseMail } from './mail'

test('recipient may be empty only when saving a draft', () => {
 const d = { to: '', subject: 'Work in progress', body: 'Hello' }
 assert.ok(rawMail(d, true))
 assert.throws(() => rawMail(d))
 assert.throws(() => rawMail({ ...d, to: 'invalid' }, true))
})
test('UTF-8 MIME preserves Cyrillic and rejects header injection', () => {
 const decoded = Buffer.from(rawMail({ to: 'to@example.com', subject: 'Возврат оплаты', body: 'Здравствуйте!\nТест' }), 'base64url').toString()
 assert.ok(decoded.includes(Buffer.from('Возврат оплаты').toString('base64')))
 assert.equal(Buffer.from(decoded.split('\r\n\r\n')[1], 'base64').toString(), 'Здравствуйте!\r\nТест')
 assert.throws(() => rawMail({ to: 'to@example.com\r\nBcc: other@example.com', subject: 'Test', body: '' }))
})
test('multipart mail prefers text and lists attachments without rendering HTML', () => {
 const mail = parseMail({ id: 'abc', threadId: 'def', payload: { parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Plain').toString('base64url') } }, { mimeType: 'text/html', body: { data: Buffer.from('<script>bad()</script><img src="https://tracker/">Hello').toString('base64url') } }, { filename: 'invoice.pdf', mimeType: 'application/pdf' }] } }, true)
 assert.equal(mail.body, 'Plain'); assert.deepEqual(mail.attachments, ['invoice.pdf'])
})
