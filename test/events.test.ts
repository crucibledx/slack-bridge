import {afterEach, beforeEach, describe, expect, type Mock, setSystemTime, spyOn, test} from 'bun:test'

import {fakeEnv} from './support/env'
import {fakeKv} from './support/kv'
import {messagePayload, NOW_SECONDS, postEvent, slackRequest} from './support/slack'

const MAX_BYTES = 256 * 1024
const TS = '1764092400.000100'
const FIELDS = {event_id: 'Ev000TEST', channel: 'C000TEST', ts: TS}

let logSpy: Mock<typeof console.log>
beforeEach(() => {
  setSystemTime(new Date(NOW_SECONDS * 1000))
  logSpy = spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  setSystemTime()
  logSpy.mockRestore()
})

const logLines = () => logSpy.mock.calls.map(([line]) => String(line))
const logged = () => logLines().map((line) => JSON.parse(line) as Record<string, unknown>)

async function send(body: string, kv = fakeKv(), overrides: Parameters<typeof fakeEnv>[0] = {}) {
  return postEvent(await slackRequest(body), fakeEnv(overrides, {BRIDGE_KV: kv.kv}))
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
        controller.enqueue(bytes.slice(offset, offset + 64 * 1024))
      }
      controller.close()
    },
  })
}

/** A valid message payload padded with trailing whitespace, which JSON allows, to exactly `bytes` bytes. */
const paddedPayload = (bytes: number) => messagePayload().padEnd(bytes, ' ')

describe('POST /slack/events', () => {
  test('url_verification with a valid signature returns the challenge (AC-10)', async () => {
    const kv = fakeKv()
    const body = JSON.stringify({type: 'url_verification', token: 'fake-token', challenge: 'fake-challenge-value'})
    const response = await send(body, kv)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({challenge: 'fake-challenge-value'})
    expect(kv.callCount()).toBe(0)
  })

  test('other methods → 405', async () => {
    const response = await postEvent(new Request('https://bridge.test/slack/events'), fakeEnv())
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
  })

  describe('size cap (AC-12)', () => {
    test('a body of exactly 256 KB is accepted', async () => {
      const kv = fakeKv()
      const response = await send(paddedPayload(MAX_BYTES), kv)
      expect(response.status).toBe(200)
      expect(kv.calls.put).toHaveLength(1)
    })

    test('a signed body one byte over 256 KB → 413', async () => {
      const kv = fakeKv()
      const response = await send(paddedPayload(MAX_BYTES + 1), kv)
      expect(response.status).toBe(413)
      expect(await response.json()).toEqual({ok: false, error: 'payload_too_large'})
      expect(kv.callCount()).toBe(0)
    })

    const streamed: [string, Record<string, string>][] = [
      ['missing', {}],
      ['understated', {'Content-Length': '100'}],
    ]
    test.each(streamed)('a streamed body over 256 KB with Content-Length %s → 413', async (_name, headers) => {
      const kv = fakeKv()
      const body = paddedPayload(MAX_BYTES * 2)
      const signed = await slackRequest(body)
      const request = new Request(signed.url, {
        method: 'POST',
        headers: {...Object.fromEntries(signed.headers), ...headers},
        body: streamOf(body),
      })
      expect(request.headers.get('Content-Length')).toBe(headers['Content-Length'] ?? null)

      const response = await postEvent(request, fakeEnv({}, {BRIDGE_KV: kv.kv}))
      expect(response.status).toBe(413)
      expect(kv.callCount()).toBe(0)
    })
  })

  describe('filter (AC-13, AC-14)', () => {
    const ignored: [string, Record<string, unknown>, string][] = [
      ['bot_id set', {bot_id: 'B000TEST'}, 'bot'],
      ['no user', {user: undefined}, 'bot'],
      ["the bridge's own bot user", {user: 'U000TESTBOT'}, 'bot'],
      ['subtype channel_join', {subtype: 'channel_join'}, 'subtype'],
      ['subtype message_changed', {subtype: 'message_changed'}, 'subtype'],
      ['subtype message_deleted', {subtype: 'message_deleted'}, 'subtype'],
      ['a channel not in CHANNEL_MAP', {channel: 'C000TESTOTHER'}, 'channel'],
      ['an external user', {user_team: 'T000TESTOTHER'}, 'external'],
    ]
    test.each(ignored)('%s → 200, ignored, nothing written', async (_name, event, reason) => {
      const kv = fakeKv()
      const response = await send(messagePayload(event), kv)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ok: true})
      expect(kv.callCount()).toBe(0)
      const channel = typeof event.channel === 'string' ? event.channel : FIELDS.channel
      expect(logged()).toEqual([{...FIELDS, channel, outcome: `ignored:${reason}`}])
    })

    const accepted: [string, Record<string, unknown>][] = [
      ['subtype file_share', {subtype: 'file_share'}],
      ['subtype thread_broadcast', {subtype: 'thread_broadcast', thread_ts: '1764092000.000100'}],
      ['a user from the same team', {user_team: 'T000TEST'}],
      ['a second mapped channel', {channel: 'C000TEST2'}],
    ]
    test.each(accepted)('%s is recorded', async (_name, event) => {
      const kv = fakeKv()
      expect((await send(messagePayload(event), kv)).status).toBe(200)
      expect(kv.calls.put).toHaveLength(1)
      expect(logged().map((line) => line.outcome)).toEqual(['recorded'])
    })
  })

  describe('dedupe (AC-15)', () => {
    test('the same signed event sent twice produces one record', async () => {
      const kv = fakeKv()
      const env = fakeEnv({}, {BRIDGE_KV: kv.kv})
      const body = messagePayload()
      const first = await slackRequest(body)
      const retry = new Request(first.url, {method: 'POST', headers: first.headers, body})

      expect((await postEvent(first, env)).status).toBe(200)
      expect((await postEvent(retry, env)).status).toBe(200)
      expect(kv.calls.put).toHaveLength(1)
      expect(logged()).toEqual([
        {...FIELDS, outcome: 'recorded'},
        {...FIELDS, outcome: 'ignored:duplicate'},
      ])
    })

    test('a redelivery with a new event_id finds the same record', async () => {
      const kv = fakeKv()
      await send(messagePayload(), kv)
      await send(messagePayload({}, {event_id: 'Ev000TEST2'}), kv)
      expect(kv.calls.put).toHaveLength(1)
    })
  })

  describe('config and payload (AC-16)', () => {
    test('invalid config → 200 and config_invalid, before any KV call', async () => {
      const kv = fakeKv()
      const response = await send(messagePayload(), kv, {CHANNEL_MAP: 'fake-not-json-value'})
      expect(response.status).toBe(200)
      expect(kv.callCount()).toBe(0)
      expect(logged()).toEqual([{outcome: 'config_invalid'}])
    })

    const bad: [string, string][] = [
      ['a body that is not JSON', 'fake-not-json-value'],
      ['a JSON array', '[]'],
      ['url_verification without a challenge', JSON.stringify({type: 'url_verification'})],
      ['an event_callback without event_id', messagePayload({}, {event_id: undefined})],
      ['an event_callback without team_id', messagePayload({}, {team_id: undefined})],
      ['a message without ts', messagePayload({ts: undefined})],
      ['a message with a malformed ts', messagePayload({ts: 'fake-ts'})],
      ['a message without channel', messagePayload({channel: undefined})],
      ['a message with a malformed thread_ts', messagePayload({thread_ts: 17640924})],
    ]
    test.each(bad)('%s → 200 and bad_payload', async (_name, body) => {
      const kv = fakeKv()
      expect((await send(body, kv)).status).toBe(200)
      expect(kv.callCount()).toBe(0)
      expect(logged()).toEqual([{outcome: 'bad_payload'}])
    })

    test('an event_callback whose event is not a message → 200, nothing written', async () => {
      const kv = fakeKv()
      const body = messagePayload({type: 'reaction_added', channel: undefined, ts: undefined})
      expect((await send(body, kv)).status).toBe(200)
      expect(kv.callCount()).toBe(0)
      expect(logged()).toEqual([{event_id: 'Ev000TEST', outcome: 'ignored:event'}])
    })

    test('a payload type other than event_callback → 200, nothing written', async () => {
      const kv = fakeKv()
      const body = JSON.stringify({type: 'app_rate_limited', team_id: 'T000TEST', minute_rate_limited: 1})
      expect((await send(body, kv)).status).toBe(200)
      expect(kv.callCount()).toBe(0)
      expect(logged()).toEqual([{outcome: 'ignored:event'}])
    })
  })

  describe('KV failures (AC-17)', () => {
    test('a failing write is logged as kv_limit and the request still returns 200', async () => {
      const kv = fakeKv({put: true})
      expect((await send(messagePayload(), kv)).status).toBe(200)
      expect(kv.calls.put).toHaveLength(1)
      expect(logged()).toEqual([{...FIELDS, outcome: 'kv_limit'}])
    })

    test('a failing dedupe read is logged as kv_limit and the message is still recorded', async () => {
      const kv = fakeKv({get: true})
      expect((await send(messagePayload(), kv)).status).toBe(200)
      expect(kv.calls.put).toHaveLength(1)
      expect(logged()).toEqual([
        {...FIELDS, outcome: 'kv_limit'},
        {...FIELDS, outcome: 'recorded'},
      ])
    })
  })

  describe('message record (AC-18)', () => {
    test('a top-level message is one write of msg:<UTC date>:<channel>:<ts> with the ledger line', async () => {
      const kv = fakeKv()
      expect((await send(messagePayload(), kv)).status).toBe(200)

      const key = `msg:2025-11-25:C000TEST:${TS}`
      expect(kv.calls.get).toEqual([key])
      expect(kv.calls.put).toEqual([
        {
          key,
          value: '',
          options: {
            expirationTtl: 35 * 24 * 60 * 60,
            metadata: {
              at: '2025-11-25T17:40:00Z',
              event: 'route',
              id: `C000TEST:${TS}`,
              channel: 'C000TEST',
              ts: TS,
              thread_ts: TS,
              user: 'U000TEST',
            },
          },
        },
      ])
    })

    const replies: [string, Record<string, unknown>][] = [
      ['a thread reply', {ts: '1764092400.000200', thread_ts: '1764092000.000100'}],
      ['a thread_broadcast', {ts: '1764092400.000200', thread_ts: '1764092000.000100', subtype: 'thread_broadcast'}],
    ]
    test.each(replies)('%s is a reply line with the thread root', async (_name, event) => {
      const kv = fakeKv()
      await send(messagePayload(event), kv)
      expect(kv.calls.put[0]?.key).toBe('msg:2025-11-25:C000TEST:1764092400.000200')
      expect(kv.calls.put[0]?.options?.metadata).toMatchObject({event: 'reply', thread_ts: '1764092000.000100'})
    })

    test('a parent message whose thread_ts equals its ts is top-level', async () => {
      const kv = fakeKv()
      await send(messagePayload({thread_ts: TS}), kv)
      expect(kv.calls.put[0]?.options?.metadata).toMatchObject({event: 'route', thread_ts: TS})
    })

    test('the date and time are the UTC time of ts, to the second', async () => {
      const kv = fakeKv()
      await send(messagePayload({ts: '1764028799.999999'}), kv)
      expect(kv.calls.put[0]?.key).toBe('msg:2025-11-24:C000TEST:1764028799.999999')
      expect(kv.calls.put[0]?.options?.metadata).toMatchObject({at: '2025-11-24T23:59:59Z'})
    })

    test('the record and the logs carry no message text or user name, and logs no user id', async () => {
      const kv = fakeKv()
      await send(messagePayload({user_profile: {real_name: 'fake-user-name'}}), kv)
      const metadata = JSON.stringify(kv.calls.put[0]?.options?.metadata)
      expect(new TextEncoder().encode(metadata).byteLength).toBeLessThan(1024)
      for (const value of ['fake message text', 'fake-user-name']) expect(metadata).not.toContain(value)
      for (const value of ['fake message text', 'fake-user-name', 'U000TEST']) {
        expect(logLines().join('\n')).not.toContain(value)
      }
    })
  })
})
