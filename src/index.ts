import {checkHealth} from '@application/check-health'
import {loadConfig} from '@infrastructure/config'
import type {Env} from '@infrastructure/env'
import {jsonResponse} from '@infrastructure/http'
import {createRouter} from '@infrastructure/router'

export {RelayGate} from '@infrastructure/relay-gate'

const fetch = createRouter<Env>({
  '/health': {
    GET: (_request, env) => {
      const report = checkHealth(loadConfig(env))
      return jsonResponse(report.status, report.body)
    },
  },
})

export default {fetch} satisfies ExportedHandler<Env>
