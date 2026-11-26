import {afterEach, beforeEach, describe, expect, type Mock, setSystemTime, spyOn, test} from 'bun:test'

import {fakeEnv} from './support/env'
import {fakeKv} from './support/kv'
import {messagePayload, NOW_SECONDS, postEvent, slackRequest, slackSignature} from './support/slack'

let logSpy: Mock<typeof console.log>
let fetchSpy: Mock<typeof fetch>
beforeEach(() => {
  setSystemTime(new Date(NOW_SECONDS * 1000))
  logSpy = spyOn(console, 'log').mockImplementation(() => {})
  const noNetwork = () => Promise.reject(new Error('no network in tests'))
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(noNetwork as unknown as typeof fetch)
})
afterEach(() => {
  setSystemTime()
  logSpy.mockRestore()
  fetchSpy.mockRestore()
})

const BODY = messagePayload()

function request(headers: Record<string, string>, body = BODY): Request {
  return new Request('https://bridge.test/slack/events', {method: 'POST', headers, body})
}

async function headers(timestamp = String(NOW_SECONDS), secret = 'fake-signing-secret', body = BODY) {
  return {'X-Slack-Request-Timestamp': timestamp, 'X-Slack-Signature': await slackSignature(secret, timestamp, body)}
}

async function expectRejected(req: Request) {
  const kv = fakeKv()
  const response = await postEvent(req, fakeEnv({}, {BRIDGE_KV: kv.kv}))
  expect(response.status).toBe(401)
  expect(await response.json()).toEqual({ok: false, error: 'invalid_signature'})
  expect(kv.callCount()).toBe(0)
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(logSpy).not.toHaveBeenCalled()
}

async function expectAccepted(req: Request) {
  const kv = fakeKv()
  expect((await postEvent(req, fakeEnv({}, {BRIDGE_KV: kv.kv}))).status).toBe(200)
  expect(kv.calls.put).toHaveLength(1)
}

describe('POST /slack/events signature (AC-11)', () => {
  test('a valid signature is accepted', async () => {
    await expectAccepted(await slackRequest(BODY))
  })

  test.each([300, -300])('a timestamp %i s off is accepted', async (offset) => {
    await expectAccepted(request(await headers(String(NOW_SECONDS + offset))))
  })

  const rejected: [string, () => Promise<Request>][] = [
    ['no headers', async () => request({})],
    ['no timestamp', async () => request({'X-Slack-Signature': (await headers())['X-Slack-Signature']})],
    ['no signature', async () => request({'X-Slack-Request-Timestamp': String(NOW_SECONDS)})],
    ['a timestamp 301 s old', async () => request(await headers(String(NOW_SECONDS - 301)))],
    ['a timestamp 301 s ahead', async () => request(await headers(String(NOW_SECONDS + 301)))],
    ['a timestamp that is not a number', async () => request(await headers('fake-timestamp'))],
    ['a signature made with another secret', async () => request(await headers(undefined, 'fake-other-secret'))],
    [
      'a body changed after signing',
      async () => request(await headers(), BODY.replace('fake message', 'fake changed')),
    ],
    [
      'a signature for another timestamp',
      async () =>
        request({...(await headers(String(NOW_SECONDS - 1))), 'X-Slack-Request-Timestamp': String(NOW_SECONDS)}),
    ],
    [
      'a signature without the v0= prefix',
      async () => request({...(await headers()), 'X-Slack-Signature': (await headers())['X-Slack-Signature'].slice(3)}),
    ],
    [
      'a truncated signature',
      async () =>
        request({...(await headers()), 'X-Slack-Signature': (await headers())['X-Slack-Signature'].slice(0, -2)}),
    ],
    [
      'a signature that is not hex',
      async () => request({...(await headers()), 'X-Slack-Signature': `v0=${'z'.repeat(64)}`}),
    ],
  ]
  test.each(rejected)('%s → 401 with no KV or network call', async (_name, build) => {
    await expectRejected(await build())
  })
})
