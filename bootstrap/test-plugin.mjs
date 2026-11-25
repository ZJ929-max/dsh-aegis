export async function apply (ctx) {
  ctx.tools.register({
    name: 'demo_echo',
    description: 'Echo text from a Cell',
    parameters: { type: 'object', properties: { text: { type: 'string' } } },
    async execute (args) { return { text: args?.text ?? '' } },
  })
  ctx.tools.register({
    name: 'demo_read',
    description: 'Read a file through the Broker',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
    async execute (args) { return { text: await ctx.aegis.request('fs.read', args.path) } },
  })
}
