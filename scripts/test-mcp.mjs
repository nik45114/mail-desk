import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const client = new Client({ name: 'mail-desk-smoke', version: '1.0.0' })
const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/mcp.mjs'], env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) })
try {
 await client.connect(transport)
 const { tools } = await client.listTools()
 if (tools.length !== 4 || tools.some(t => t.name.includes('send'))) throw new Error('Unexpected tools')
 const result = await client.callTool({ name: 'mail_accounts', arguments: {} })
 if (result.isError) throw new Error('MCP account request failed')
 const data = JSON.parse(result.content[0].text)
 if (!data.accounts?.length) throw new Error('No accounts returned')
 const search = await client.callTool({ name: 'mail_search', arguments: { accountId: data.accounts[0].id, q: 'in:inbox' } })
 if (search.isError) throw new Error('MCP search failed')
 const inbox = JSON.parse(search.content[0].text)
 console.log(JSON.stringify({ tools: tools.map(t => t.name), accounts: data.accounts.length, messagesRead: inbox.messages.length, sent: false }))
} finally { await client.close() }
