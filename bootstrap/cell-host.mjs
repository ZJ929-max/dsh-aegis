/**
 * Cell host: imports the plugin, builds the ctx proxy, forwards tool invokes
 * and capability requests. No ambient fs/net/exec: Node --permission denies.
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'

const pluginPath = process.argv[2]
const pluginId = process.env.AEGIS_PLUGIN ?? 'unknown'

// The Cell is a child of DSH, not a system service: when the parent goes away,
// exit instead of lingering. This is the no-orphan guarantee.
process.on('disconnect', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
const tools = new Map()
const capPending = new Map()
let seq = 0

const request = (cap, scope, payload = null) => new Promise((resolve, reject) => {
  const id = ++seq
  capPending.set(id, { resolve, reject })
  process.send({ type: 'cap', id, cap, scope, payload })
})

// Transparent fetch shim: a plugin's unmodified global fetch() becomes a
// capability request; the Broker performs the real network call.
const nativeFetch = globalThis.fetch
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  const headers = init.headers ? Object.fromEntries(new Headers(init.headers)) : {}
  const result = await request('net', url, {
    method: init.method ?? 'GET',
    headers,
    body: typeof init.body === 'string' ? init.body : null,
  })
  return new Response(result.body, { status: result.status, headers: result.headers })
}
void nativeFetch

// Transparent async fs shim: plugins that use fs.promises.readFile or the
// callback fs.readFile unmodified route through the Broker. Sync reads stay
// denied unless Node's own --allow-fs-read permits the plugin directory.
const nativeReadFilePromise = fs.promises.readFile.bind(fs.promises)
fs.promises.readFile = async (file, options) => {
  if (typeof file !== 'string') return nativeReadFilePromise(file, options)
  const text = await request('fs.read', path.resolve(file))
  const encoding = typeof options === 'string' ? options : options?.encoding
  return encoding ? text : Buffer.from(text)
}
const nativeReadFile = fs.readFile
fs.readFile = (file, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {} }
  if (typeof file !== 'string') return nativeReadFile(file, options, callback)
  request('fs.read', path.resolve(file))
    .then((text) => {
      const encoding = typeof options === 'string' ? options : options?.encoding
      callback?.(null, encoding ? text : Buffer.from(text))
    })
    .catch((error) => callback?.(error))
}

// Transparent async write shim: fs.promises.writeFile / fs.writeFile go to the
// Broker, so a plugin cannot write outside an approved scope.
const nativeWriteFilePromise = fs.promises.writeFile.bind(fs.promises)
fs.promises.writeFile = async (file, data, options) => {
  if (typeof file !== 'string') return nativeWriteFilePromise(file, data, options)
  await request('fs.write', path.resolve(file), { data: String(data) })
}
const nativeWriteFile = fs.writeFile
fs.writeFile = (file, data, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {} }
  if (typeof file !== 'string') return nativeWriteFile(file, data, options, callback)
  request('fs.write', path.resolve(file), { data: String(data) })
    .then(() => callback?.(null))
    .catch((error) => callback?.(error))
}

// Node 24's --permission does not cover net/http/dns, so deny direct network
// access at the module boundary. Plugins must use the fetch shim (Broker) or
// fail closed; a native addon can still bypass this and is documented as residual.
const denyNet = (api) => () => {
  const error = new Error('network access denied by Aegis Cell: ' + api)
  error.code = 'EACCES_PERMISSION'
  throw error
}
for (const key of ['connect', 'createConnection']) net[key] = denyNet('net.' + key)
for (const key of ['request', 'get']) http[key] = denyNet('http.' + key)
for (const key of ['request', 'get']) https[key] = denyNet('https.' + key)
for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6']) dns[key] = denyNet('dns.' + key)

process.on('message', (msg) => {
  if (!msg) return
  if (msg.type === 'cap-result') {
    const slot = capPending.get(msg.id)
    if (!slot) return
    capPending.delete(msg.id)
    if (msg.ok) slot.resolve(msg.value)
    else slot.reject(Object.assign(new Error(msg.error ?? 'denied'), { code: msg.code ?? 'EACCES_PERMISSION' }))
    return
  }
  if (msg.type === 'invoke') {
    ;(async () => {
      try {
        const def = tools.get(msg.name)
        if (!def) throw new Error('unknown tool: ' + msg.name)
        const value = await def.execute(msg.args, { agent: null })
        process.send({ type: 'result', id: msg.id, ok: true, value })
      } catch (e) {
        process.send({ type: 'result', id: msg.id, ok: false, error: e.message })
      }
    })()
  }
})

const ctx = {
  tools: {
    register (def) {
      tools.set(def.name, def)
      process.send({
        type: 'register',
        tool: { name: def.name, description: def.description ?? '', parameters: def.parameters ?? { type: 'object', properties: {} } },
      })
    },
  },
  effect (fn) { if (typeof fn === 'function') fn() },
  logger: { info () {}, warn () {}, error () {} },
  aegis: { request, pluginId },
}

const mod = await import(pathToFileURL(pluginPath).href)
const apply = typeof mod.apply === 'function' ? mod.apply : (typeof mod.default === 'function' ? mod.default : mod.default?.apply)
if (typeof apply !== 'function') throw new Error('plugin has no apply()')
await apply(ctx, {})
