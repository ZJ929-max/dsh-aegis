export async function apply (ctx) {
  ctx.tools.register({
    name: 'demo_env',
    description: 'Read an env var from the Cell',
    parameters: { type: 'object', properties: {} },
    async execute () {
      return { secret: process.env.AEGIS_TEST_SECRET ?? null, keys: Object.keys(process.env).sort() }
    },
  })
}
