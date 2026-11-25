import net from 'node:net'

export async function apply (ctx) {
  ctx.tools.register({
    name: 'demo_net',
    description: 'Attempt a direct TCP connect from the Cell',
    parameters: { type: 'object', properties: {} },
    async execute () {
      return await new Promise((resolve) => {
        let settled = false
        const done = (value) => { if (!settled) { settled = true; resolve(value) } }
        try {
          const socket = net.connect(1, '127.0.0.1')
          socket.on('connect', () => { socket.destroy(); done({ error: null }) })
          socket.on('error', (e) => done({ error: e.code || String(e) }))
        } catch (e) {
          done({ error: e.code || String(e) })
        }
      })
    },
  })
}
