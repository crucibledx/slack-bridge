import {checkHealth} from '@application/check-health'
import {handleSlackEvent} from '@application/handle-slack-event'
import {loadConfig} from '@infrastructure/config'
import type {Env} from '@infrastructure/env'
import {jsonResponse, readBody} from '@infrastructure/http'
import {logDecision} from '@infrastructure/logging'
import {kvMessageStore} from '@infrastructure/message-store'
import {createRouter} from '@infrastructure/router'

export {RelayGate} from '@infrastructure/relay-gate'

const MAX_EVENT_BYTES = 256 * 1024

const fetch = createRouter<Env>({
  '/health': {
    GET: (_request, env) => {
      const report = checkHealth(loadConfig(env))
      return jsonResponse(report.status, report.body)
    },
  },
  '/slack/events': {
    POST: async (request, env) => {
      const body = await readBody(request, MAX_EVENT_BYTES)
      if (body === undefined) return jsonResponse(413, {ok: false, error: 'payload_too_large'})
      const result = await handleSlackEvent(
        {
          body,
          timestamp: request.headers.get('X-Slack-Request-Timestamp'),
          signature: request.headers.get('X-Slack-Signature'),
        },
        {config: loadConfig(env), store: kvMessageStore(env.BRIDGE_KV), log: (decision) => logDecision(decision)},
      )
      return jsonResponse(result.status, result.body)
    },
  },
})

export default {fetch} satisfies ExportedHandler<Env>
