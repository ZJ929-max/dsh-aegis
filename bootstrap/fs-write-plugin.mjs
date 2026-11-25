import fs from 'node:fs'

export async function apply (ctx) {
  ctx.tools.register({
    name: 'demo_fs_write',
    description: 'Write a file with the unmodified fs.promises.writeFile',
    parameters: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } } },
    async execute (args) {
      await fs.promises.writeFile(args.path, args.text, 'utf8')
      return { ok: true }
    },
  })
}
