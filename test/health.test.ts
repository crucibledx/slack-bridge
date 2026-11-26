import {describe, expect, test} from 'bun:test'

import worker from '../src/index'
import {fakeCtx, fakeEnv} from './support/env'

const health = (env = fakeEnv()) => worker.fetch(new Request('https://bridge.test/health'), env, fakeCtx)

const relays = (...ws: string[]) => JSON.stringify(Object.fromEntries(ws.map((w) => [w, `https://relay.test/${w}`])))
const relaySecrets = (...ws: string[]) => JSON.stringify(Object.fromEntries(ws.map((w) => [w, `fake-${w}-secret`])))

describe('GET /health', () => {
  test('200 with valid config', async () => {
    const response = await health()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ok: true})
  })

  test('200 with an optional relay that no channel uses', async () => {
    const env = fakeEnv({
      RELAY_URLS: relays('root', 'forge', 'other'),
      RELAY_SECRETS: relaySecrets('root', 'forge', 'other'),
    })
    expect((await health(env)).status).toBe(200)
  })

  const invalid: [string, Parameters<typeof fakeEnv>[0], string][] = [
    ['missing signing secret', {SLACK_SIGNING_SECRET: undefined}, 'SLACK_SIGNING_SECRET'],
    ['empty signing secret', {SLACK_SIGNING_SECRET: ''}, 'SLACK_SIGNING_SECRET'],
    ['bot token without xoxb-', {SLACK_BOT_TOKEN: 'fake-user-token-value'}, 'SLACK_BOT_TOKEN'],
    ['channel map not JSON', {CHANNEL_MAP: 'fake-not-json-value'}, 'CHANNEL_MAP'],
    ['channel map is an array', {CHANNEL_MAP: '["C000TEST"]'}, 'CHANNEL_MAP'],
    ['channel map with an unknown workstream', {CHANNEL_MAP: '{"C000TEST":"root","C000TEST2":"sales"}'}, 'CHANNEL_MAP'],
    ['channel map with no channel mapped to root', {CHANNEL_MAP: '{"C000TEST":"forge"}'}, 'CHANNEL_MAP'],
    [
      'missing root relay',
      {RELAY_URLS: relays('forge'), RELAY_SECRETS: relaySecrets('forge'), CHANNEL_MAP: '{"C000TEST":"root"}'},
      'RELAY_URLS',
    ],
    ['channel map workstream without a relay', {CHANNEL_MAP: '{"C000TEST":"root","C000TEST3":"ember"}'}, 'RELAY_URLS'],
    [
      'relay URL not https',
      {RELAY_URLS: '{"root":"http://relay.test/root","forge":"https://relay.test/forge"}'},
      'RELAY_URLS',
    ],
    ['relay for an unknown workstream', {RELAY_URLS: relays('root', 'forge', 'sales')}, 'RELAY_URLS'],
    ['relay secrets missing a relay key', {RELAY_SECRETS: relaySecrets('root')}, 'RELAY_SECRETS'],
    ['relay secrets with an extra key', {RELAY_SECRETS: relaySecrets('root', 'forge', 'ember')}, 'RELAY_SECRETS'],
    ['empty relay secret', {RELAY_SECRETS: '{"root":"","forge":"fake-forge-secret"}'}, 'RELAY_SECRETS'],
    ['bridge token under 32 characters', {BRIDGE_TOKEN: 'fake-short-bridge-token'}, 'BRIDGE_TOKEN'],
    [
      'two invalid secrets name the first',
      {SLACK_BOT_TOKEN: 'fake-user-token-value', BRIDGE_TOKEN: 'x'},
      'SLACK_BOT_TOKEN',
    ],
  ]

  test.each(invalid)('503 for %s', async (_name, overrides, secret) => {
    const response = await health(fakeEnv(overrides))
    expect(response.status).toBe(503)
    // Exact body: the secret's name and nothing else, so no value can leak.
    expect(await response.json()).toEqual({ok: false, error: `${secret} is invalid`})
  })
})
