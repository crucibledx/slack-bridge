import {readFileSync, statSync} from 'node:fs'
import {describe, expect, test} from 'bun:test'

import {describeFindings, findSecrets} from './support/secret-scan'

// Built at runtime so this file holds no token-shaped string itself.
const tokenShaped = ['xo', 'xb-', '1234567890-abcdefABCDEF'].join('')
const slackChannelId = ['C', '0123ABCDE9'].join('')

describe('secret scanner', () => {
  test('flags a token-shaped string', () => {
    expect(findSecrets(`token: ${tokenShaped}`)).toEqual([{pattern: 'slack-token', line: 1}])
  })

  test('passes the bare documented prefix', () => {
    expect(findSecrets('SLACK_BOT_TOKEN is a string starting xoxb-')).toEqual([])
  })

  test('flags webhook URLs and real-looking Slack ids, passes the fakes', () => {
    expect(findSecrets(['https://hooks.', 'slack.com/services/x'].join(''))).toEqual([
      {pattern: 'slack-webhook-url', line: 1},
    ])
    expect(findSecrets(['https://api.', 'factory.ai/api/webhooks/x'].join(''))).toEqual([
      {pattern: 'relay-webhook-url', line: 1},
    ])
    expect(findSecrets(`first line\nchannel ${slackChannelId}`)).toEqual([{pattern: 'slack-id', line: 2}])
    expect(findSecrets('channels C000TEST and C000TEST2, user U000TEST_1')).toEqual([])
  })

  test('failure output names the file, line and pattern, never the value', () => {
    const report = describeFindings('fake.txt', `one\ntwo ${tokenShaped}\n${slackChannelId}`)
    expect(report).toEqual(['fake.txt:2 slack-token', 'fake.txt:3 slack-id'])
    expect(report.join('\n')).not.toContain(tokenShaped)
    expect(report.join('\n')).not.toContain(slackChannelId)
  })
})

test('no secret, Slack id or relay URL in tracked files', () => {
  const listed = Bun.spawnSync(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  expect(listed.exitCode).toBe(0)
  // Nested checkouts (worktrees, submodules) are listed as directories; only regular files are scanned.
  const files = listed.stdout
    .toString()
    .split('\0')
    .filter((file) => file && statSync(file).isFile())
  expect(files.length).toBeGreaterThan(0)
  expect(files.flatMap((file) => describeFindings(file, readFileSync(file, 'utf8')))).toEqual([])
})
