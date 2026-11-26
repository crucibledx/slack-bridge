import type {ConfigResult} from '@domain/config'

export type HealthReport = {status: 200; body: {ok: true}} | {status: 503; body: {ok: false; error: string}}

export function checkHealth(config: ConfigResult): HealthReport {
  if (config.ok) return {status: 200, body: {ok: true}}
  return {status: 503, body: {ok: false, error: `${config.invalid} is invalid`}}
}
