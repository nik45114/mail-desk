import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
await mkdir('dist', { recursive: true })
await mkdir('dist/worker', { recursive: true })
for (const file of await readdir('dist/worker')) if (/^[a-zA-Z0-9_-]+\.js$/.test(file)) await unlink(join('dist/worker', file))
await build({ entryPoints: { accounts: 'src/accounts.ts', encoding: 'node_modules/iconv-lite/lib/index.js' }, outdir: 'dist/worker', bundle: true, platform: 'node', target: 'node22', format: 'esm', splitting: true, minify: true, legalComments: 'eof', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } })
await build({ entryPoints: ['src/mcp.ts'], outfile: 'dist/mcp.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm', minify: true, legalComments: 'eof', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } })
// Keep notices for all installed production dependencies, including transitive ones.
const notices = []
async function scan(dir) {
 for (const item of await readdir(dir, { withFileTypes: true })) {
  if (!item.isDirectory() || item.name.startsWith('.')) continue
  const path = join(dir, item.name)
  if (item.name.startsWith('@')) { await scan(path); continue }
  let pkg; try { pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8')) } catch { continue }
  const files = await readdir(path)
  const license = files.find(f => /^licen[sc]e(?:\.md|\.txt)?$/i.test(f))
  if (license) notices.push(`## ${pkg.name} ${pkg.version}\n\n${await readFile(join(path, license), 'utf8')}`)
  try { await scan(join(path, 'node_modules')) } catch {}
 }
}
await scan('node_modules')
await writeFile('THIRD_PARTY_NOTICES.md', '# Third-party notices\n\n' + notices.join('\n\n'))
console.log('Built native mail worker and stdio MCP server.')
