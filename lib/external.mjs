import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { aegisRoot, audit } from './policy.mjs'

export function externalPath () { return path.join(aegisRoot(), 'external.json') }

export function loadExternal () {
  try {
    const parsed = JSON.parse(fs.readFileSync(externalPath(), 'utf8'))
    return parsed && parsed.tools ? parsed : { version: 1, tools: {} }
  } catch { return { version: 1, tools: {} } }
}

export function saveExternal (data) {
  fs.mkdirSync(path.dirname(externalPath()), { recursive: true })
  const tmp = externalPath() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, externalPath())
}

export function fileHash (file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function addExternal (name, exe, { caps = [], argsAllow = [] } = {}) {
  const abs = path.resolve(exe)
  if (!fs.existsSync(abs)) throw new Error('executable not found: ' + abs)
  const data = loadExternal()
  data.tools[name] = {
    exe: abs,
    sha256: fileHash(abs),
    caps,
    argsAllow,
    addedAt: new Date().toISOString(),
  }
  saveExternal(data)
  audit({ event: 'external-add', name, exe: abs, sha256: data.tools[name].sha256, caps })
  return data.tools[name]
}

export function verifyExternal (name) {
  const rec = loadExternal().tools[name]
  if (!rec) return { ok: false, reason: 'not registered' }
  if (!fs.existsSync(rec.exe)) return { ok: false, reason: 'missing executable' }
  const actual = fileHash(rec.exe)
  return { ok: actual === rec.sha256, expected: rec.sha256, actual, reason: actual === rec.sha256 ? 'hash matches' : 'hash mismatch' }
}

/** Probe for an OS-level sandbox that can be destroyed after use. */
export function probeBackends () {
  const backends = []
  try {
    if (fs.existsSync('C:\\Windows\\System32\\WindowsSandbox.exe')) backends.push('windows-sandbox')
  } catch {}
  try {
    const out = execFileSync('wsl.exe', ['-l', '-q'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
    if (out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length > 0) backends.push('wsl')
  } catch {}
  return backends
}

/**
 * Deliberately refuses to execute a native binary unless a disposable OS
 * sandbox backend is available. Node's --permission cannot restrict a native
 * child's syscalls, so process-level wrapping is not enough.
 */
export function runExternal (name, args = []) {
  const verified = verifyExternal(name)
  if (!verified.ok) return { ok: false, code: 'UNVERIFIED', reason: verified.reason }
  const rec = loadExternal().tools[name]
  if (rec.argsAllow.length && !rec.argsAllow.some((a) => args[0] === a)) {
    return { ok: false, code: 'ARG_NOT_ALLOWED', reason: 'argument not in allowlist: ' + (args[0] ?? '(none)') }
  }
  const backends = probeBackends()
  if (backends.length === 0) {
    return {
      ok: false,
      code: 'NO_SANDBOX',
      reason: 'no disposable OS sandbox available (Windows Sandbox / WSL); refuse to run a native binary unsandboxed',
    }
  }
  return { ok: false, code: 'RUNNER_NOT_IMPLEMENTED', reason: 'sandbox backend present (' + backends.join(',') + ') but runner is not implemented yet', backends }
}
