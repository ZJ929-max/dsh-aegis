import { addExternal, loadExternal, verifyExternal, runExternal, probeBackends } from './external.mjs'

export function externalCommand (args) {
  const sub = args[0]
  if (sub === 'add') {
    const name = args[1]
    const exe = args[2]
    if (!name || !exe) throw new Error('usage: external add <name> <exe> [--caps a,b] [--args --version,--help]')
    const capsArg = args.includes('--caps') ? args[args.indexOf('--caps') + 1] : ''
    const argsArg = args.includes('--args') ? args[args.indexOf('--args') + 1] : ''
    const rec = addExternal(name, exe, {
      caps: capsArg ? capsArg.split(',').map((s) => s.trim()).filter(Boolean) : [],
      argsAllow: argsArg ? argsArg.split(',').map((s) => s.trim()).filter(Boolean) : [],
    })
    console.log('registered ' + name + ' ' + rec.sha256.slice(0, 16) + '…')
    return
  }
  if (sub === 'list') {
    const tools = loadExternal().tools
    const names = Object.keys(tools)
    if (!names.length) { console.log('no external tools registered'); return }
    for (const name of names) {
      const t = tools[name]
      const v = verifyExternal(name)
      console.log(name + '  ' + t.exe + '  ' + (v.ok ? 'verified' : 'HASH ' + v.reason) + '  caps=' + (t.caps.join(',') || '-'))
    }
    return
  }
  if (sub === 'verify') {
    const name = args[1]
    if (!name) throw new Error('usage: external verify <name>')
    const v = verifyExternal(name)
    console.log(JSON.stringify(v, null, 2))
    if (!v.ok) process.exitCode = 1
    return
  }
  if (sub === 'run') {
    const name = args[1]
    if (!name) throw new Error('usage: external run <name> [args...]')
    const result = runExternal(name, args.slice(2))
    if (!result.ok) {
      console.error('REFUSED [' + result.code + ']: ' + result.reason)
      process.exitCode = 3
      return
    }
    console.log(JSON.stringify(result))
    return
  }
  if (sub === 'backends') {
    console.log(JSON.stringify({ backends: probeBackends() }, null, 2))
    return
  }
  throw new Error('usage: external add|list|verify|run|backends')
}
