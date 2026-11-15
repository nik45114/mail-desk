import { atom, read, set, plugin, shell, env, Stack, Row, Text, Heading, Button, Badge, Input, Textarea, Card, Callout, List, ListItem, EmptyState, Spinner, Link, Collapsible, Box, Separator, Select, Code, Tabs, Tab, type PanelContext } from 'orca'
import type { Mail, Draft, Status, Account } from './protocol'
import { translator } from './i18n'

type View = 'mail' | 'compose' | 'accounts'
const status = atom<Status | null>(null), busy = atom(false), notice = atom(''), failure = atom(''), config = atom(''), authUrl = atom('')
const view = atom<View>('mail'), adding = atom(false), newProvider = atom<Account['provider']>('gmail'), accountLabel = atom(''), email = atom(''), password = atom(''), imapHost = atom(''), smtpHost = atom(''), smtpPort = atom('465'), microsoftId = atom(''), deviceCode = atom('')
const query = atom('in:inbox'), items = atom<Mail[]>([]), next = atom(''), selected = atom<Mail | null>(null)
const draft = atom<Draft>({ to: '', subject: '', body: '' }), ticket = atom(''), disconnecting = atom(false), discarding = atom(false), activeQuery = atom('in:inbox')
const request: typeof plugin.request = ((name: string, input: any, options: any) => {
 const accountId = read(status)?.accountId
 return plugin.request(name as any, accountId ? { ...input, accountId } : input, options)
}) as typeof plugin.request
const t = (key: Parameters<ReturnType<typeof translator>>[0]) => translator(env.locale)(key)
function errorText(error: unknown) {
 const message = (error as Error).message || String(error)
 return /[\u0400-\u04FF]/.test(message) && !env.locale.toLowerCase().startsWith('ru') ? t('providerError') : message
}
const folders = ['inbox', 'unread', 'starred', 'sent', 'drafts', 'allMail'] as const
const folderQueries = ['in:inbox', 'is:unread', 'is:starred', 'in:sent', 'in:drafts', '-in:trash -in:spam']
function hasDraft() { const d = read(draft); return !!(d.to || d.subject || d.body || d.draftId) }
function clearDraft() { set(draft, { to: '', subject: '', body: '' }); set(ticket, ''); set(discarding, false) }
function mailUrl(m: Mail) {
 if (read(status)?.provider === 'imap') return undefined
 if (read(status)?.provider === 'outlook') return m.webUrl || 'https://outlook.live.com/mail/'
 return 'https://mail.google.com/mail/u/?authuser=' + encodeURIComponent(read(status)?.email || '') + '#all/' + encodeURIComponent(m.threadId)
}
function shortDate(value: string) {
 const date = new Date(value)
 return Number.isFinite(date.getTime()) ? date.toLocaleDateString(env.locale, { day: 'numeric', month: 'short' }) : ''
}
async function task(fn: () => Promise<void>) {
 if (read(busy)) return
 set(busy, true); set(failure, ''); set(notice, '')
 try { await fn() } catch (e) { set(failure, errorText(e)) } finally { set(busy, false) }
}
async function refresh() { const s = await request('status'); set(status, s); if (s.error) set(failure, s.error) }
async function list(more = false) {
 const r = await request('mail.list', { q: more ? read(activeQuery) : read(query), ...(more ? { page: read(next) } : {}) }, { timeoutMs: 120000 })
 set(items, more ? [...read(items), ...r.messages] : r.messages); set(next, r.next)
 if (!more) set(activeQuery, read(query))
}
async function search(q = read(query)) { set(query, q); set(selected, null); await list() }
async function switchAccount(id: string) {
 if (hasDraft()) { set(failure, t('switchDraft')); return }
 await plugin.request('accounts.select', { id })
 set(status, null); set(items, []); set(next, ''); set(selected, null); clearDraft(); set(query, 'in:inbox'); set(authUrl, ''); set(deviceCode, '')
 await refresh(); if (read(status)?.connected) await list()
}
async function addAccount() {
 if (hasDraft()) throw new Error(t('addDraft'))
 const provider = read(newProvider)
 const result = await plugin.request('accounts.add', { provider, label: read(accountLabel) || read(email) || provider, config: provider === 'imap' ? { email: read(email), password: read(password), host: read(imapHost), port: 993, smtpHost: read(smtpHost), smtpPort: Number(read(smtpPort)) } : provider === 'outlook' ? { clientId: read(microsoftId) } : {} })
 set(password, ''); set(adding, false); await switchAccount(result.id); set(view, 'mail')
}
async function openDraft(m: Mail) {
 if (hasDraft()) { set(view, 'compose'); set(failure, t('finishDraft')); return }
 set(draft, await request('draft.open', { messageId: m.id })); set(ticket, ''); set(view, 'compose')
}
function startDraft(m?: Mail) {
 if (hasDraft()) { set(view, 'compose'); set(failure, t('finishDraft')); return }
 const address = m?.replyTo || m?.from || ''
 const to = address.match(/<([^>]+)>/)?.[1] || address
 set(draft, m ? { to, subject: /^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject, body: '', threadId: m.threadId, inReplyTo: m.messageId } : { to: '', subject: '', body: '' })
 set(ticket, ''); set(view, 'compose')
}
function forward(m: Mail) {
 if (hasDraft()) { set(view, 'compose'); set(failure, t('finishDraft')); return }
 set(draft, { to: '', subject: 'Fwd: ' + m.subject, body: '\n\n---------- Forwarded message ----------\nFrom: ' + m.from + '\nDate: ' + m.date + '\nSubject: ' + m.subject + '\n\n' + (m.body || '') })
 set(ticket, ''); set(view, 'compose')
}
function edit(key: keyof Draft, value: string) { set(draft, { ...read(draft), [key]: value }); set(ticket, '') }
function paragraphs(text: string) {
 return text ? text.split(/\r?\n/).flatMap(line => line.match(/[\s\S]{1,8000}/g) || [' ']).slice(0, 1500).map((s, i) => <Text key={String(i)}>{s}</Text>) : <Text muted>{t('noText')}</Text>
}
export function setup(ctx: PanelContext) {
 ctx.subscriptions.push(plugin.on('auth.changed', () => {
  void refresh().then(async () => {
   if (read(status)?.connected) { set(authUrl, ''); set(view, 'mail'); await list() }
  }).catch(e => set(failure, errorText(e)))
 }))
 void task(async () => { await refresh(); if (read(status)?.connected) await list() })
}
async function signIn() {
 await task(async () => {
  const r = await request('auth.start'); set(authUrl, r.url); set(deviceCode, r.code || '')
  await shell.openExternal(r.url); await refresh()
 })
}

export default function Panel() {
 const s = read(status), loading = read(busy), m = read(selected), d = read(draft), currentView = read(view), reviewing = !!read(ticket)
 return <Stack gap="sm">
  <Box padding="sm" background="card" radius="md" border>
   <Row justify="between" align="center">
    <Stack gap="xs"><Heading>Mail Desk</Heading><Text muted size="sm">{t('tagline')}</Text></Stack>
    <Badge tone={s?.connected ? 'success' : 'neutral'}>{s?.connected ? t('connected') : t('preview')}</Badge>
   </Row>
  </Box>
  <Tabs label="Mail Desk" value={currentView} onChange={value => set(view, value as View)}>
   <Tab value="mail" label={t('mail')} icon="file-text" />
   <Tab value="compose" label={t('compose')} icon="edit" />
   <Tab value="accounts" label={t('accounts')} icon="settings" />
  </Tabs>
  {loading && <Spinner label={t('loading')} />}
  {read(failure) && <Callout tone="danger" title={t('actionFailed')}><Text>{read(failure)}</Text></Callout>}
  {read(notice) && <Callout tone="success"><Text>{read(notice)}</Text></Callout>}

  {currentView === 'mail' && (!s ? <EmptyState title={t('checkConnection')} icon="refresh" /> : !s.connected ? <Stack gap="md">
   <EmptyState title={t('noConnection')} description={t('googleText')} icon="plug" />
   {(s.provider === 'gmail' || !s.provider) && <Stack gap="md">
    <Callout tone="warning" title={t('testingTitle')}><Text>{t('testingText')}</Text></Callout>
    <Card title={t('googleCard')}><Stack gap="sm">
     <Text>{t('googleText')}</Text>
     <Button disabled={loading || !s.configured || s.auth === 'waiting'} onPress={signIn}>{t('signInGoogle')}</Button>
     {s.auth === 'waiting' && <Stack gap="sm"><Spinner label={t('signInWaiting')} />
      {read(authUrl) && <Button variant="outline" onPress={() => shell.openExternal(read(authUrl))}>{t('openAgain')}</Button>}
      <Button variant="ghost" disabled={loading} onPress={() => task(async () => { await request('auth.cancel'); set(authUrl, ''); await refresh() })}>{t('cancelSignIn')}</Button>
     </Stack>}
    </Stack></Card>
    <Collapsible title={t('ownClient')}><Stack gap="sm">
     <Text>{t('ownClientText')}</Text>
     <Link href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">{t('enableGmail')}</Link>
     <Link href="https://console.cloud.google.com/auth/audience">{t('setupAudience')}</Link>
     <Link href="https://console.cloud.google.com/auth/clients">{t('createClient')}</Link>
     <Textarea label={t('createClient')} value={read(config)} rows={5} onChange={v => set(config, v)} />
     <Button disabled={loading || !read(config).trim()} onPress={() => task(async () => { await request('configure', { json: read(config) }); set(config, ''); await refresh() })}>{t('saveConnection')}</Button>
    </Stack></Collapsible>
   </Stack>}
   {s.provider === 'outlook' && <Card title={t('microsoftCard')}><Stack gap="sm">
    <Text>{t('microsoftText')}</Text>
    <Button disabled={loading || !s.configured || s.auth === 'waiting'} onPress={signIn}>{t('signInMicrosoft')}</Button>
    {read(deviceCode) && <Code block>{read(deviceCode)}</Code>}
    {s.auth === 'waiting' && <Text muted>{t('microsoftCode')}</Text>}
    {s.auth === 'waiting' && <Button variant="ghost" onPress={() => task(async () => { await request('auth.cancel'); await refresh() })}>{t('cancelSignIn')}</Button>}
    {!s.configured && <Text muted>{t('microsoftMissing')}</Text>}
   </Stack></Card>}
   {s.provider === 'imap' && <Text muted>{t('imapDisconnected')}</Text>}
   <Text muted size="xs">{t('securityNote')}</Text>
  </Stack> : <Stack gap="sm">
   <Text size="sm" muted>{s.email}</Text>
   <Row wrap gap="xs">
    <Button disabled={loading} icon="add" onPress={() => startDraft()}>{t('newMail')}</Button>
    <Button variant="outline" disabled={loading} icon="refresh" onPress={() => task(async () => { await list() })}>{t('refresh')}</Button>
    {s.provider !== 'imap' && <Link href={s.provider === 'outlook' ? 'https://outlook.live.com/mail/' : 'https://mail.google.com/'}>{t('webmail')}</Link>}
   </Row>
   {m ? <Card title={m.subject}><Stack gap="sm">
    <Text size="sm">{t('from')}: {m.from}</Text><Text size="sm" muted>{t('to')}: {m.to}</Text><Text muted size="xs">{m.date}</Text>
    <Row gap="xs">{m.labels.includes('UNREAD') && <Badge tone="accent">{t('unread')}</Badge>}{m.labels.includes('STARRED') && <Badge tone="warning">{t('starred')}</Badge>}</Row>
    <Row wrap>
     <Button disabled={loading || m.labels.includes('DRAFT')} onPress={() => startDraft(m)}>{t('reply')}</Button>
     <Button variant="outline" disabled={loading || m.labels.includes('DRAFT')} onPress={() => forward(m)}>{t('forward')}</Button>
     {m.labels.includes('DRAFT') && <Button disabled={loading} onPress={() => task(() => openDraft(m))}>{t('continueDraft')}</Button>}
     <Button variant="ghost" onPress={() => set(selected, null)}>{t('backList')}</Button>
     {mailUrl(m) && <Link href={mailUrl(m)}>{t('openMessage')}</Link>}
    </Row>
    <Row wrap>{[
     [t('archive'), 'INBOX', false],
     [m.labels.includes('UNREAD') ? t('read') : t('markUnread'), 'UNREAD', !m.labels.includes('UNREAD')],
     [m.labels.includes('STARRED') ? t('removeStar') : t('addStar'), 'STARRED', !m.labels.includes('STARRED')]
    ].map(([label, tag, add]) => <Button key={String(tag)} size="sm" variant="outline" disabled={loading} onPress={() => task(async () => {
     await request('mail.modify', { id: m.id, add: add ? [String(tag)] : [], remove: add ? [] : [String(tag)] })
     set(selected, { ...m, labels: add ? [...m.labels, String(tag)] : m.labels.filter(x => x !== tag) }); await list()
    })}>{String(label)}</Button>)}</Row>
    <Separator />
    {paragraphs(m.body || '')}
    {!!m.attachments?.length && <Text muted>{t('attachments')}: {m.attachments.join(', ')}. {t('attachmentsNote')}</Text>}
   </Stack></Card> : <Stack gap="sm">
    <Card><Stack gap="sm">
     <Row wrap gap="xs">{folders.map((name, index) => <Button key={folderQueries[index]} size="sm" variant={read(activeQuery) === folderQueries[index] ? 'solid' : 'ghost'} disabled={loading} onPress={() => task(() => search(folderQueries[index]))}>{t(name)}</Button>)}</Row>
     <Input label={t('searchMail')} type="search" value={read(query)} disabled={loading} onChange={v => set(query, v)} onSubmit={() => task(() => search())} placeholder="from:google.com newer_than:30d" />
     <Row wrap gap="xs">
      <Button variant="outline" disabled={loading} icon="search" onPress={() => task(() => search())}>{t('search')}</Button>
      {[['attachments', 'has:attachment'], ['lastWeek', 'newer_than:7d']].filter(([, q]) => s.provider !== 'imap' || q !== 'has:attachment').map(([label, filter]) => <Button key={filter} size="sm" variant="ghost" disabled={loading} onPress={() => task(() => search(read(query).includes(filter) ? read(query) : read(query) + ' ' + filter))}>{t(label as 'attachments' | 'lastWeek')}</Button>)}
      <Text muted size="xs">{t('loaded')}: {read(items).length}</Text>
     </Row>
    </Stack></Card>
    <List label={t('mail')}>{read(items).map(x => <ListItem key={x.id} icon={x.labels.includes('DRAFT') ? 'edit' : 'file-text'} title={(x.labels.includes('UNREAD') ? '● ' : '') + (x.labels.includes('STARRED') ? '★ ' : '') + x.subject.slice(0, 300)} description={x.from.slice(0, 100) + ' · ' + shortDate(x.date)} disabled={loading} onPress={() => task(async () => { set(selected, await request('mail.get', { id: x.id })) })}><Text muted size="sm">{x.snippet.slice(0, 180)}</Text></ListItem>)}</List>
    {!read(items).length && !loading && <EmptyState title={t('noMessages')} description={t('noMessagesHint')} icon="search" />}
    {read(next) && <Button variant="outline" disabled={loading} onPress={() => task(async () => list(true))}>{t('more')}</Button>}
   </Stack>}
  </Stack>)}

  {currentView === 'compose' && <Card title={reviewing ? t('reviewTitle') : d.draftId ? t('editDraft') : d.threadId ? t('replyTitle') : t('newEmail')}><Stack gap="sm">
   {reviewing ? <Stack gap="sm">
    <Text weight="semibold">{t('to')}: {d.to}</Text><Text weight="semibold">{t('subject')}: {d.subject || t('noSubject')}</Text>{paragraphs(d.body)}
    <Row wrap>
     <Button disabled={loading} onPress={() => task(async () => { const current = read(ticket); set(ticket, ''); await request('draft.send', { ticket: current }, { timeoutMs: 120000 }); clearDraft(); set(view, 'mail'); set(notice, t('sendSuccess')) })}>{t('send')}</Button>
     <Button variant="outline" disabled={loading} onPress={() => set(ticket, '')}>{t('backEdit')}</Button>
    </Row>
   </Stack> : <Stack gap="sm">
    <Input label={t('to')} value={d.to} disabled={loading} onChange={v => edit('to', v)} placeholder="name@example.com" />
    <Input label={t('subject')} value={d.subject} disabled={loading} onChange={v => edit('subject', v)} maxLength={500} />
    <Text muted size="xs">{d.draftId ? t('draftLinked') : t('notSaved')}</Text>
    <Textarea label={t('body')} value={d.body} disabled={loading} onChange={v => edit('body', v)} rows={14} maxLength={100000} />
    <Row wrap>
     <Button disabled={loading} onPress={() => task(async () => { const r = await request('draft.save', read(draft)); set(draft, { ...read(draft), draftId: r.id }); set(notice, t('draftSaved')) })}>{t('saveDraft')}</Button>
     <Button disabled={loading} variant="outline" onPress={() => task(async () => { const r = await request('draft.review', read(draft)); set(ticket, r.ticket) })}>{t('review')}</Button>
    </Row>
    {read(discarding) ? <Row wrap><Button tone="danger" disabled={loading} onPress={clearDraft}>{t('clearLocal')}</Button><Button variant="ghost" onPress={() => set(discarding, false)}>{t('cancel')}</Button></Row> : <Button variant="ghost" disabled={loading} onPress={() => set(discarding, true)}>{t('clearEditor')}</Button>}
    <Text muted size="xs">{t('editorMemory')}</Text>
   </Stack>}
  </Stack></Card>}

  {currentView === 'accounts' && <Stack gap="sm">
   {s && <Card title={t('accounts')}><Stack gap="sm">
    <Select label={t('account')} value={s.accountId || 'default'} options={(s.accounts || [{ id: 'default', label: 'Gmail', provider: 'gmail' }]).map(a => ({ value: a.id, label: a.label + ' · ' + a.provider }))} disabled={loading || hasDraft()} onChange={id => task(() => switchAccount(id))} />
    <Button variant="outline" icon="add" disabled={loading || hasDraft()} onPress={() => set(adding, !read(adding))}>{t('addMail')}</Button>
   </Stack></Card>}
   {read(adding) && <Card title={t('addMail')}><Stack gap="sm">
    <Select label={t('service')} value={read(newProvider)} options={[{ value: 'gmail', label: 'Google / Gmail' }, { value: 'outlook', label: 'Microsoft / Outlook / Microsoft 365' }, { value: 'imap', label: 'IMAP / SMTP' }]} onChange={v => set(newProvider, v as Account['provider'])} />
    <Input label={t('accountName')} value={read(accountLabel)} onChange={v => set(accountLabel, v)} placeholder="Personal / Work" />
    {read(newProvider) === 'imap' && <Stack gap="sm"><Text muted>{t('imapSetup')}</Text>
     <Input label={t('email')} value={read(email)} onChange={v => set(email, v)} /><Input label={t('appPassword')} type="password" value={read(password)} onChange={v => set(password, v)} />
     <Input label={t('imapHost')} value={read(imapHost)} onChange={v => set(imapHost, v)} placeholder="imap.example.com" /><Input label={t('smtpHost')} value={read(smtpHost)} onChange={v => set(smtpHost, v)} placeholder="smtp.example.com" />
     <Select label={t('smtpEncryption')} value={read(smtpPort)} options={[{ value: '465', label: 'TLS · 465' }, { value: '587', label: 'STARTTLS · 587' }]} onChange={v => set(smtpPort, v)} />
    </Stack>}
    {read(newProvider) === 'outlook' && <Stack gap="sm"><Text muted>{t('outlookSetup')}</Text><Input label={t('microsoftId')} value={read(microsoftId)} onChange={v => set(microsoftId, v)} /><Link href="https://entra.microsoft.com/">Microsoft Entra</Link></Stack>}
    {read(newProvider) === 'gmail' && <Text muted>{t('googleSetup')}</Text>}
    <Row><Button disabled={loading} onPress={() => task(addAccount)}>{t('addAccount')}</Button><Button variant="ghost" onPress={() => { set(password, ''); set(adding, false) }}>{t('cancel')}</Button></Row>
   </Stack></Card>}
   {s?.configured && <Collapsible title={t('connectionTitle')}><Stack gap="sm">
    <Text muted>{t('disconnectText')}</Text>{(!s.provider || s.provider === 'gmail') && <Link href="https://myaccount.google.com/connections">{t('manageGoogle')}</Link>}
    {read(disconnecting) ? <Row wrap><Button tone="danger" disabled={loading} onPress={() => task(async () => { await request('disconnect'); set(items, []); set(selected, null); clearDraft(); set(authUrl, ''); set(disconnecting, false); await refresh() })}>{t('deleteConnection')}</Button><Button variant="ghost" onPress={() => set(disconnecting, false)}>{t('cancel')}</Button></Row> : <Button variant="outline" onPress={() => set(disconnecting, true)}>{t('disconnect')}</Button>}
   </Stack></Collapsible>}
   <Collapsible title={t('mcpTitle')}><Stack gap="sm"><Text>{t('mcpText')}</Text><Code block>{'node /absolute/path/to/mail-desk/dist/mcp.mjs'}</Code><Text muted>{t('mcpHint')}</Text></Stack></Collapsible>
  </Stack>}
 </Stack>
}
