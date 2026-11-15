import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'

test('quick filters search and pagination uses the submitted query', async () => {
 const queries: any[] = []
 const host = mockHost({ requests: {
  status: () => ({ connected: true, configured: true, email: 'me@example.com', auth: '', error: '' }),
  'mail.list': (q) => { queries.push(q); return { messages: [], next: 'page2' } }
 } })
 const view = await mount(panel, { host, locale: 'ru-RU' })
 await view.press({ text: 'С вложениями' })
 assert.equal(queries.at(-1).q, 'in:inbox has:attachment')
 await view.type({ label: 'Поиск почты' }, 'unsent search', { replace: true })
 await view.press({ text: 'Ещё письма' })
 assert.deepEqual(queries.at(-1), { q: 'in:inbox has:attachment', page: 'page2' })
 await view.press({ text: 'Черновики' })
 assert.equal(queries.at(-1).q, 'in:drafts')
 assert.deepEqual(view.errors, []); await view.unmount()
})
test('sending needs review and a separate press, with one-use ticket', async () => {
 let sends = 0
 const host = mockHost({ requests: {
  status: () => ({ connected: true, configured: true, email: 'me@example.com', auth: '', error: '' }),
  'mail.list': () => ({ messages: [], next: '' }),
  'draft.review': () => ({ ticket: 'review-token' }),
  'draft.send': ({ ticket }) => { assert.equal(ticket, 'review-token'); sends++; return { id: 'sent' } }
 } })
 const view = await mount(panel, { host, locale: 'ru-RU' })
 await view.press({ role: 'button', text: 'Написать' }); await view.type({ label: 'Кому' }, 'to@example.com'); await view.type({ label: 'Тема' }, 'Привет'); await view.type({ label: 'Текст письма' }, 'Текст')
 await view.press({ text: 'Предпросмотр' }); assert.equal(sends, 0)
 await view.press({ text: 'Вернуться к правке' }); await view.type({ label: 'Текст письма' }, 'Обновление', { replace: true }); assert.equal(sends, 0)
 await view.press({ text: 'Предпросмотр' }); await view.press({ text: 'Отправить письмо' }); assert.equal(sends, 1)
 assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, []); await view.unmount()
})
test('one click opens Google and callback loads mailbox without a check button', async () => {
 let connected = false
 const host = mockHost({ requests: {
  status: () => ({ connected, configured: true, email: connected ? 'me@example.com' : '', auth: connected ? 'done' : '', error: '' }),
  'auth.start': () => ({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=test' }),
  'mail.list': () => ({ messages: [], next: '' })
 } })
 const view = await mount(panel, { host, locale: 'ru-RU' })
 await view.press({ text: 'Войти через Google' })
 assert.equal(host.callsOf('shell.openExternal').length, 1)
 connected = true; await view.post('auth.changed', { state: 'done' })
 assert.ok(view.find({ text: 'me@example.com' })); assert.deepEqual(view.refusals, []); assert.deepEqual(view.errors, [])
 await view.unmount()
})
test('native account and editor tabs expose their forms', async () => {
 const host = mockHost({ requests: {
  status: () => ({ connected: true, configured: true, email: 'me@example.com', auth: '', error: '', accountId: 'default', provider: 'gmail', accounts: [{ id: 'default', label: 'Gmail', provider: 'gmail' }] }),
  'mail.list': () => ({ messages: [], next: '' })
 } })
 const view = await mount(panel, { host, locale: 'ru-RU' })
 await view.select({ label: 'Mail Desk' }, 'accounts')
 await view.press({ role: 'button', text: 'Добавить почту' })
 await view.select({ label: 'Сервис' }, 'imap')
 assert.ok(view.find({ label: 'Пароль приложения' }))
 await view.select({ label: 'Mail Desk' }, 'compose')
 assert.ok(view.find({ label: 'Текст письма' }))
 assert.deepEqual(view.errors, []); assert.deepEqual(view.refusals, []); await view.unmount()
})
