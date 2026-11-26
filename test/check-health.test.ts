import {afterAll, describe, expect, test} from 'bun:test'

const responses: Record<string, {status: number; body: string}> = {
  '/ok/health': {status: 200, body: '{"ok":true}'},
  '/broken/health': {
    status: 503,
    body: JSON.stringify({ok: false, error: 'FAKE_SECRET is invalid', detail: 'fake-leaked-value'}),
  },
  '/html/health': {status: 502, body: '<html>fake-gateway-page</html>'},
}

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const response = responses[new URL(request.url).pathname] ?? {status: 404, body: ''}
    return new Response(response.body, {status: response.status})
  },
})
afterAll(() => server.stop(true))

// Async spawn: a synchronous one would block the event loop that serves the stub.
async function run(path: string) {
  const child = Bun.spawn(['bash', 'scripts/check-health.sh', `${server.url.origin}${path}`], {
    env: {PATH: process.env.PATH ?? '', HEALTH_CHECK_ATTEMPTS: '1', HEALTH_CHECK_DELAY: '0'},
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return {code, output: stdout + stderr}
}

describe('scripts/check-health.sh', () => {
  test('passes on 200', async () => {
    expect((await run('/ok')).code).toBe(0)
  })

  test('fails on 503, printing only the error field', async () => {
    const {code, output} = await run('/broken')
    expect(code).not.toBe(0)
    expect(output).toContain('FAKE_SECRET is invalid')
    expect(output).toContain('503')
    expect(output).not.toContain('fake-leaked-value')
  })

  test('fails on a body without an error field, printing none of it', async () => {
    const {code, output} = await run('/html')
    expect(code).not.toBe(0)
    expect(output).not.toContain('fake-gateway-page')
  })
})
