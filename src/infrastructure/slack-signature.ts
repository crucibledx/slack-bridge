const MAX_CLOCK_SKEW_SECONDS = 300
const TIMESTAMP = /^\d{1,12}$/
const SIGNATURE = /^v0=([0-9a-f]{64})$/

const encoder = new TextEncoder()

export type SignedRequest = {body: Uint8Array; timestamp: string | null; signature: string | null}

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16))
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(a.byteLength + b.byteLength)
  joined.set(a)
  joined.set(b, a.byteLength)
  return joined
}

/**
 * Slack's v0 request signature over the raw body bytes. `crypto.subtle.verify` compares the MAC in constant time.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export async function verifySlackSignature(
  secret: string,
  {body, timestamp, signature}: SignedRequest,
  nowMs = Date.now(),
): Promise<boolean> {
  if (timestamp === null || !TIMESTAMP.test(timestamp)) return false
  if (Math.abs(Math.floor(nowMs / 1000) - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) return false
  const hex = signature === null ? undefined : SIGNATURE.exec(signature)?.[1]
  if (hex === undefined) return false

  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, [
    'verify',
  ])
  return crypto.subtle.verify('HMAC', key, hexBytes(hex), concat(encoder.encode(`v0:${timestamp}:`), body))
}
