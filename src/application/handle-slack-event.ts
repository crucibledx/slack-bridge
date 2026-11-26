import type {ConfigResult} from '@domain/config'
import {messageRecord} from '@domain/message-record'
import {filterMessage, IGNORE_REASONS, type MessagePayload, parseSlackPayload} from '@domain/slack-event'
import type {Workstream} from '@domain/workstreams'
import {type Decision, OUTCOMES} from '@infrastructure/logging'
import type {MessageStore} from '@infrastructure/message-store'
import {type SignedRequest, verifySlackSignature} from '@infrastructure/slack-signature'

export type SlackEventResponse =
  {status: 200; body: {ok: true} | {challenge: string}} | {status: 401; body: {ok: false; error: 'invalid_signature'}}

export type SlackEventDeps = {
  config: ConfigResult
  store: MessageStore
  log: (decision: Decision) => void
}

// Anything but a 2xx makes Slack retry and eventually disable the app, so every outcome after the signature is 200.
const OK = {status: 200, body: {ok: true}} as const
const UNAUTHORIZED = {status: 401, body: {ok: false, error: 'invalid_signature'}} as const

const decoder = new TextDecoder()

export async function handleSlackEvent(request: SignedRequest, deps: SlackEventDeps): Promise<SlackEventResponse> {
  const {config, log} = deps
  if (!config.ok) {
    log({outcome: OUTCOMES.CONFIG_INVALID})
    return OK
  }
  if (!(await verifySlackSignature(config.config.slackSigningSecret, request))) return UNAUTHORIZED

  const payload = parseSlackPayload(decoder.decode(request.body))
  if (payload.type === 'url_verification') return {status: 200, body: {challenge: payload.challenge}}
  if (payload.type === 'invalid') {
    log({outcome: OUTCOMES.BAD_PAYLOAD})
    return OK
  }
  if (payload.type === 'other') {
    log({outcome: `ignored:${IGNORE_REASONS.EVENT}`, event_id: payload.eventId})
    return OK
  }
  await recordMessage(payload, config.config.channelMap, deps)
  return OK
}

/**
 * Writes the message record unless the filter drops the message or the record exists. KV failures are logged and
 * never fail the request: a failed read records anyway, a failed write loses only dedupe and the ledger line.
 */
async function recordMessage(
  payload: MessagePayload,
  channelMap: Record<string, Workstream>,
  {store, log}: SlackEventDeps,
): Promise<void> {
  const fields = {event_id: payload.eventId, channel: payload.message.channel, ts: payload.message.ts}
  const filtered = filterMessage(payload, channelMap)
  if (!filtered.ok) {
    log({...fields, outcome: `ignored:${filtered.reason}`})
    return
  }

  const record = messageRecord(filtered.message)
  try {
    if (await store.has(record.key)) {
      log({...fields, outcome: `ignored:${IGNORE_REASONS.DUPLICATE}`})
      return
    }
  } catch {
    log({...fields, outcome: OUTCOMES.KV_LIMIT})
  }

  try {
    await store.put(record)
  } catch {
    log({...fields, outcome: OUTCOMES.KV_LIMIT})
    return
  }
  log({...fields, outcome: OUTCOMES.RECORDED})
}
