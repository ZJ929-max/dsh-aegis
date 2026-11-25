import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { scopeMatches } from './capabilities.mjs'

export function dshHome () {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : path.join(os.homedir(), '.dsh')
}

export function aegisRoot () { return path.join(dshHome(), 'aegis') }
export function policyPath () { return path.join(aegisRoot(), 'policy.json') }
export function auditPath () { return path.join(aegisRoot(), 'audit.jsonl') }
export function backupsDir () { return path.join(aegisRoot(), 'backups') }

export function sha (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function emptyPolicy () {
  return { version: 1, plugins: {}, chain: { prev: null, hash: null } }
}

export function loadPolicy (file = policyPath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed.plugins || typeof parsed.plugins !== 'object') return emptyPolicy()
    return parsed
  } catch {
    return emptyPolicy()
  }
}

export function savePolicy (policy, file = policyPath()) {
  const payload = JSON.stringify({ version: policy.version, plugins: policy.plugins })
  policy.chain = { prev: policy.chain?.hash ?? null, hash: sha(payload + (policy.chain?.hash ?? '')) }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(policy, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
  return policy
}

export function audit (event, file = auditPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let prev = null
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    if (lines.length && lines[lines.length - 1]) prev = JSON.parse(lines[lines.length - 1]).hash
  } catch {}
  const rec = { at: new Date().toISOString(), prev, ...event }
  rec.hash = sha(JSON.stringify(rec))
  fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf8')
  return rec
}

export function grant (policy, name, { version, hash, caps, scopes, lifetime = 'always' }) {
  policy.plugins[name] = {
    version: String(version ?? '?'),
    hash: String(hash ?? ''),
    decision: 'allow',
    grants: (caps ?? []).map((cap) => ({
      cap,
      scope: scopes?.[cap] ?? '*',
      lifetime,
      grantedAt: new Date().toISOString(),
      grantedBy: 'user',
      lastUsedAt: null,
      useCount: 0,
    })),
    updatedAt: new Date().toISOString(),
  }
  return policy.plugins[name]
}

export function revoke (policy, name) {
  policy.plugins[name] = {
    ...(policy.plugins[name] ?? {}),
    decision: 'deny',
    grants: [],
    updatedAt: new Date().toISOString(),
  }
  return policy.plugins[name]
}

export function decide (rec, cap, scope) {
  if (!rec) return 'prompt'
  if (rec.decision === 'deny') return 'deny'
  if (rec.decision !== 'allow') return 'prompt'
  const hit = (rec.grants ?? []).find((g) => g.cap === cap && scopeMatches(g.scope, scope))
  return hit ? 'allow' : 'prompt'
}

export function markUsed (policy, name, cap, scope) {
  const rec = policy.plugins[name]
  if (!rec || rec.decision !== 'allow') return false
  const hit = (rec.grants ?? []).find((g) => g.cap === cap && scopeMatches(g.scope, scope))
  if (!hit) return false
  hit.lastUsedAt = new Date().toISOString()
  hit.useCount = (hit.useCount ?? 0) + 1
  return true
}

/** Revoke grants that have not been used for the given number of days. */
export function prune (policy, { days = 30, now = Date.now() } = {}) {
  const cutoff = now - Math.max(0, days) * 86400000
  const removed = []
  for (const [name, rec] of Object.entries(policy.plugins)) {
    if (!Array.isArray(rec.grants)) continue
    const keep = []
    for (const g of rec.grants) {
      const stamp = g.lastUsedAt ?? g.grantedAt
      const at = Date.parse(stamp ?? '')
      if (!Number.isFinite(at) || at >= cutoff) keep.push(g)
      else removed.push({ plugin: name, cap: g.cap, scope: g.scope, lastUsedAt: g.lastUsedAt, grantedAt: g.grantedAt })
    }
    rec.grants = keep
  }
  return removed
}

export function summary (policy = loadPolicy()) {
  const plugins = Object.values(policy.plugins)
  return {
    plugins: plugins.length,
    allow: plugins.filter((p) => p.decision === 'allow').length,
    deny: plugins.filter((p) => p.decision === 'deny').length,
    grants: plugins.reduce((n, p) => n + (p.grants?.length ?? 0), 0),
    used: plugins.reduce((n, p) => n + (p.grants ?? []).filter((g) => g.lastUsedAt).length, 0),
  }
}

export function verifyChain (file = policyPath()) {
  const policy = loadPolicy(file)
  const payload = JSON.stringify({ version: policy.version, plugins: policy.plugins })
  const expected = sha(payload + (policy.chain?.prev ?? ''))
  return { ok: policy.chain?.hash === expected, expected, actual: policy.chain?.hash ?? null }
}
