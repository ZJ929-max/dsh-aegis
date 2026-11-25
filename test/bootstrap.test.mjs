import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-boot-'))
process.env.DSH_HOME = tmp

const { apply } = await import('../bootstrap/index.js')
const { loadPolicy, savePolicy, grant } = await import('../lib/policy.mjs')
const { listPending, resolveRequest } = await import('../lib/approvals.mjs')

const secret = path.join(tmp, 'secret.txt')
fs.writeFileSync(secret, 'CELL-SECRET\n')
const plugin = path.join(import.meta.dirname, '..', 'bootstrap', 'test-plugin.mjs')

const defs = new Map()
const cleanups = []
const ctx = {
  tools: { register (def) { defs.set(def.name, def) } },
  effect (fn) { const c = fn(); if (typeof c === 'function') cleanups.push(c) },
  logger: { info () {}, warn () {}, error () {} },
}

const pre = loadPolicy()
const stale = grant(pre, 'stale', { version: '1', hash: 'h', caps: ['fs.read'], scopes: { 'fs.read': tmp } })
stale.grants[0].grantedAt = new Date(0).toISOString()
savePolicy(pre)

apply(ctx, { pluginPath: plugin, pluginId: 'demo' })

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

await check('启动时自动回收长期未用授权', async () => {
  const rec = loadPolicy().plugins.stale
  assert.equal(rec?.grants?.length ?? 0, 0)
})

await check('Cell 注册工具并经代理执行', async () => {
  assert.ok(await waitFor(() => defs.has('demo_echo')), 'demo_echo not registered')
  const out = await defs.get('demo_echo').execute({ text: 'hello' })
  assert.deepEqual(out, { text: 'hello' })
})

await check('运行时申请：用户拒绝则调用被拒绝', async () => {
  const call = defs.get('demo_read').execute({ path: secret })
  assert.ok(await waitFor(() => listPending().length > 0), 'no pending request')
  const req = listPending()[0]
  resolveRequest(req.id, { allow: false })
  await assert.rejects(() => call, /denied|EACCES/)
})

await check('运行时申请：用户允许 always 后 Broker 读文件回传', async () => {
  const call = defs.get('demo_read').execute({ path: secret })
  assert.ok(await waitFor(() => listPending().length > 0), 'no second pending request')
  const req = listPending()[0]
  resolveRequest(req.id, { allow: true, lifetime: 'always' })
  const out = await call
  assert.equal(out.text.trim(), 'CELL-SECRET')
  assert.equal(listPending().length, 0)
})

for (const c of cleanups) c()
console.log('\n' + passed + ' checks passed')
setTimeout(() => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(process.exitCode ?? 0) }, 300)

