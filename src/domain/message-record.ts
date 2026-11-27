import {type HumanMessage, type MessageKind, messageKind} from './slack-event'

export const MESSAGE_TTL_SECONDS = 35 * 24 * 60 * 60

const LEDGER_EVENTS = {top: 'route', reply: 'reply'} as const satisfies Record<MessageKind, string>

/** The message record's KV metadata. `ws` and `via` join it once routing ships. */
export type LedgerLine = {
  at: string
  event: (typeof LEDGER_EVENTS)[MessageKind]
  id: string
  channel: string
  ts: string
  thread_ts: string
  user: string
}

export type MessageRecord = {key: string; metadata: LedgerLine}

/** ISO 8601 UTC time of a Slack `ts`, whose fraction is a sequence number rather than part of the time. */
function utcTime(ts: string): string {
  const [seconds] = ts.split('.')
  return new Date(Number(seconds) * 1000).toISOString()
}

/** The key is derived from `channel` and `ts` alone, so a retried event finds the record it wrote the first time. */
export function messageRecord(message: HumanMessage): MessageRecord {
  const {channel, ts, user} = message
  const time = utcTime(ts)
  return {
    key: `msg:${time.slice(0, 10)}:${channel}:${ts}`,
    metadata: {
      at: `${time.slice(0, 19)}Z`,
      event: LEDGER_EVENTS[messageKind(message)],
      id: `${channel}:${ts}`,
      channel,
      ts,
      thread_ts: message.thread_ts ?? ts,
      user,
    },
  }
}
