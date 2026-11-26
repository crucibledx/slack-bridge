import type {SecretName} from '@domain/config'

export type Env = Partial<Record<SecretName, string>> & {
  BRIDGE_KV: KVNamespace
  RELAY_GATE: DurableObjectNamespace
}
