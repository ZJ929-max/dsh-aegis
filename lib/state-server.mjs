import http from 'node:http'
import fs from 'node:fs'
import { auditPath, loadPolicy } from './policy.mjs'
import { listPending } from './approvals.mjs'
import { startUi } from './ui.mjs'

const PORT = 47812
let stateServer = null
let uiPromise = null

function cors (req, res) {
  const origin = String(req.headers.origin ?? '')
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'origin')
  }
  res.setHeader('cache-control', 'no-store')
}

function grantsOf (policy) {
  const rows = []
  for (const [plugin, rec] of Object.entries(policy.plugins ?? {})) {
    for (const g of rec.grants ?? []) rows.push({ plugin, cap: g.cap, scope: g.scope, lastUsedAt: g.lastUsedAt, useCount: g.useCount })
  }
  return rows
}

function auditTail (limit = 20) {
  try {
    const lines = fs.readFileSync(auditPath(), 'utf8').trim().split('\n')
    return lines.slice(-limit).map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

export function ensureStateServer () {
  if (stateServer) return stateServer
  stateServer = http.createServer((req, res) => {
    cors(req, res)
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/state') {
      const policy = loadPolicy()
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ pending: listPending(), grants: grantsOf(policy), audit: auditTail() }))
      return
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      uiPromise ??= startUi({ port: 0, timeoutMs: 60 * 60 * 1000 })
      uiPromise.then((ui) => {
        res.writeHead(302, { location: ui.url })
        res.end()
      }).catch((error) => {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('Aegis UI unavailable: ' + error.message)
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/url') {
      uiPromise ??= startUi({ port: 0, timeoutMs: 60 * 60 * 1000 })
      uiPromise.then((ui) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ url: ui.url }))
      }).catch((error) => {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: error.message }))
      })
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })
  stateServer.on('error', (error) => {
    console.error('[aegis] state server failed on ' + PORT + ': ' + error.message)
    stateServer = null
  })
  stateServer.listen(PORT, '127.0.0.1', () => {
    console.log('[aegis] state server http://127.0.0.1:' + PORT)
  })
  return stateServer
}
