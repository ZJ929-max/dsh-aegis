import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-ui-'))
process.env.DSH_HOME = tmp

const { createRequest, listPending } = await import('../lib/approvals.mjs')
const { startUi } = await import('../lib/ui.mjs')
const { loadPolicy, savePolicy, grant } = await import('../lib/policy.mjs')

const req = createRequest({ plugin: 'demo', cap: 'fs.read', scope: 'C:/secret/x.txt', reason: 'test' })
const ui = await startUi({ port: 0 })
let passed = 0
const check = async (label, fn) => {
  try { await fn(); passed++; console.log('ok   ' + label) }
  catch (e) { console.log('FAIL ' + label + '\n     ' + e.message); process.exitCode = 1 }
}

await check('UI 列出 pending', async () => {
  const r = await fetch(ui.base + '/api/pending?token=' + ui.token)
  const rows = await r.json()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].plugin, 'demo')
})

await check('UI 页面渲染申请', async () => {
  const r = await fetch(ui.url)
  const html = await r.text()
  assert.ok(html.includes('demo'))
  assert.ok(html.includes('仅本次'))
})

await check('UI 批准后 pending 清空', async () => {
  const r = await fetch(ui.base + '/api/decision?token=' + ui.token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: req.id, allow: true, lifetime: 'once' }),
  })
  assert.equal(r.status, 200)
  const d = await r.json()
  assert.equal(d.allow, true)
  assert.equal(listPending().length, 0)
})

await check('UI 撤销已授权插件', async () => {
  const policy = loadPolicy()
  grant(policy, 'demo', { version: '1', hash: 'h', caps: ['fs.read'], scopes: { 'fs.read': 'C:/secret' } })
  savePolicy(policy)
  const page = await (await fetch(ui.url)).text()
  assert.ok(page.includes('撤销该插件全部授权'))
  const r = await fetch(ui.base + '/api/revoke?token=' + ui.token, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ plugin: 'demo' }).toString(),
  })
  assert.equal(r.status, 303)
  assert.equal(loadPolicy().plugins.demo.decision, 'deny')
})

await check('无 token 被拒绝', async () => {
  const r = await fetch(ui.base + '/api/pending')
  assert.equal(r.status, 403)
})

ui.close()
console.log('\n' + passed + ' checks passed')
setTimeout(() => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(process.exitCode ?? 0) }, 200)

