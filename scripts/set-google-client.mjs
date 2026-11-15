import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const path = process.argv[2]
if (!path) throw new Error('Usage: node scripts/set-google-client.mjs /path/to/desktop-client.json')
const { installed } = JSON.parse(await readFile(path, 'utf8'))
if (!installed || typeof installed.client_id !== 'string' || !installed.client_id.endsWith('.apps.googleusercontent.com') || typeof installed.client_secret !== 'string' || !installed.client_secret) throw new Error('Only a publisher-owned Google Desktop app OAuth client is supported.')
const client = { client_id: installed.client_id, client_secret: installed.client_secret }
await writeFile(fileURLToPath(new URL('../src/google-client.ts', import.meta.url)), '// Publisher-owned Desktop OAuth public client. Never place refresh/access tokens here.\nexport const googleClient: { client_id: string; client_secret: string } | null = ' + JSON.stringify(client, null, 2) + '\n')
console.log('Publisher Desktop OAuth configuration installed. No credentials printed.')
