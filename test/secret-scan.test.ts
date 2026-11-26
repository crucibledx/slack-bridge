import {readFileSync} from 'node:fs'
import {describe, expect, test} from 'bun:test'

import {findSecrets} from './support/secret-scan'

// Built at runtime so this file holds no token-shaped string itself.
const tokenShaped = ['xo', 'xb-', '1234567890-abcdefABCDEF'].join('')
const slackChannelId = ['C', '0123ABCDE9'].join('')

describe('secret scanner', () => {
  test('flags a token-shaped string', () => {
    expect(findSecrets(`token: ${tokenShaped}`)).toEqual([tokenShaped])
  })

  test('passes the bare documented prefix', () => {
    expect(findSecrets('SLACK_BOT_TOKEN is a string starting xoxb-')).toEqual([])
  })

  test('flags webhook URLs and real-looking Slack ids, passes the fakes', () => {
    expect(findSecrets(['https://hooks.', 'slack.com/services/x'].join(''))).toHaveLength(1)
    expect(findSecrets(['https://api.', 'factory.ai/api/webhooks/x'].join(''))).toHaveLength(1)
    expect(findSecrets(`channel ${slackChannelId}`)).toEqual([slackChannelId])
    expect(findSecrets('channels C000TEST and C000TEST2, user U000TEST_1')).toEqual([])
  })
})

test('no secret, Slack id or relay URL in tracked files', () => {
  const listed = Bun.spawnSync(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  expect(listed.exitCode).toBe(0)
  const files = listed.stdout.toString().split('\0').filter(Boolean)
  expect(files.length).toBeGreaterThan(0)
  const found = files.flatMap((file) => findSecrets(readFileSync(file, 'utf8')).map((match) => `${file}: ${match}`))
  expect(found).toEqual([])
})
