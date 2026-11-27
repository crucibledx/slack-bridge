import worker from '../../src/index'
import {fakeCtx} from './env'

/** 2025-11-25T17:40:00Z, the clock the event tests run at. */
export const NOW_SECONDS = 1764092400

const encoder = new TextEncoder()

export async function slackSignature(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, [
    'sign',
  ])
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`v0:${timestamp}:${body}`))
  return `v0=${Buffer.from(mac).toString('hex')}`
}

type SignOptions = {secret?: string; timestamp?: string}

/** A POST /slack/events request signed like Slack signs it, with the fake signing secret by default. */
export async function slackRequest(body: string, {secret = 'fake-signing-secret', timestamp}: SignOptions = {}) {
  const ts = timestamp ?? String(NOW_SECONDS)
  return new Request('https://bridge.test/slack/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Slack-Request-Timestamp': ts,
      'X-Slack-Signature': await slackSignature(secret, ts, body),
    },
    body,
  })
}

export function postEvent(request: Request, env: Parameters<typeof worker.fetch>[1]) {
  return worker.fetch(request, env, fakeCtx)
}

type Fields = Record<string, unknown>

/** A signed-shape `event_callback` for a top-level human message in the root channel; `undefined` drops a field. */
export function messagePayload(event: Fields = {}, envelope: Fields = {}): string {
  return JSON.stringify({
    type: 'event_callback',
    event_id: 'Ev000TEST',
    team_id: 'T000TEST',
    authorizations: [{user_id: 'U000TESTBOT'}],
    event: {
      type: 'message',
      channel: 'C000TEST',
      user: 'U000TEST',
      ts: '1764092400.000100',
      text: 'fake message text',
      ...event,
    },
    ...envelope,
  })
}
