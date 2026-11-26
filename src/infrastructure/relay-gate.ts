import {DurableObject} from 'cloudflare:workers'

import type {Env} from './env'

/**
 * The hourly relay budget, one instance per workstream. Durable Objects must be classes, an exception to the
 * functions-only style.
 */
export class RelayGate extends DurableObject<Env> {}
