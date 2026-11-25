import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const CORE = /^@deepseek-ai\//

export function readJson (file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** Parse a Cordis patch YAML subset: every "insert:" block's id/name pairs. */
export function parseInserts (text) {
  const rows = []
  let inInsert = false
  let baseIndent = 0
  let cur = null
  const flush = () => { if (cur && cur.name) rows.push(cur); cur = null }
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '')
    const head = /^(\s*)-?\s*insert:\s*$/.exec(line)
    if (head) {
      inInsert = true
      baseIndent = head[1].length
      continue
    }
    if (!inInsert) continue
    if (line.trim() === '') continue
    const indent = line.match(/^\s*/)[0].length
    if (indent <= baseIndent) { flush(); inInsert = false; continue }
    const idm = /^\s*-\s*id:\s*['"]?([^'"\s]+)['"]?/.exec(line)
    if (idm) { flush(); cur = { id: idm[1], name: null }; continue }
    const nm = /^\s*(?:-\s*)?name:\s*['"]?([^'"\s]+)['"]?/.exec(line)
    if (nm && cur) cur.name = nm[1]
  }
  flush()
  return [...new Map(rows.map((r) => [r.id + '|' + r.name, r])).values()]
}

export function resolvePkgDir (profileDir, name, fromDir) {
  const candidates = [
    path.join(profileDir, 'node_modules', name),
    fromDir ? path.join(fromDir, 'node_modules', name) : null,
  ].filter(Boolean)
  for (const dir of candidates) {
    try {
      if (fs.statSync(path.join(dir, 'package.json')).isFile()) return fs.realpathSync(dir)
    } catch {}
  }
  return null
}

export function resolveProfile (profileDir) {
  const profile = readJson(path.join(profileDir, 'package.json'))
  const bundles = Array.isArray(profile.dsh?.profile?.bundles) ? profile.dsh.profile.bundles : []
  const entries = new Map()

  const add = (name, source, dir, insertId = null) => {
    if (!name) return
    const cur = entries.get(name) ?? { name, sources: [], dir: null, core: CORE.test(name), insertId: null }
    if (!cur.sources.includes(source)) cur.sources.push(source)
    if (dir && !cur.dir) cur.dir = dir
    if (insertId && !cur.insertId) cur.insertId = insertId
    entries.set(name, cur)
  }

  for (const name of bundles) {
    if (CORE.test(name)) { add(name, 'core', null); continue }
    const dir = resolvePkgDir(profileDir, name)
    add(name, 'bundle', dir)
    if (!dir) continue
    let pkg = {}
    try { pkg = readJson(path.join(dir, 'package.json')) } catch { continue }
    const patches = pkg.dsh?.bundle?.patch
    if (!Array.isArray(patches)) continue
    for (const rel of patches) {
      const file = path.resolve(dir, rel)
      let text = ''
      try { text = fs.readFileSync(file, 'utf8') } catch { continue }
      for (const inserted of parseInserts(text)) {
        add(inserted.name, 'insert:' + name, resolvePkgDir(profileDir, inserted.name, dir), inserted.id)
      }
    }
  }

  const profilePatch = path.join(profileDir, 'cordis.patch.yml')
  if (fs.existsSync(profilePatch)) {
    for (const inserted of parseInserts(fs.readFileSync(profilePatch, 'utf8'))) {
      add(inserted.name, 'profile-patch', resolvePkgDir(profileDir, inserted.name), inserted.id)
    }
  }

  return { profile, bundles, entries: [...entries.values()] }
}

export function walkCode (dir, out = []) {
  let items = []
  try { items = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const item of items) {
    if (item.name === 'node_modules' || item.name === '.git' || item.name === 'test' || item.name === 'tests') continue
    const full = path.join(dir, item.name)
    if (item.isDirectory()) walkCode(full, out)
    else if (item.isFile() && /\.(m?js|cjs|ts|node)$/.test(item.name)) out.push(full)
  }
  return out
}

export function contentHash (dir) {
  const files = walkCode(dir).sort()
  const hash = crypto.createHash('sha256')
  for (const file of files) {
    hash.update(path.relative(dir, file).replace(/\\/g, '/'))
    try { hash.update(fs.readFileSync(file)) } catch {}
  }
  return hash.digest('hex')
}
