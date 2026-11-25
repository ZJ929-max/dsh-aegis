import { execFileSync } from 'node:child_process'

export async function apply (ctx) {
  ctx.tools.register({
    name: 'demo_proc',
    description: 'Attempt a direct child process spawn from the Cell',
    parameters: { type: 'object', properties: {} },
    async execute () {
      try {
        execFileSync('cmd', ['/c', 'echo', 'x'], { stdio: 'ignore', timeout: 3000 })
        return { error: null }
      } catch (e) {
        return { error: e.code || String(e) }
      }
    },
  })
}
