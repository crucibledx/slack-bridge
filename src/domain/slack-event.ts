import {z} from 'zod'

import type {Workstream} from './workstreams'

const slackId = z.string().regex(/^[A-Z][A-Z0-9]{1,63}$/)
// Bounded so the key and metadata stay small and the seconds always make a valid Date.
const slackTs = z.string().regex(/^\d{1,12}\.\d{1,9}$/)

const payloadHead = z.looseObject({type: z.string()})
const urlVerification = z.object({type: z.literal('url_verification'), challenge: z.string().min(1).max(1024)})
const eventCallback = z.object({
  type: z.literal('event_callback'),
  event_id: z.string().regex(/^[A-Za-z0-9]{1,64}$/),
  team_id: slackId,
  authorizations: z.array(z.object({user_id: slackId})).optional(),
  event: z.looseObject({type: z.string()}),
})
const messageEvent = z.object({
  type: z.literal('message'),
  channel: slackId,
  ts: slackTs,
  thread_ts: slackTs.optional(),
  user: slackId.optional(),
  bot_id: z.string().optional(),
  subtype: z.string().optional(),
  user_team: slackId.optional(),
})

export type MessageEvent = z.infer<typeof messageEvent>
/** A message that passed the filter: it has a human author. */
export type HumanMessage = MessageEvent & {user: string}

export type MessagePayload = {
  type: 'message'
  eventId: string
  teamId: string
  botUserId?: string
  message: MessageEvent
}
export type SlackPayload =
  {type: 'url_verification'; challenge: string} | MessagePayload | {type: 'other'; eventId?: string} | {type: 'invalid'}

const INVALID = {type: 'invalid'} as const

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Validates a verified Slack request body. Only `url_verification` and `message` events are parsed in full; any other
 * well-formed payload is `other`, and anything that fails a schema is `invalid`.
 */
export function parseSlackPayload(raw: string): SlackPayload {
  const json = parseJson(raw)
  const head = payloadHead.safeParse(json)
  if (!head.success) return INVALID

  if (head.data.type === 'url_verification') {
    const verification = urlVerification.safeParse(json)
    return verification.success ? {type: 'url_verification', challenge: verification.data.challenge} : INVALID
  }
  if (head.data.type !== 'event_callback') return {type: 'other'}

  const callback = eventCallback.safeParse(json)
  if (!callback.success) return INVALID
  const {event_id: eventId, team_id: teamId, authorizations, event} = callback.data
  if (event.type !== 'message') return {type: 'other', eventId}

  const message = messageEvent.safeParse(event)
  if (!message.success) return INVALID
  return {type: 'message', eventId, teamId, botUserId: authorizations?.[0]?.user_id, message: message.data}
}

export const IGNORE_REASONS = {
  BOT: 'bot',
  SUBTYPE: 'subtype',
  CHANNEL: 'channel',
  EXTERNAL: 'external',
  /** A well-formed payload that is not a `message` event. */
  EVENT: 'event',
  /** The message record already exists: Slack retried the event. */
  DUPLICATE: 'duplicate',
} as const
export type IgnoreReason = (typeof IGNORE_REASONS)[keyof typeof IGNORE_REASONS]

const FORWARDED_SUBTYPES = new Set(['file_share', 'thread_broadcast'])

export type FilterResult = {ok: true; message: HumanMessage} | {ok: false; reason: IgnoreReason}

/** Drops bot posts, edits and joins, unmapped channels and external users, in the spec's order. */
export function filterMessage(payload: MessagePayload, channelMap: Record<string, Workstream>): FilterResult {
  const {message, teamId, botUserId} = payload
  const {user} = message
  if (message.bot_id !== undefined || user === undefined || user === botUserId) {
    return {ok: false, reason: IGNORE_REASONS.BOT}
  }
  if (message.subtype !== undefined && !FORWARDED_SUBTYPES.has(message.subtype)) {
    return {ok: false, reason: IGNORE_REASONS.SUBTYPE}
  }
  if (!Object.hasOwn(channelMap, message.channel)) return {ok: false, reason: IGNORE_REASONS.CHANNEL}
  if (message.user_team !== undefined && message.user_team !== teamId) {
    return {ok: false, reason: IGNORE_REASONS.EXTERNAL}
  }
  return {ok: true, message: {...message, user}}
}

export const MESSAGE_KINDS = {TOP: 'top', REPLY: 'reply'} as const
export type MessageKind = (typeof MESSAGE_KINDS)[keyof typeof MESSAGE_KINDS]

export function messageKind(message: MessageEvent): MessageKind {
  const inThread = message.thread_ts !== undefined && message.thread_ts !== message.ts
  return inThread || message.subtype === 'thread_broadcast' ? MESSAGE_KINDS.REPLY : MESSAGE_KINDS.TOP
}
