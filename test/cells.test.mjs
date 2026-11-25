import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-cells-'))
process.env.DSH_HOME = tmp
const aegisDir = path.join(tmp, 'aegis')
fs.mkdirSync(aegisDir, { recursive: true })
const here = path.dirname(fileURLToPath(import.meta.url))
const bootstrap = path.join(here, '..', 'bootstrap')
fs.writeFileSync(path.join(aegisDir, 'cells.json'), JSON.stringify({
  cells: [
    { name: 'echo', pluginId: 'echo', pluginPath: path.join(bootstrap, 'test-plugin.mjs') },
    { name: 'env', pluginId: 'env', pluginPath: path.join(bootstrap, 'env-plugin.mjs') },
  ],
}, null, 2))

const { apply } = await import('../bootstrap/index.js')
const defs = new Map()
const ctx = {
  tools: { register (def) { defs.set(def.name, def) } },
  effect (fn) { fn() },
  logger: { info () {}, warn () {}, error () {} },
}
apply(ctx, { pruneAfterDays: 0 })
const waitFor = async (fn, ms = 5000) => {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}
let passed = 0
const check = async (label, fn) => {
  try { await fn(); passed++; console.log('ok   ' + label) }
  catch (e) { console.log('FAIL ' + label + '\n     ' + e.message); process.exitCode = 1 }
}

await check('cells.json 同时启动两个 Cell 并注册工具', async () => {
  assert.ok(await waitFor(() => defs.has('demo_echo') && defs.has('demo_env')), 'not all tools registered')
  const echo = await defs.get('demo_echo').execute({ text: 'multi' })
  assert.deepEqual(echo, { text: 'multi' })
})

console.log('\n' + passed + ' checks passed')
setTimeout(() => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(process.exitCode ?? 0) }, 300)
