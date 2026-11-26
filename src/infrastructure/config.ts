import {type ConfigResult, validateConfig} from '@domain/config'

import type {Env} from './env'

// Secrets are fixed for the life of an isolate, so each env object is validated once.
const validated = new WeakMap<Env, ConfigResult>()

export function loadConfig(env: Env): ConfigResult {
  const cached = validated.get(env)
  if (cached) return cached
  const result = validateConfig(env)
  validated.set(env, result)
  return result
}
