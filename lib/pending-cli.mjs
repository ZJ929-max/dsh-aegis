import fs from 'node:fs'
import path from 'node:path'
import { aegisRoot, audit } from './policy.mjs'
import { listPending, resolveRequest } from './approvals.mjs'

export function pendingCommand (args) {
  const rows = listPending()
  if (rows.length === 0) { console.log('no pending permission requests'); return }
  for (const r of rows) {
    console.log(r.id + '  ' + r.plugin + '  ' + r.cap + '  ' + r.scope + '  expires ' + r.expiresAt)
  }
}

export function approveCommand (args) {
  const id = args[0]
  if (!id) throw new Error('usage: approve <id> [--once|--session|--always] [--scope <path>]')
  const lifetime = args.includes('--once') ? 'once' : args.includes('--session') ? 'session' : 'always'
  const decision = resolveRequest(id, { allow: true, lifetime })
  console.log('approved ' + id + ' (' + lifetime + ')')
}

export function denyCommand (args) {
  const id = args[0]
  if (!id) throw new Error('usage: deny <id>')
  resolveRequest(id, { allow: false, lifetime: 'once' })
  console.log('denied ' + id)
}
