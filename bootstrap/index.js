/**
 * dsh-aegis-bootstrap — Phase 2 prototype.
 *
 * Reads a cell descriptor, starts a zero-permission Cell child, registers proxy
 * tools in the DSH tool registry, and forwards invokes + capability requests.
 * The Cell never does real I/O: the Broker (this process) executes fs reads.
 */
import { fork } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPolicy, savePolicy, decide, audit, markUsed, prune } from '../lib/policy.mjs'
import { createRequest, waitDecision } from '../lib/approvals.mjs'

export const name = 'dsh-aegis-bootstrap'
export const inject = ['tools']

const here = path.dirname(fileURLToPath(import.meta.url))

export function apply (ctx, config = {}) {
  const pluginPath = config.pluginPath ?? process.env.AEGIS_PLUGIN
  console.log('[aegis] bootstrap loaded (cell plugin=' + (pluginPath ?? 'none') + ')')

  // Lifecycle: drop grants unused for N days whenever DSH starts. No scheduler,
  // no service; the policy file is the only state.
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
  if (!pluginPath) return
  const pluginId = config.pluginId ?? 'unknown'
  const selfTest = config.selfTest === true
  const cellEntry = path.join(here, 'cell-host.mjs')
  const pluginDir = path.dirname(path.resolve(pluginPath))
  const allow = [here, pluginDir]
  try { allow.push(fs.realpathSync(pluginDir)) } catch {}
  for (const extra of config.extraRead ?? []) {
    try { allow.push(fs.realpathSync(extra)) } catch { allow.push(extra) }
  }

  // Minimal environment: no DEEPSEEK_API_KEY, no proxy tokens, no user secrets.
  const env = {
    AEGIS_PLUGIN: pluginId,
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  }
  const child = fork(cellEntry, [path.resolve(pluginPath)], {
    execArgv: ['--permission', ...allow.map((d) => '--allow-fs-read=' + d)],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env,
  })

  const tools = new Map()
  const pending = new Map()
  const sessionGrants = new Set()
  let seq = 0

  const dispose = () => { try { child.kill() } catch {} }
  if (typeof ctx.effect === 'function') ctx.effect(() => () => dispose())
  // Safety net for an abrupt DSH exit: the Cell is a child, never a service.
  process.once('exit', dispose)

  const invoke = (toolName, args) => {
    console.log('[aegis] invoke ' + toolName)
    return new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      child.send({ type: 'invoke', id, name: toolName, args })
    })
  }

  child.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'register') {
      console.log('[aegis] registered cell tool ' + msg.tool.name)
      tools.set(msg.tool.name, msg.tool)
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
          // lifetime 'always' is persisted by resolveRequest(); 'once' applies to this call only.
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
}
