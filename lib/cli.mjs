import path from 'node:path'
import fs from 'node:fs'
import { dshHome, loadPolicy, savePolicy, grant, revoke, audit, verifyChain, prune, summary } from './policy.mjs'
import { listPending } from './approvals.mjs'
import { evaluate, planApply, apply, revert } from './gate.mjs'
import { pendingCommand, approveCommand, denyCommand } from './pending-cli.mjs'
import { externalCommand } from './external-cli.mjs'
import { doctor } from './doctor.mjs'

const args = process.argv.slice(2)
const cmd = args[0] ?? 'scan'
const has = (name) => args.includes('--' + name)
const val = (name, fallback = undefined) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? args[i + 1] : fallback
}
const profileName = val('profile', 'desktop')
const profileDir = path.join(dshHome(), 'profiles', profileName)

function fmt (rows) {
  const width = Math.max(24, ...rows.map((r) => r.name.length))
  for (const row of rows) {
    const caps = row.decision === 'core' ? 'core' : (row.caps.length ? row.caps.join(',') : '-')
    const via = row.sources.filter((s) => s.startsWith('insert:') || s === 'profile-patch')
    console.log(
      row.name.padEnd(width) + ' ' + row.decision.padEnd(8) + '[' + caps + '] ' + row.reason +
      (row.dir || row.decision === 'core' ? '' : ' DIR-MISSING') +
      (via.length ? '  via ' + via.join(' ') : '')
    )
  }
}

function scan () {
  const { rows } = evaluate(profileDir)
  if (has('json')) console.log(JSON.stringify(rows, null, 2))
  else {
    console.log('# Aegis scan · ' + profileName + ' · ' + profileDir)
    fmt(rows)
  }
  return rows
}

function check () {
  const { rows } = evaluate(profileDir)
  const bad = rows.filter((r) => r.decision !== 'core' && r.decision !== 'allow')
  fmt(rows)
  if (bad.length) {
    console.error('\nAegis: ' + bad.length + ' plugin(s) not approved: ' + bad.map((r) => r.name).join(', '))
    process.exitCode = 1
  } else {
    console.log('\nAegis: all plugins approved')
  }
}

function grantCmd () {
  const name = args[1]
  if (!name) throw new Error('usage: grant <pkg> [--caps a,b] [--scope cap=path]')
  const { rows } = evaluate(profileDir)
  const row = rows.find((r) => r.name === name)
  if (!row || !row.dir) throw new Error('not installed: ' + name)
  const policy = loadPolicy()
  const capsArg = val('caps')
  const caps = capsArg ? String(capsArg).split(',').map((s) => s.trim()).filter(Boolean) : row.caps
  const scopes = {}
  const scopeArg = val('scope')
  if (scopeArg) {
    const [cap, ...rest] = String(scopeArg).split('=')
    scopes[cap] = rest.join('=')
  }
  grant(policy, name, { version: row.version, hash: row.hash, caps, scopes })
  savePolicy(policy)
  audit({ event: 'grant', plugin: name, version: row.version, caps, scopes })
  console.log('granted ' + name + ' v' + row.version + ' caps=' + (caps.join(',') || '(none)'))
}

function revokeCmd () {
  const name = args[1]
  if (!name) throw new Error('usage: revoke <pkg>')
  const policy = loadPolicy()
  revoke(policy, name)
  savePolicy(policy)
  audit({ event: 'revoke', plugin: name })
  console.log('revoked ' + name)
}

function applyCmd () {
  const { keep, drop, disable, blockers } = planApply(profileDir)
  console.log('# plan · ' + profileName)
  console.log('keep ' + keep.length + ', drop ' + drop.length + ', disable ' + disable.length + ', blockers ' + blockers.length)
  for (const d of drop) console.log('  drop ' + d.bundle + '  (' + d.reason + ')')
  for (const d of disable) console.log('  disable ' + d.id + '  (' + d.plugin + ')')
  for (const b of blockers) console.log('  BLOCK ' + b.name + '  (' + b.reason + ')')
  if (has('write')) {
    if (!has('i-understand')) throw new Error('add --i-understand to rewrite the profile')
    const result = apply(profileDir, { write: true, confirm: true })
    console.log('wrote ' + path.join(profileDir, 'package.json') + '\nbackup ' + result.backup)
  } else {
    console.log('dry-run only; add --write --i-understand to apply')
  }
}

function revertCmd () {
  const r = revert(profileDir)
  console.log('restored ' + r.restored)
}

function auditCmd () {
  const file = path.join(dshHome(), 'aegis', 'audit.jsonl')
  if (!fs.existsSync(file)) return console.log('no audit log yet')
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  for (const line of lines.slice(-Number(val('tail', 20)))) console.log(line)
}

function pruneCmd () {
  const days = Number(val('unused-days', 30))
  const policy = loadPolicy()
  const removed = prune(policy, { days })
  console.log('unused grants older than ' + days + ' day(s): ' + removed.length)
  for (const r of removed) console.log('  ' + r.plugin + '  ' + r.cap + '  ' + r.scope)
  if (removed.length && has('write')) {
    savePolicy(policy)
    audit({ event: 'prune', days, removed })
    console.log('pruned and saved')
  } else if (removed.length) {
    console.log('dry-run only; add --write')
  }
}

function statusCmd () {
  console.log(JSON.stringify({ ...summary(loadPolicy()), pending: listPending().length }, null, 2))
}

function verifyCmd () {
  const v = verifyChain()
  console.log(JSON.stringify(v, null, 2))
  if (!v.ok) process.exitCode = 1
}

try {
  switch (cmd) {
    case 'scan': scan(); break
    case 'check': check(); break
    case 'grant': grantCmd(); break
    case 'revoke': revokeCmd(); break
    case 'apply': applyCmd(); break
    case 'revert': revertCmd(); break
    case 'audit': auditCmd(); break
    case 'verify': verifyCmd(); break
    case 'pending': pendingCommand(args.slice(1)); break
    case 'approve': approveCommand(args.slice(1)); break
    case 'deny': denyCommand(args.slice(1)); break
    case 'external': externalCommand(args.slice(1)); break
    case 'doctor': {
      const report = doctor(profileName)
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      break
    }
    case 'prune': pruneCmd(); break
    case 'status': statusCmd(); break
    case 'ui': {
      const { startUi } = await import('./ui.mjs')
      const ui = await startUi({ port: Number(val('port', 0)), timeoutMs: Number(val('timeout-seconds', 0)) * 1000 })
      console.log('Aegis UI: ' + ui.url)
      console.log('Ctrl+C to stop.')
      break
    }
    default:
      console.error('usage: aegis scan|check|grant|revoke|apply|revert|audit|verify [--profile desktop]')
      process.exitCode = 2
  }
} catch (error) {
  console.error('aegis: ' + (error instanceof Error ? error.message : String(error)))
  process.exitCode = 2
}
