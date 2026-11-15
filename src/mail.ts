import { randomUUID } from 'node:crypto'
import type { Mail, Draft } from './protocol'
export function header(payload: any, name: string): string { return String(payload?.headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '') }
export function decode(data = ''): string { return Buffer.from(data, 'base64url').toString('utf8') }
function parts(p: any): any[] { return [p, ...(p?.parts || []).flatMap(parts)] }
export function parseMail(m: any, full = false): Mail {
 const p = m.payload || {}; const all = parts(p)
 const plain = all.filter(x => x.mimeType === 'text/plain' && !x.filename).map(x => decode(x.body?.data)).join('\n')
 const html = all.filter(x => x.mimeType === 'text/html' && !x.filename).map(x => decode(x.body?.data)).join('\n')
 const fallback = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<\/?(?:p|div|br|li)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
 return { id: m.id, threadId: m.threadId, subject: header(p, 'Subject') || '(Без темы)', from: header(p, 'From'), to: header(p, 'To'), date: header(p, 'Date'), snippet: m.snippet || '', labels: m.labelIds || [], ...(full ? { body: (plain || fallback || m.snippet || '').slice(0, 100000), messageId: header(p, 'Message-ID'), replyTo: header(p, 'Reply-To'), attachments: all.filter(x => x.filename).map(x => x.filename) } : {}) }
}
export function validateDraft(d: Draft, allowEmptyRecipient = false): void {
 if (!d || typeof d.to !== 'string' || typeof d.subject !== 'string' || typeof d.body !== 'string') throw new Error('Заполните получателя, тему и текст.')
 if (/[\r\n]/.test(d.to + d.subject + (d.inReplyTo || ''))) throw new Error('Недопустимый перенос строки в заголовке.')
 if (!(allowEmptyRecipient && !d.to.trim()) && (!d.to.trim() || d.to.split(',').some(x => !/^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/.test(x.trim())))) throw new Error('Укажите email; несколько адресов разделяйте запятой.')
 if (d.body.length > 100000 || d.subject.length > 500 || d.to.length > 2000) throw new Error('Письмо слишком длинное.')
}
export function rawMail(d: Draft, allowEmptyRecipient = false): string {
 validateDraft(d, allowEmptyRecipient)
 const subject = [...d.subject].reduce((chunks: string[], char) => { const last = chunks.length - 1; if (Buffer.byteLength(chunks[last] + char) > 42) chunks.push(char); else chunks[last] += char; return chunks }, ['']).map(x => `=?UTF-8?B?${Buffer.from(x).toString('base64')}?=`).join('\r\n ')
 const headers = [`To: ${d.to}`, `Subject: ${subject}`, `Message-ID: <${randomUUID()}@gmail-desk.local>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64']
 if (d.inReplyTo) headers.push(`In-Reply-To: ${d.inReplyTo}`, `References: ${d.inReplyTo}`)
 return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + (Buffer.from(d.body.replace(/\r?\n/g, '\r\n')).toString('base64').match(/.{1,76}/g) || ['']).join('\r\n')).toString('base64url')
}
