import fs from 'node:fs'
import { walkCode } from './resolve.mjs'

const RULES = [
  ['exec', /child_process|\bspawn(Sync)?\s*\(|\bexec(Sync|File)?\s*\(/],
  ['net', /\bnet\b|\bhttp2?\b|\bhttps\b|\bdgram\b|\btls\b|\bfetch\s*\(|undici/],
  ['fs', /(require\(|from\s+)['"](?:node:)?fs(?:\/promises)?['"]/],
  ['env', /process\.env/],
  ['dynamic', /\beval\s*\(|new\s+Function\s*\(|\bimport\s*\(/],
  ['native', /\.node['"]/],
]

export function scanPackage (dir) {
  const files = walkCode(dir)
  const hits = new Set()
  let bytes = 0
  for (const file of files) {
    let text = ''
    try {
      const stat = fs.statSync(file)
      if (stat.size > 2_000_000) continue
      text = fs.readFileSync(file, 'utf8')
    } catch { continue }
    bytes += text.length
    for (const [cap, re] of RULES) if (re.test(text)) hits.add(cap)
  }
  let pkg = {}
  try { pkg = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')) } catch {}
  const scripts = pkg.scripts ?? {}
  if (['preinstall', 'install', 'postinstall', 'prepare'].some((k) => scripts[k])) hits.add('exec')
  return { caps: [...hits].sort(), files: files.length, bytes, scripts: Object.keys(scripts) }
}
