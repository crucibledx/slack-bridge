import {describe, expect, test} from 'bun:test'

const NAMES = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'SLACK_SIGNING_SECRET',
  'SLACK_BOT_TOKEN',
  'CHANNEL_MAP',
  'RELAY_URLS',
  'RELAY_SECRETS',
  'BRIDGE_TOKEN',
]
const fakeValue = (name: string) => `fake-value-${name.toLowerCase()}`

function run(unset: string[], empty: string[] = []) {
  const env: Record<string, string> = {PATH: process.env.PATH ?? ''}
  for (const name of NAMES) {
    if (unset.includes(name)) continue
    env[name] = empty.includes(name) ? '' : fakeValue(name)
  }
  const result = Bun.spawnSync(['bash', 'scripts/check-secrets.sh'], {env})
  return {code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString()}
}

describe('scripts/check-secrets.sh', () => {
  test('exits 0 when all 8 secrets are set', () => {
    const {code, stdout, stderr} = run([])
    expect(code).toBe(0)
    for (const name of NAMES) expect(stdout + stderr).not.toContain(fakeValue(name))
  })

  test.each(NAMES)('exits non-zero naming %s when it is missing', (name) => {
    const {code, stdout, stderr} = run([name])
    expect(code).not.toBe(0)
    expect(stderr).toContain(`Missing secret: ${name}`)
    for (const other of NAMES) expect(stdout + stderr).not.toContain(fakeValue(other))
  })

  test('names each missing or empty secret', () => {
    const {code, stdout, stderr} = run(['SLACK_BOT_TOKEN', 'BRIDGE_TOKEN'], ['RELAY_URLS'])
    expect(code).not.toBe(0)
    for (const name of ['SLACK_BOT_TOKEN', 'BRIDGE_TOKEN', 'RELAY_URLS']) {
      expect(stderr).toContain(`Missing secret: ${name}`)
    }
    expect(stderr).not.toContain('Missing secret: CHANNEL_MAP')
    for (const name of NAMES) expect(stdout + stderr).not.toContain(fakeValue(name))
  })
})
