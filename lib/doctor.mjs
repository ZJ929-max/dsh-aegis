import fs from 'node:fs'
import path from 'node:path'
import { dshHome, loadPolicy, verifyChain } from './policy.mjs'
import { evaluate } from './gate.mjs'
import { loadExternal, verifyExternal, probeBackends } from './external.mjs'
import { listPending } from './approvals.mjs'

export function doctor (profileName = 'desktop') {
  const profileDir = path.join(dshHome(), 'profiles', profileName)
  const out = { profile: profileName, profileDir, ok: true, issues: [] }
  if (!fs.existsSync(path.join(profileDir, 'package.json'))) {
    out.ok = false
    out.issues.push('profile package.json missing')
    return out
  }
  const rows = evaluate(profileDir).rows
  out.bundles = { core: rows.filter((r) => r.decision === 'core').length, allow: rows.filter((r) => r.decision === 'allow').length, pending: rows.filter((r) => r.decision === 'pending').length, missing: rows.filter((r) => r.decision === 'missing').length, deny: rows.filter((r) => r.decision === 'deny').length }
  const chain = verifyChain()
  out.policyChain = chain
  if (!chain.ok) { out.ok = false; out.issues.push('policy hash chain mismatch') }
  out.pendingRequests = listPending().length
  const ext = loadExternal().tools
  out.external = Object.keys(ext).map((name) => ({ name, ...verifyExternal(name) }))
  for (const e of out.external) if (!e.ok) { out.ok = false; out.issues.push('external hash mismatch: ' + e.name) }
  out.sandboxBackends = probeBackends()
  return out
}
