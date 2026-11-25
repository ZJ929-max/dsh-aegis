import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-fetch-'))
process.env.DSH_HOME = tmp

const { apply } = await import('../bootstrap/index.js')
const { loadPolicy, savePolicy, grant } = await import('../lib/policy.mjs')

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('HELLO-NET')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const url = 'http://127.0.0.1:' + port + '/x'

const policy = loadPolicy()
grant(policy, 'netdemo', { version: '1', hash: 'h', caps: ['net'], scopes: { net: url } })
savePolicy(policy)

const defs = new Map()
const cleanups = []
const ctx = {
  tools: { register (def) { defs.set(def.name, def) } },
  effect (fn) { const c = fn(); if (typeof c === 'function') cleanups.push(c) },
  logger: { info () {}, warn () {}, error () {} },
}
const plugin = path.join(import.meta.dirname, '..', 'bootstrap', 'fetch-plugin.mjs')
apply(ctx, { pluginPath: plugin, pluginId: 'netdemo', pruneAfterDays: 0 })

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

await check('未修改的 fetch 走 Broker 并返回内容', async () => {
  assert.ok(await waitFor(() => defs.has('demo_fetch')), 'tool not registered')
  const out = await defs.get('demo_fetch').execute({ url })
  assert.equal(out.status, 200)
  assert.equal(out.text, 'HELLO-NET')
})

for (const c of cleanups) c()
server.close()
console.log('\n' + passed + ' checks passed')
setTimeout(() => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(process.exitCode ?? 0) }, 300)

