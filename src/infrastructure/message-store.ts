import {MESSAGE_TTL_SECONDS, type MessageRecord} from '@domain/message-record'

export type MessageStore = {
  has(key: string): Promise<boolean>
  put(record: MessageRecord): Promise<void>
}

/** Message records in KV: an empty value with the ledger line as metadata, so listing a day needs no reads. */
export function kvMessageStore(kv: KVNamespace): MessageStore {
  return {
    has: async (key) => (await kv.get(key)) !== null,
    put: (record) => kv.put(record.key, '', {expirationTtl: MESSAGE_TTL_SECONDS, metadata: record.metadata}),
  }
}
