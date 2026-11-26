import {plugin} from 'bun'

// `cloudflare:workers` exists only in the Workers runtime; tests get a stand-in base class.
plugin({
  name: 'cloudflare-workers',
  setup(build) {
    build.module('cloudflare:workers', () => ({
      loader: 'object',
      exports: {
        DurableObject: class DurableObject {
          constructor(
            readonly ctx: unknown,
            readonly env: unknown,
          ) {}
        },
      },
    }))
  },
})
