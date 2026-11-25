/**
 * dsh-aegis-bootstrap — Phase 2.
 *
 * Reads one or more Cell descriptors (config.cells, a cells.json file, or the
 * legacy config.pluginPath), starts zero-permission Cell children, registers
 * proxy tools, and forwards invokes + capability requests to the Broker.
 */
import { fork } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHome, loadPolicy, savePolicy, decide, audit, markUsed, prune } from '../lib/policy.mjs'
import { createRequest, waitDecision } from '../lib/approvals.mjs'
import { ensureStateServer } from '../lib/state-server.mjs'

export const name = 'dsh-aegis-bootstrap'
export const inject = ['tools']

const here = path.dirname(fileURLToPath(import.meta.url))
const active = new Set()
process.once('exit', () => { for (const dispose of active) { try { dispose() } catch {} } })

function readCellsFile (file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const rows = Array.isArray(parsed) ? parsed : parsed.cells
    return Array.isArray(rows) ? rows : []
  } catch { return [] }
}

function resolveCells (config) {
  if (Array.isArray(config.cells) && config.cells.length > 0) return config.cells
  const file = config.cellsFile ?? path.join(dshHome(), 'aegis', 'cells.json')
  if (fs.existsSync(file)) {
    const rows = readCellsFile(file)
    if (rows.length > 0) return rows
  }
  const legacy = config.pluginPath ?? process.env.AEGIS_PLUGIN
  return legacy ? [{ pluginPath: legacy, pluginId: config.pluginId ?? 'unknown', selfTest: config.selfTest === true }] : []
}

function resolvePluginPath (value) {
  const raw = String(value ?? '')
  if (!raw) return null
  if (fs.existsSync(raw)) return path.resolve(raw)
  return null
}

function startCell (ctx, descriptor) {
  const pluginPath = resolvePluginPath(descriptor.pluginPath)
  if (!pluginPath) {
    console.error('[aegis] cell skipped: plugin path not found: ' + String(descriptor.pluginPath))
    return null
  }
  const pluginId = String(descriptor.pluginId ?? descriptor.name ?? 'unknown')
  const selfTest = descriptor.selfTest === true
  const cellEntry = path.join(here, 'cell-host.mjs')
  const pluginDir = path.dirname(pluginPath)
  const allow = [here, pluginDir]
  try { allow.push(fs.realpathSync(pluginDir)) } catch {}
  for (const extra of descriptor.extraRead ?? []) {
    try { allow.push(fs.realpathSync(extra)) } catch { allow.push(extra) }
  }

  const env = {
    AEGIS_PLUGIN: pluginId,
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  }
  const child = fork(cellEntry, [pluginPath], {
    execArgv: ['--permission', ...allow.map((d) => '--allow-fs-read=' + d)],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env,
  })
  console.log('[aegis] cell started ' + pluginId + ' ← ' + pluginPath)

  const tools = new Map()
  const pending = new Map()
  const sessionGrants = new Set()
  let seq = 0

  const dispose = () => {
    active.delete(dispose)
    try { child.kill() } catch {}
  }
  active.add(dispose)

  const invoke = (toolName, args) => {
    console.log('[aegis] invoke ' + pluginId + '.' + toolName)
    return new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      child.send({ type: 'invoke', id, name: toolName, args })
    })
  }

  child.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'register') {
      console.log('[aegis] registered ' + pluginId + '.' + msg.tool.name)
      tools.set(msg.tool.name, msg.tool)
      try {
        ctx.tools.register({
          name: msg.tool.name,
          description: msg.tool.description ?? '',
          parameters: msg.tool.parameters ?? { type: 'object', properties: {} },
          output: {
            schema: {},
            render (_args, value) {
              const text = typeof value === 'string' ? value : JSON.stringify(value)
              return [{ type: 'text', text }]
            },
          },
          execute: (args) => invoke(msg.tool.name, args),
        })
      } catch (error) {
        console.error('[aegis] tool register failed ' + msg.tool.name + ': ' + error.message)
      }
      if (selfTest && msg.tool.name === 'demo_echo') {
        setTimeout(() => {
          const def = ctx.tools.get?.('demo_echo')
          def?.execute?.({ text: 'from-dsh' })
            .then((value) => console.log('[aegis] self-test demo_echo => ' + JSON.stringify(value)))
            .catch((error) => console.log('[aegis] self-test failed: ' + error.message))
        }, 300)
      }
      return
    }
    if (msg.type === 'result') {
      const slot = pending.get(msg.id)
      if (!slot) return
      pending.delete(msg.id)
      if (msg.ok) slot.resolve(msg.value)
      else slot.reject(new Error(msg.error ?? 'cell error'))
      return
    }
    if (msg.type === 'cap') {
      ;(async () => {
        const key = pluginId + '|' + msg.cap + '|' + msg.scope
        let decision = sessionGrants.has(key) ? 'allow' : decide(loadPolicy().plugins[pluginId], msg.cap, msg.scope)
        if (decision === 'prompt') {
          const req = createRequest({ plugin: pluginId, cap: msg.cap, scope: msg.scope, reason: msg.reason })
          const d = await waitDecision(req.id, 60000)
          decision = d.allow ? 'allow' : 'deny'
          audit({ event: 'permission-decision', id: req.id, plugin: pluginId, cap: msg.cap, scope: msg.scope, decision, lifetime: d.lifetime, timedOut: Boolean(d.timedOut) })
          if (d.allow && d.lifetime === 'session') sessionGrants.add(key)
        }
        if (decision === 'allow' && (msg.cap === 'fs.read' || msg.cap === 'fs.write' || msg.cap === 'net')) {
          try {
            let value
            if (msg.cap === 'fs.read') {
              value = fs.readFileSync(msg.scope, 'utf8')
            } else if (msg.cap === 'fs.write') {
              fs.writeFileSync(msg.scope, String(msg.payload?.data ?? ''), 'utf8')
              value = { bytes: String(msg.payload?.data ?? '').length }
            } else {
              const p = msg.payload ?? {}
              const res = await fetch(msg.scope, { method: p.method ?? 'GET', headers: p.headers, body: p.body ?? undefined })
              value = { status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() }
            }
            const policy = loadPolicy()
            if (markUsed(policy, pluginId, msg.cap, msg.scope)) savePolicy(policy)
            child.send({ type: 'cap-result', id: msg.id, ok: true, value })
          } catch (e) {
            child.send({ type: 'cap-result', id: msg.id, ok: false, code: e.code, error: e.message })
          }
        } else {
          child.send({ type: 'cap-result', id: msg.id, ok: false, code: 'EACCES_PERMISSION', error: 'denied' })
        }
      })().catch((e) => {
        child.send({ type: 'cap-result', id: msg.id, ok: false, code: 'EACCES_PERMISSION', error: e.message })
      })
    }
  })

  return dispose
}

export function apply (ctx, config = {}) {
  const cells = resolveCells(config)
  console.log('[aegis] bootstrap loaded (' + cells.length + ' cell(s))')
  try { ensureStateServer() } catch (error) { console.error('[aegis] state server: ' + error.message) }

  const pruneAfterDays = Number(config.pruneAfterDays ?? 30)
  if (Number.isFinite(pruneAfterDays) && pruneAfterDays > 0) {
    const policy = loadPolicy()
    const removed = prune(policy, { days: pruneAfterDays })
    if (removed.length > 0) {
      savePolicy(policy)
      audit({ event: 'auto-prune', days: pruneAfterDays, removed })
      console.log('[aegis] auto-pruned ' + removed.length + ' unused grant(s)')
    }
  }

  const disposers = []
  for (const cell of cells) {
    const dispose = startCell(ctx, cell)
    if (dispose) disposers.push(dispose)
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => { for (const dispose of disposers) { try { dispose() } catch {} } })
  }
}
