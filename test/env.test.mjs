import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-env-'))
process.env.DSH_HOME = tmp
process.env.AEGIS_TEST_SECRET = 'TOP-SECRET-ENV'

const { apply } = await import('../bootstrap/index.js')

const defs = new Map()
const ctx = {
  tools: { register (def) { defs.set(def.name, def) } },
  effect (fn) { fn() },
  logger: { info () {}, warn () {}, error () {} },
}
const plugin = path.join(import.meta.dirname, '..', 'bootstrap', 'env-plugin.mjs')
apply(ctx, { pluginPath: plugin, pluginId: 'envdemo', pruneAfterDays: 0 })

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

await check('Cell 环境不含宿主密钥', async () => {
  assert.ok(await waitFor(() => defs.has('demo_env')), 'tool not registered')
  const out = await defs.get('demo_env').execute({})
  assert.equal(out.secret, null)
  assert.ok(!out.keys.includes('AEGIS_TEST_SECRET'))
  assert.ok(out.keys.includes('AEGIS_PLUGIN'))
})

console.log('\n' + passed + ' checks passed')
setTimeout(() => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(process.exitCode ?? 0) }, 300)

