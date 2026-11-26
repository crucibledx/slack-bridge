import {z} from 'zod'

import {type Workstream, WORKSTREAMS} from './workstreams'

export const SECRET_NAMES = [
  'SLACK_SIGNING_SECRET',
  'SLACK_BOT_TOKEN',
  'CHANNEL_MAP',
  'RELAY_URLS',
  'RELAY_SECRETS',
  'BRIDGE_TOKEN',
] as const
export type SecretName = (typeof SECRET_NAMES)[number]

export type ConfigSource = Partial<Record<SecretName, unknown>>

export type BridgeConfig = {
  slackSigningSecret: string
  slackBotToken: string
  channelMap: Record<string, Workstream>
  relayUrls: Partial<Record<Workstream, string>>
  relaySecrets: Partial<Record<Workstream, string>>
  bridgeToken: string
}

export type ConfigResult = {ok: true; config: BridgeConfig} | {ok: false; invalid: SecretName}

const workstream = z.enum(WORKSTREAMS)
const slackSigningSecret = z.string().min(1)
const slackBotToken = z.string().regex(/^xoxb-\S+$/)
const channelMap = z
  .record(z.string().regex(/^[CG][A-Z0-9]+$/), workstream)
  .refine((map) => Object.values(map).includes('root'))
const relayUrls = z.partialRecord(workstream, z.url({protocol: /^https$/}))
const relaySecrets = z.partialRecord(workstream, z.string().min(1))
const bridgeToken = z.string().min(32)

/** Secrets that hold JSON arrive as strings; anything unparsable fails its schema like a wrong shape would. */
function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function sameKeys(a: object, b: object): boolean {
  const keysA = Object.keys(a)
  const keysB = new Set(Object.keys(b))
  return keysA.length === keysB.size && keysA.every((key) => keysB.has(key))
}

/**
 * Validates the Worker secrets in the order of the spec's table and names the first invalid one.
 * Results never carry a secret's value, so callers can report them as they are.
 */
export function validateConfig(source: ConfigSource): ConfigResult {
  const signing = slackSigningSecret.safeParse(source.SLACK_SIGNING_SECRET)
  if (!signing.success) return {ok: false, invalid: 'SLACK_SIGNING_SECRET'}

  const botToken = slackBotToken.safeParse(source.SLACK_BOT_TOKEN)
  if (!botToken.success) return {ok: false, invalid: 'SLACK_BOT_TOKEN'}

  const channels = channelMap.safeParse(parseJson(source.CHANNEL_MAP))
  if (!channels.success) return {ok: false, invalid: 'CHANNEL_MAP'}

  const urls = relayUrls.safeParse(parseJson(source.RELAY_URLS))
  const required = new Set<Workstream>(['root', ...Object.values(channels.data)])
  if (!urls.success || ![...required].every((ws) => urls.data[ws] !== undefined)) {
    return {ok: false, invalid: 'RELAY_URLS'}
  }

  const secrets = relaySecrets.safeParse(parseJson(source.RELAY_SECRETS))
  if (!secrets.success || !sameKeys(secrets.data, urls.data)) return {ok: false, invalid: 'RELAY_SECRETS'}

  const token = bridgeToken.safeParse(source.BRIDGE_TOKEN)
  if (!token.success) return {ok: false, invalid: 'BRIDGE_TOKEN'}

  return {
    ok: true,
    config: {
      slackSigningSecret: signing.data,
      slackBotToken: botToken.data,
      channelMap: channels.data,
      relayUrls: urls.data,
      relaySecrets: secrets.data,
      bridgeToken: token.data,
    },
  }
}
