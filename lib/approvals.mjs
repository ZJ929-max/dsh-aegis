import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { aegisRoot, loadPolicy, savePolicy, grant, audit } from './policy.mjs'

export function pendingDir () { return path.join(aegisRoot(), 'pending') }
export function decisionsDir () { return path.join(aegisRoot(), 'decisions') }

export function createRequest ({ plugin, cap, scope, reason = '', timeoutMs = 60000 }) {
  const id = crypto.randomUUID()
  const rec = {
    id, plugin, cap, scope,
    reason: String(reason).slice(0, 300),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
  }
  fs.mkdirSync(pendingDir(), { recursive: true })
  fs.writeFileSync(path.join(pendingDir(), id + '.json'), JSON.stringify(rec, null, 2) + '\n', 'utf8')
  audit({ event: 'permission-request', id, plugin, cap, scope })
  return rec
}

export function listPending () {
  try {
    const now = Date.now()
    const rows = fs.readdirSync(pendingDir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ file: f, rec: JSON.parse(fs.readFileSync(path.join(pendingDir(), f), 'utf8')) }))
    const live = []
    for (const { file, rec } of rows) {
      if (rec.expiresAt && Date.parse(rec.expiresAt) <= now) {
        try { fs.unlinkSync(path.join(pendingDir(), file)) } catch {}
        continue
      }
      live.push(rec)
    }
    return live
  } catch { return [] }
}

export function readDecision (id) {
  try { return JSON.parse(fs.readFileSync(path.join(decisionsDir(), id + '.json'), 'utf8')) } catch { return null }
}

export function resolveRequest (id, { allow, lifetime = 'always' } = {}) {
  const req = listPending().find((r) => r.id === id)
  if (!req) throw new Error('no pending request ' + id)
  if (allow) {
    if (lifetime === 'always') {
      const policy = loadPolicy()
      const rec = policy.plugins[req.plugin]
      const caps = new Set(rec?.grants?.map((g) => g.cap) ?? [])
      caps.add(req.cap)
      const scopes = {}
      for (const g of rec?.grants ?? []) scopes[g.cap] = g.scope
      scopes[req.cap] = req.scope
      grant(policy, req.plugin, {
        version: rec?.version ?? 'runtime',
        hash: rec?.hash ?? 'runtime',
        caps: [...caps],
        scopes,
        lifetime: 'always',
      })
      savePolicy(policy)
    }
  }
  const decision = { id, allow: Boolean(allow), lifetime, decidedAt: new Date().toISOString() }
  fs.mkdirSync(decisionsDir(), { recursive: true })
  fs.writeFileSync(path.join(decisionsDir(), id + '.json'), JSON.stringify(decision, null, 2) + '\n', 'utf8')
  try { fs.unlinkSync(path.join(pendingDir(), id + '.json')) } catch {}
  audit({ event: allow ? 'permission-allow' : 'permission-deny', id, plugin: req.plugin, cap: req.cap, scope: req.scope, lifetime })
  return decision
}

export async function waitDecision (id, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const d = readDecision(id)
    if (d) return d
    await new Promise((r) => setTimeout(r, 100))
  }
  try { fs.unlinkSync(path.join(pendingDir(), id + '.json')) } catch {}
  return { id, allow: false, lifetime: 'once', timedOut: true }
}
