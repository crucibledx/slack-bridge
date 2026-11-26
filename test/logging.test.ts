import {expect, test} from 'bun:test'

import {type Decision, logDecision} from '@infrastructure/logging'

test('writes one JSON line with only the allowed fields', () => {
  const lines: string[] = []
  const decision = {
    outcome: 'ignored:bot',
    event_id: 'Ev000TEST',
    channel: 'C000TEST',
    ts: '1764092400.000100',
    ws: 'forge',
    via: 'prefix',
    status: 202,
    text: 'fake message text',
    user: 'U000TEST',
    token: 'fake-token',
  } as Decision
  logDecision(decision, (line) => lines.push(line))

  expect(lines).toHaveLength(1)
  expect(JSON.parse(lines[0]!)).toEqual({
    event_id: 'Ev000TEST',
    channel: 'C000TEST',
    ts: '1764092400.000100',
    outcome: 'ignored:bot',
    ws: 'forge',
    via: 'prefix',
    status: 202,
  })
})
