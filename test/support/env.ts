import type {SecretName} from '@domain/config'
import type {Env} from '@infrastructure/env'

export const FAKE_SECRETS: Record<SecretName, string> = {
  SLACK_SIGNING_SECRET: 'fake-signing-secret',
  SLACK_BOT_TOKEN: 'xoxb-fake',
  CHANNEL_MAP: JSON.stringify({C000TEST: 'root', C000TEST2: 'forge'}),
  RELAY_URLS: JSON.stringify({root: 'https://relay.test/root', forge: 'https://relay.test/forge'}),
  RELAY_SECRETS: JSON.stringify({root: 'fake-root-relay-secret', forge: 'fake-forge-relay-secret'}),
  BRIDGE_TOKEN: 'fake-bridge-token-0123456789abcdef',
}

export function fakeEnv(overrides: Partial<Record<SecretName, string | undefined>> = {}): Env {
  return {
    ...FAKE_SECRETS,
    ...overrides,
    BRIDGE_KV: {} as KVNamespace,
    RELAY_GATE: {} as DurableObjectNamespace,
  }
}

export const fakeCtx = {waitUntil: () => {}, passThroughOnException: () => {}, props: {}} as unknown as ExecutionContext
