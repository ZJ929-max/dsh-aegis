import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-test-'))
process.env.DSH_HOME = tmp

const { resolveProfile, contentHash } = await import('../lib/resolve.mjs')
const { evaluate, planApply, apply, revert } = await import('../lib/gate.mjs')
const { loadPolicy, savePolicy, grant, revoke, markUsed, prune, decide } = await import('../lib/policy.mjs')

const profileDir = path.join(tmp, 'profiles', 'test')
const nm = path.join(profileDir, 'node_modules')
const write = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) + '\n')
}
write(path.join(profileDir, 'package.json'), {
  dsh: { profile: { bundles: ['@deepseek-ai/core', 'meta', 'plain'] } },
})
write(path.join(nm, 'meta', 'package.json'), {
  name: 'meta', version: '1.0.0', dsh: { bundle: { patch: ['./p.yml'] } },
})
write(path.join(nm, 'meta', 'p.yml'), '- insert:\n    - id: inserted\n      name: inserted\n')
write(path.join(nm, 'meta', 'index.js'), 'export default {}\n')
write(path.join(nm, 'plain', 'package.json'), { name: 'plain', version: '1.0.0' })
write(path.join(nm, 'plain', 'index.js'), 'import fs from "node:fs"\nexport default {}\n')
write(path.join(nm, 'inserted', 'package.json'), { name: 'inserted', version: '1.0.0' })
write(path.join(nm, 'inserted', 'index.js'), 'export default {}\n')

let passed = 0
const check = (label, fn) => {
  try { fn(); passed++; console.log('ok   ' + label) }
  catch (e) { console.log('FAIL ' + label + '\n     ' + e.message); process.exitCode = 1 }
}

check('resolver 展开 meta-bundle 的 insert', () => {
  const { entries } = resolveProfile(profileDir)
  const names = entries.map((e) => e.name)
  assert.ok(names.includes('inserted'))
  const ins = entries.find((e) => e.name === 'inserted')
  assert.deepEqual(ins.sources, ['insert:meta'])
})

check('未授权时全部 pending', () => {
  const { rows } = evaluate(profileDir)
  assert.equal(rows.find((r) => r.name === 'plain').decision, 'pending')
  assert.equal(rows.find((r) => r.name === 'inserted').decision, 'pending')
})

check('授权后 plan 保留 core/meta/plain', () => {
  const policy = loadPolicy()
  for (const name of ['meta', 'plain', 'inserted']) {
    const { rows } = evaluate(profileDir, policy)
    const row = rows.find((r) => r.name === name)
    grant(policy, name, { version: row.version, hash: row.hash, caps: row.caps })
  }
  savePolicy(policy)
  const { keep, drop } = planApply(profileDir)
  assert.deepEqual(keep, ['@deepseek-ai/core', 'meta', 'plain'])
  assert.deepEqual(drop, [])
})

check('meta 内 insert 未授权时保留 meta、只 disable insert', () => {
  const policy = loadPolicy()
  revoke(policy, 'inserted')
  savePolicy(policy)
  const { keep, drop, disable } = planApply(profileDir)
  assert.ok(keep.includes('meta'))
  assert.deepEqual(drop, [])
  assert.deepEqual(disable, [{ id: 'inserted', plugin: 'inserted' }])
})

check('apply --write 备份并改写 bundles，revert 恢复', () => {
  const policy = loadPolicy()
  const { rows } = evaluate(profileDir, policy)
  const ins = rows.find((r) => r.name === 'inserted')
  grant(policy, 'inserted', { version: ins.version, hash: ins.hash, caps: ins.caps })
  savePolicy(policy)
  const before = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8')).dsh.profile.bundles
  apply(profileDir, { write: true, confirm: true })
  const after = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8')).dsh.profile.bundles
  assert.deepEqual(after, before)
  revert(profileDir)
  const restored = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8')).dsh.profile.bundles
  assert.deepEqual(restored, before)
})

check('apply 写入 managed disable，revert 删除补丁', () => {
  const policy = loadPolicy()
  revoke(policy, 'inserted')
  savePolicy(policy)
  const result = apply(profileDir, { write: true, confirm: true })
  assert.deepEqual(result.disable, [{ id: 'inserted', plugin: 'inserted' }])
  const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8')
  assert.ok(patch.includes('- id: inserted'))
  assert.ok(patch.includes('disabled: true'))
  revert(profileDir)
  assert.equal(fs.existsSync(path.join(profileDir, 'cordis.patch.yml')), false)
  const bundles = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8')).dsh.profile.bundles
  assert.deepEqual(bundles, ['@deepseek-ai/core', 'meta', 'plain'])
})

check('内容哈希随文件变化', () => {
  const dir = path.join(nm, 'plain')
  const h1 = contentHash(dir)
  fs.writeFileSync(path.join(dir, 'extra.js'), 'export default 1\n')
  const h2 = contentHash(dir)
  assert.notEqual(h1, h2)
})

check('markUsed 记录使用，prune 吊销长期未用', () => {
  const policy = loadPolicy()
  policy.plugins.plain = {
    decision: 'allow',
    grants: [{ cap: 'fs.read', scope: 'C:/x', grantedAt: new Date(0).toISOString(), lastUsedAt: null }],
  }
  assert.equal(markUsed(policy, 'plain', 'fs.read', 'C:/x'), true)
  assert.ok(policy.plugins.plain.grants[0].lastUsedAt)
  policy.plugins.plain.grants[0].lastUsedAt = null
  policy.plugins.plain.grants[0].grantedAt = new Date(0).toISOString()
  const removed = prune(policy, { days: 30 })
  assert.equal(removed.length, 1)
  assert.equal(policy.plugins.plain.grants.length, 0)
})

check('confused deputy：A 的授权不作用于 B', () => {
  const policy = loadPolicy()
  policy.plugins.A = { decision: 'allow', grants: [{ cap: 'fs.read', scope: 'C:/x' }] }
  assert.equal(decide(policy.plugins.A, 'fs.read', 'C:/x'), 'allow')
  assert.equal(decide(policy.plugins.B, 'fs.read', 'C:/x'), 'prompt')
})

console.log('\n' + passed + ' checks passed')
fs.rmSync(tmp, { recursive: true, force: true })

