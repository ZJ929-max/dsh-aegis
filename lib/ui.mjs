import http from 'node:http'
import crypto from 'node:crypto'
import { listPending, resolveRequest } from './approvals.mjs'
import { loadPolicy, savePolicy, revoke, audit } from './policy.mjs'

function esc (value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function grantRows (policy) {
  const rows = []
  for (const [name, rec] of Object.entries(policy.plugins ?? {})) {
    for (const g of rec.grants ?? []) rows.push({ plugin: name, cap: g.cap, scope: g.scope, lastUsedAt: g.lastUsedAt })
  }
  return rows
}

function page (token, rows, grants) {
  const cards = rows.map((r) => '<div class="req">' +
    '<div><b>' + esc(r.plugin) + '</b> 请求 <code>' + esc(r.cap) + '</code></div>' +
    '<div>范围：<code>' + esc(r.scope) + '</code></div>' +
    '<div>理由：' + esc(r.reason || '-') + '</div>' +
    '<form method="post" action="/api/decision?token=' + token + '">' +
    '<input type="hidden" name="id" value="' + esc(r.id) + '">' +
    '<input type="hidden" name="allow" value="1">' +
    '<button name="lifetime" value="once">仅本次</button>' +
    '<button name="lifetime" value="session">本会话</button>' +
    '<button name="lifetime" value="always">始终</button>' +
    '</form>' +
    '<form method="post" action="/api/decision?token=' + token + '">' +
    '<input type="hidden" name="id" value="' + esc(r.id) + '">' +
    '<input type="hidden" name="allow" value="0">' +
    '<input type="hidden" name="lifetime" value="once">' +
    '<button>拒绝</button></form>' +
    '</div>').join('')
  return '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3">' +
    '<title>Aegis approvals</title>' +
    '<style>body{font:14px system-ui;margin:2rem;background:#111;color:#eee}button{margin:.2rem;padding:.4rem .7rem}' +
    '.req{border:1px solid #444;border-radius:8px;padding:.8rem;margin:.8rem 0}code{color:#9cf}</style>' +
    '<h1>Aegis · 插件权限申请</h1><p>只监听 127.0.0.1；关闭进程即结束。</p>' +
    (rows.length ? cards : '<p>没有待决申请</p>') +
    '<h2>已授权</h2>' +
    (grants.length
      ? grants.map((g) => '<div class="req"><b>' + esc(g.plugin) + '</b> <code>' + esc(g.cap) + '</code> ' + esc(g.scope) +
        '<form method="post" action="/api/revoke?token=' + token + '"><input type="hidden" name="plugin" value="' + esc(g.plugin) + '"><button>撤销该插件全部授权</button></form></div>').join('')
      : '<p>没有已授权项</p>')
}

export function startUi ({ port = 0, timeoutMs = 0 } = {}) {
  const token = crypto.randomBytes(16).toString('hex')
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.searchParams.get('token') !== token) {
      res.writeHead(403, { 'content-type': 'text/plain' }); res.end('forbidden'); return
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(page(token, listPending(), grantRows(loadPolicy()))); return
    }
    if (req.method === 'GET' && url.pathname === '/api/pending') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(listPending())); return
    }
    if (req.method === 'POST' && url.pathname === '/api/decision') {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        try {
          let id, allow, lifetime
          if ((req.headers['content-type'] || '').includes('application/json')) {
            const parsed = JSON.parse(body); id = parsed.id; allow = parsed.allow; lifetime = parsed.lifetime
          } else {
            const form = new URLSearchParams(body); id = form.get('id'); allow = form.get('allow') === '1'; lifetime = form.get('lifetime')
          }
          const decision = resolveRequest(id, { allow: Boolean(allow), lifetime: lifetime === 'once' || lifetime === 'session' ? lifetime : 'always' })
          if ((req.headers['content-type'] || '').includes('application/json')) {
            res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(decision))
          } else {
            res.writeHead(303, { location: '/?token=' + token }); res.end()
          }
        } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message }))
        }
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/revoke') {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        try {
          let plugin
          if ((req.headers['content-type'] || '').includes('application/json')) plugin = JSON.parse(body).plugin
          else plugin = new URLSearchParams(body).get('plugin')
          const policy = loadPolicy()
          revoke(policy, plugin)
          savePolicy(policy)
          audit({ event: 'revoke', plugin, source: 'ui' })
          res.writeHead(303, { location: '/?token=' + token }); res.end()
        } catch (e) {
          res.writeHead(400); res.end(String(e.message))
        }
      })
      return
    }
    res.writeHead(404); res.end('not found')
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address()
      const base = 'http://127.0.0.1:' + addr.port
      let timer = null
      const close = () => { try { clearTimeout(timer); server.close() } catch {} }
      if (timeoutMs > 0) timer = setTimeout(close, timeoutMs)
      resolve({ url: base + '/?token=' + token, base, token, server, close })
    })
  })
}
