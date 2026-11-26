import {describe, expect, test} from 'bun:test'

import worker from '../src/index'
import {fakeCtx, fakeEnv} from './support/env'

const call = (path: string, method = 'GET') =>
  worker.fetch(new Request(`https://bridge.test${path}`, {method}), fakeEnv(), fakeCtx)

describe('router', () => {
  test.each(['/', '/nope', '/health/extra', '/__proto__', '/constructor'])('unknown path %s → 404', async (path) => {
    const response = await call(path)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ok: false, error: 'not_found'})
  })

  test.each(['POST', 'PUT', 'DELETE'])('%s on /health → 405 with Allow', async (method) => {
    const response = await call('/health', method)
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
    expect(await response.json()).toEqual({ok: false, error: 'method_not_allowed'})
  })

  test('the query string does not change the route', async () => {
    expect((await call('/health?probe=1')).status).toBe(200)
  })
})
