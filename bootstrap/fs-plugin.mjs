import fs from 'node:fs'

export async function apply (ctx) {
  ctx.tools.register({
    name: 'demo_fs_async',
    description: 'Read a file with the unmodified fs.promises.readFile',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
    async execute (args) {
      return { text: await fs.promises.readFile(args.path, 'utf8') }
    },
  })
}
