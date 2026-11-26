export const WORKSTREAMS = ['root', 'forge', 'ember', 'other'] as const
export type Workstream = (typeof WORKSTREAMS)[number]
