import type {Workstream} from '@domain/workstreams'

export type Outcome =
  'recorded' | 'delivered' | `ignored:${string}` | 'pending' | 'failed' | 'kv_limit' | 'config_invalid' | 'bad_payload'

/** The only fields a log line may carry: never message text, user ids or names, tokens, secrets or relay URLs. */
export type Decision = {
  outcome: Outcome
  event_id?: string
  channel?: string
  ts?: string
  ws?: Workstream
  via?: string
  status?: number
}

const FIELDS = ['event_id', 'channel', 'ts', 'outcome', 'ws', 'via', 'status'] as const satisfies (keyof Decision)[]

/** Writes one JSON line per decision to Workers Logs. Copies only the allowed fields, whatever the caller passes. */
export function logDecision(decision: Decision, write: (line: string) => void = console.log): void {
  const line: Partial<Decision> = {}
  for (const field of FIELDS) {
    if (decision[field] !== undefined) Object.assign(line, {[field]: decision[field]})
  }
  write(JSON.stringify(line))
}
