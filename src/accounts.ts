import { randomUUID } from 'node:crypto'
import type { OrcaWorkerApi } from 'orca/worker'
import gmail, { deactivate as stopGmail } from './worker'
import imap from './imap'
import outlook from './outlook'
import type { Account, AccountInput } from './protocol'

type Handler = (input?: any) => any
const stops: (() => void)[] = []
export function deactivate() { stopGmail(); stops.splice(0).forEach(stop => stop()) }
export default function activate(orca: OrcaWorkerApi) {
 let active = 'default'
 const providers = new Map<string, Map<string, Handler>>()
 const tickets = new Map<string, string>()
 let authAccount = ''
 let mutation = Promise.resolve()
 async function accounts(): Promise<Account[]> {
  const saved = await orca.secrets.get('accounts.v1')
  return saved ? JSON.parse(saved) : [{ id: 'default', provider: 'gmail', label: 'Gmail' }]
 }
 async function provider(accountId: string) {
  const account = (await accounts()).find(a => a.id === accountId)
  if (!account) throw new Error('Аккаунт не найден.')
  if (providers.has(accountId)) return providers.get(accountId)!
  const handlers = new Map<string, Handler>()
  const key = (k: string) => accountId === 'default' ? k : `account.${accountId}.${k}`
  const scoped = {
   ...orca,
   secrets: { get: (k: string) => orca.secrets.get(key(k)), set: (k: string, v: string) => orca.secrets.set(key(k), v), delete: (k: string) => orca.secrets.delete(key(k)) },
   panels: { ...orca.panels, handle: (name: string, fn: Handler) => { handlers.set(name, fn); return { dispose() {} } }, post: (name: string, data: any) => { if (active === accountId) orca.panels.post(name as any, data) } }
  } as unknown as OrcaWorkerApi
  if (account.provider === 'gmail') gmail(scoped)
  else if (account.provider === 'imap') imap(scoped)
  else stops.push(outlook(scoped))
  providers.set(accountId, handlers)
  return handlers
 }
 async function call(accountId: string, method: string, input?: any) {
  const fn = (await provider(accountId)).get(method)
  if (!fn) throw new Error('Действие не поддерживается этим провайдером.')
  return fn(input)
 }
 orca.panels.handle('accounts.list', async () => ({ accounts: await accounts(), active }))
 orca.panels.handle('accounts.select', async ({ id }) => { await provider(id); active = id; return { ok: true } })
 orca.panels.handle('accounts.add', async (input: AccountInput) => {
  const operation = mutation.then(async () => {
   const protection = await orca.host.call('secrets.protection')
   if (protection.status !== 'os-keyring') throw new Error('Защищённое хранилище ОС недоступно.')
   if (!['gmail', 'imap', 'outlook'].includes(input.provider)) throw new Error('Неизвестный провайдер.')
   const entries = await accounts(); if (entries.length >= 20) throw new Error('Максимум 20 аккаунтов.')
   const account: Account = { id: randomUUID(), provider: input.provider, label: String(input.label || input.provider).slice(0, 100) }
   // Keep an account addressable before configuring it; rollback on a failed connection check.
   await orca.secrets.set('accounts.v1', JSON.stringify([...entries, account]))
   try {
    if (input.provider !== 'gmail') await call(account.id, 'configure', { json: JSON.stringify(input.config || {}) })
    active = account.id
    return { id: account.id }
   } catch (e) { await orca.secrets.set('accounts.v1', JSON.stringify(entries)); await orca.secrets.delete(`account.${account.id}.client`); providers.delete(account.id); throw e }
  })
  mutation = operation.then(() => {}, () => {})
  return operation
 })
 orca.panels.handle('status', async (input?: any) => {
  const target = input?.accountId || active
  const account = (await accounts()).find(a => a.id === target)
  if (!account) throw new Error('Аккаунт не найден.')
  return { ...await call(target, 'status'), accountId: target, provider: account.provider, accounts: await accounts() }
 })
 const methods = ['configure', 'auth.start', 'auth.cancel', 'disconnect', 'mail.list', 'mail.get', 'mail.modify', 'draft.save', 'draft.open', 'draft.review', 'draft.send']
 for (const method of methods) orca.panels.handle(method as any, async (input: any) => {
  const target = input?.accountId || active
  if (method === 'auth.start') {
   if (authAccount) await call(authAccount, 'auth.cancel')
   authAccount = target
  }
  if (method === 'draft.send') {
   const owner = tickets.get(input?.ticket)
   if (!owner || owner !== target) throw new Error('Предпросмотр относится к другому аккаунту или истёк.')
   tickets.delete(input.ticket)
  }
  const result = await call(target, method, input)
  if (method === 'draft.review') { if (tickets.size > 100) tickets.clear(); tickets.set(result.ticket, target) }
  return result
 })
}
