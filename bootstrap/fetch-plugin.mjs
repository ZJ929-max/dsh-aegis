export async function apply (ctx) {
  ctx.tools.register({
    name: 'demo_fetch',
    description: 'Fetch a URL through the Broker',
    parameters: { type: 'object', properties: { url: { type: 'string' } } },
    async execute (args) {
      const res = await fetch(args.url)
      return { status: res.status, text: await res.text() }
    },
  })
}
