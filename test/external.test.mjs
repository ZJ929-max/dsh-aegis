import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-ext-'))
process.env.DSH_HOME = tmp

const { addExternal, verifyExternal, runExternal, probeBackends } = await import('../lib/external.mjs')

const exe = path.join(tmp, 'fake-tool.exe')
fs.writeFileSync(exe, 'not-a-real-binary')

let passed = 0
const check = (label, fn) => {
  try { fn(); passed++; console.log('ok   ' + label) }
  catch (e) { console.log('FAIL ' + label + '\n     ' + e.message); process.exitCode = 1 }
}

check('注册并校验哈希', () => {
  const rec = addExternal('fake', exe, { caps: ['net'], argsAllow: ['--version'] })
  assert.equal(rec.sha256.length, 64)
  assert.equal(verifyExternal('fake').ok, true)
})

check('内容变化后哈希失配', () => {
  fs.appendFileSync(exe, 'tampered')
  const v = verifyExternal('fake')
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'hash mismatch')
})

check('未授权参数直接拒绝', () => {
  const r = runExternal('fake', ['--help'])
  assert.equal(r.ok, false)
  assert.equal(r.code, 'UNVERIFIED') // hash changed first
})

check('恢复哈希后，无沙盒则拒绝执行', () => {
  fs.writeFileSync(exe, 'not-a-real-binary')
  const r = runExternal('fake', ['--version'])
  const backends = probeBackends()
  assert.equal(r.ok, false)
  if (backends.length === 0) assert.equal(r.code, 'NO_SANDBOX')
  else assert.equal(r.code, 'RUNNER_NOT_IMPLEMENTED')
})

check('参数白名单生效', () => {
  const r = runExternal('fake', ['--help'])
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ARG_NOT_ALLOWED')
})

console.log('\n' + passed + ' checks passed')
fs.rmSync(tmp, { recursive: true, force: true })

