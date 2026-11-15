import { defineCheck } from 'orca/testing'
const connected = { connected: true, configured: true, email: 'demo@example.com', auth: '', error: '' }
export default defineCheck({
 setup: {},
 ready: { requests: { status: () => ({ connected: false, configured: true, email: '', auth: '', error: '' }) } },
 waiting: { requests: { status: () => ({ connected: false, configured: true, email: '', auth: 'waiting', error: '' }) } },
 inbox: { requests: { status: () => connected, 'mail.list': () => ({ messages: [{ id: 'demo1', threadId: 'thread1', subject: 'Ваше обращение принято', from: 'Support <support@example.com>', to: 'demo@example.com', date: '', snippet: 'Спасибо! Мы проверим ограничение доступа и сообщим результат.', labels: ['INBOX','UNREAD'] }], next: '' }) } },
 empty: { requests: { status: () => connected, 'mail.list': () => ({ messages: [], next: '' }) } },
 failure: { requests: { status: () => connected, 'mail.list': () => { throw new Error('Нет ответа от Google. Попробуйте обновить список.') } } }
})
