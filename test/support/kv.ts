export type KvPut = {key: string; value: string; options?: KVNamespacePutOptions}
export type KvCalls = {get: string[]; put: KvPut[]; list: unknown[]; delete: string[]}

/** In-memory KV that records every call; `fail` makes that operation throw like an exhausted daily limit. */
export function fakeKv(fail: {get?: boolean; put?: boolean} = {}) {
  const values = new Map<string, string>()
  const calls: KvCalls = {get: [], put: [], list: [], delete: []}
  const kv = {
    get: async (key: string) => {
      calls.get.push(key)
      if (fail.get) throw new Error('fake KV get failure')
      return values.get(key) ?? null
    },
    put: async (key: string, value: string, options?: KVNamespacePutOptions) => {
      calls.put.push({key, value, options})
      if (fail.put) throw new Error('fake KV put failure')
      values.set(key, value)
    },
    list: async (options: unknown) => {
      calls.list.push(options)
      throw new Error('fake KV list is not implemented')
    },
    delete: async (key: string) => {
      calls.delete.push(key)
      values.delete(key)
    },
  }
  const callCount = () => calls.get.length + calls.put.length + calls.list.length + calls.delete.length
  return {kv: kv as unknown as KVNamespace, calls, callCount}
}
