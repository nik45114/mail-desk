export interface Mail { id: string; threadId: string; subject: string; from: string; to: string; date: string; snippet: string; labels: string[]; body?: string; messageId?: string; replyTo?: string; attachments?: string[]; webUrl?: string }
export interface Draft { to: string; subject: string; body: string; draftId?: string; threadId?: string; inReplyTo?: string }
export interface Account { id: string; provider: 'gmail' | 'imap' | 'outlook'; label: string }
export interface AccountInput { provider: Account['provider']; label: string; config?: Record<string, string | number> }
export interface Status { connected: boolean; configured: boolean; email: string; auth: string; error: string; accountId?: string; provider?: Account['provider']; accounts?: Account[] }
declare module 'orca' {
 interface PluginRequests {
  'status': { output: Status };
  'accounts.list': { output: { accounts: Account[]; active: string } };
  'accounts.add': { input: AccountInput; output: { id: string } };
  'accounts.select': { input: { id: string }; output: { ok: boolean } };
  'configure': { input: { json: string }; output: { ok: boolean } };
  'auth.start': { output: { url: string; code?: string } };
  'auth.cancel': { output: { ok: boolean } };
  'disconnect': { output: { ok: boolean } };
  'mail.list': { input: { q: string; page?: string }; output: { messages: Mail[]; next: string } };
  'mail.get': { input: { id: string }; output: Mail };
  'mail.modify': { input: { id: string; add: string[]; remove: string[] }; output: { ok: boolean } };
  'draft.save': { input: Draft; output: { id: string } };
  'draft.open': { input: { messageId: string }; output: Draft };
  'draft.review': { input: Draft; output: { ticket: string } };
  'draft.send': { input: { ticket: string }; output: { id: string } };
 }
 interface PluginPanelEvents { 'auth.changed': { state: string } }
}
