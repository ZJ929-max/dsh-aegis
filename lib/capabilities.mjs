// Aegis capability vocabulary and scope matching.
// One vocabulary shared by CLI, Broker, Cell and external wrappers.

export const CAPS = [
  'fs.read', 'fs.write', 'net', 'exec', 'env', 'native', 'dynamic',
  'tools', 'services', 'sessions', 'schedule', 'desktop', 'clipboard',
]

export const HIGH_RISK = new Set(['exec', 'native', 'secrets', 'desktop', 'schedule'])

export function normPath (p) {
  return String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function scopeMatches (granted, requested) {
  if (!granted || granted === '*') return true
  const g = normPath(granted)
  const r = normPath(requested)
  return g === r || r.startsWith(g + '/')
}

export function normalizeRequest (req) {
  const cap = String(req?.cap ?? '')
  if (!CAPS.includes(cap)) return null
  return {
    cap,
    scope: req?.scope == null ? '*' : String(req.scope),
    reason: typeof req?.reason === 'string' ? req.reason.slice(0, 300) : '',
  }
}
