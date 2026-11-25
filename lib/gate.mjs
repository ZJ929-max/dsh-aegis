import fs from 'node:fs'
import path from 'node:path'
import { resolveProfile, readJson, contentHash } from './resolve.mjs'
import { scanPackage } from './scan.mjs'
import { loadPolicy, audit, backupsDir } from './policy.mjs'

const BEGIN = '# >>> aegis managed disables >>>'
const END = '# <<< aegis managed disables <<<'

export function evaluate (profileDir, policy = loadPolicy()) {
  const { profile, bundles, entries } = resolveProfile(profileDir)
  const rows = entries.map((entry) => {
    if (entry.core) return { ...entry, decision: 'core', reason: 'app TCB', caps: [], version: null, hash: null }
    if (!entry.dir) return { ...entry, decision: 'missing', reason: 'package dir not found', caps: [], version: null, hash: null }
    let pkg = {}
    try { pkg = readJson(path.join(entry.dir, 'package.json')) } catch {}
    const hash = contentHash(entry.dir)
    const scan = scanPackage(entry.dir)
    const rec = policy.plugins[entry.name]
    let decision = 'pending'
    let reason = 'not reviewed'
    if (rec) {
      if (rec.hash !== hash || rec.version !== pkg.version) reason = 'content or version changed'
      else if (rec.decision === 'allow') { decision = 'allow'; reason = 'granted' }
      else if (rec.decision === 'deny') { decision = 'deny'; reason = 'revoked' }
    }
    return { ...entry, version: pkg.version ?? '?', hash, caps: scan.caps, scan, decision, reason }
  })
  return { profile, bundles, rows }
}

export function planApply (profileDir, policy = loadPolicy()) {
  const { profile, bundles, rows } = evaluate(profileDir, policy)
  const byName = new Map(rows.map((row) => [row.name, row]))
  const keep = []
  const drop = []
  const disable = []
  const blockers = []
  for (const bundle of bundles) {
    const row = byName.get(bundle)
    const inserts = rows.filter((r) => r.sources.includes('insert:' + bundle))
    const bad = inserts.filter((r) => r.decision !== 'core' && r.decision !== 'allow')
    if (row?.decision === 'core' || row?.decision === 'allow') {
      keep.push(bundle)
      for (const ins of bad) {
        if (ins.insertId) disable.push({ id: ins.insertId, plugin: ins.name })
        else blockers.push({ name: ins.name, reason: 'insert has no stable id' })
      }
    } else {
      drop.push({ bundle, reason: row?.reason ?? 'not resolved' })
    }
  }
  for (const row of rows) {
    if (row.sources.includes('profile-patch') && row.decision !== 'core' && row.decision !== 'allow') {
      blockers.push({ name: row.name, reason: 'profile-patch insert is not approved' })
    }
  }
  return { profile, keep, drop, disable, blockers }
}

function managedDisables (disable) {
  if (!disable.length) return ''
  const lines = [BEGIN]
  for (const d of disable) lines.push('- id: ' + d.id, '  disabled: true')
  lines.push(END)
  return lines.join('\n') + '\n'
}

function writePatch (profileDir, disable) {
  const file = path.join(profileDir, 'cordis.patch.yml')
  const existed = fs.existsSync(file)
  let text = existed ? fs.readFileSync(file, 'utf8') : ''
  text = text.replace(new RegExp(BEGIN + '[\\s\\S]*?' + END + '\\n?'), '')
  const block = managedDisables(disable)
  if (block) text = text.replace(/\s*$/, '') + '\n' + block
  if (text.trim() === '') {
    if (existed) fs.unlinkSync(file)
  } else {
    fs.writeFileSync(file, text, 'utf8')
  }
}

export function apply (profileDir, { write = false, confirm = false } = {}) {
  const { profile, keep, drop, disable, blockers } = planApply(profileDir)
  if (!write) return { profile, keep, drop, disable, blockers, written: false }
  if (!confirm) throw new Error('apply --write requires --i-understand')
  if (blockers.length) throw new Error('blockers: ' + blockers.map((b) => b.name).join(', '))
  const pkgPath = path.join(profileDir, 'package.json')
  const patchPath = path.join(profileDir, 'cordis.patch.yml')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(backupsDir(), stamp)
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(pkgPath, path.join(dir, 'package.json'))
  const patchExisted = fs.existsSync(patchPath)
  if (patchExisted) fs.copyFileSync(patchPath, path.join(dir, 'cordis.patch.yml'))
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ patchExisted }, null, 2) + '\n', 'utf8')
  const next = {
    ...profile,
    dsh: { ...profile.dsh, profile: { ...profile.dsh.profile, bundles: keep } },
  }
  fs.writeFileSync(pkgPath + '.tmp', JSON.stringify(next, null, 2) + '\n', 'utf8')
  fs.renameSync(pkgPath + '.tmp', pkgPath)
  writePatch(profileDir, disable)
  audit({ event: 'apply', profile: profileDir, keep, drop: drop.map((d) => d.bundle), disable })
  return { profile, keep, drop, disable, blockers, written: true, backup: dir }
}

export function revert (profileDir) {
  const root = backupsDir()
  const stamps = fs.existsSync(root) ? fs.readdirSync(root).sort() : []
  if (stamps.length === 0) throw new Error('no backup')
  const dir = path.join(root, stamps[stamps.length - 1])
  fs.copyFileSync(path.join(dir, 'package.json'), path.join(profileDir, 'package.json'))
  const patchPath = path.join(profileDir, 'cordis.patch.yml')
  let meta = { patchExisted: false }
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) } catch {}
  if (meta.patchExisted && fs.existsSync(path.join(dir, 'cordis.patch.yml'))) {
    fs.copyFileSync(path.join(dir, 'cordis.patch.yml'), patchPath)
  } else {
    try { fs.unlinkSync(patchPath) } catch {}
  }
  audit({ event: 'revert', profile: profileDir, backup: dir })
  return { restored: dir }
}
