import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-proc-'))
process.env.DSH_HOME = tmp
const { apply } = await import('../bootstrap/index.js')
const defs = new Map()
const ctx = {
  tools: { register (def) { defs.set(def.name, def) } },
  effect (fn) { fn() },
  logger: { info () {}, warn () {}, error () {} },
}
apply(ctx, { pluginPath: path.join(import.meta.dirname, '..', 'bootstrap', 'proc-plugin.mjs'), pluginId: 'procdemo', pruneAfterDays: 0 })

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

await check('Cell 内直接 child_process 被 Node 权限拒绝', async () => {
  assert.ok(await waitFor(() => defs.has('demo_proc')), 'tool not registered')
  const out = await defs.get('demo_proc').execute({})
  assert.equal(out.error, 'ERR_ACCESS_DENIED')
})

console.log('\n' + passed + ' checks passed')
setTimeout(() => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(process.exitCode ?? 0) }, 300)

