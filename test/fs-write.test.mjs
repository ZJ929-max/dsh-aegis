import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-fsw-'))
process.env.DSH_HOME = tmp
const target = path.join(tmp, 'out.txt')

const { apply } = await import('../bootstrap/index.js')
const { loadPolicy, savePolicy, grant } = await import('../lib/policy.mjs')

const policy = loadPolicy()
grant(policy, 'fswdemo', { version: '1', hash: 'h', caps: ['fs.write'], scopes: { 'fs.write': tmp } })
savePolicy(policy)

const defs = new Map()
const ctx = {
  tools: { register (def) { defs.set(def.name, def) } },
  effect (fn) { fn() },
  logger: { info () {}, warn () {}, error () {} },
}
apply(ctx, { pluginPath: path.join(import.meta.dirname, '..', 'bootstrap', 'fs-write-plugin.mjs'), pluginId: 'fswdemo', pruneAfterDays: 0 })

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

await check('未修改的 fs.promises.writeFile 经 Broker 写文件', async () => {
  assert.ok(await waitFor(() => defs.has('demo_fs_write')), 'tool not registered')
  const out = await defs.get('demo_fs_write').execute({ path: target, text: 'WRITE-OK' })
  assert.equal(out.ok, true)
  assert.equal(fs.readFileSync(target, 'utf8'), 'WRITE-OK')
})

console.log('\n' + passed + ' checks passed')
setTimeout(() => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(process.exitCode ?? 0) }, 300)

