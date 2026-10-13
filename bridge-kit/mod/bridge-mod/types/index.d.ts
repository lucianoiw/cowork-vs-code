export type BridgeTask = { file: string; mtimeMs: number }

export type BridgeSnapshot = {
  project: string
  // listed under `## Running` in state.md (all of working/ without that file)
  running: BridgeTask[]
  // inbox/, and whatever sits in working/ without being listed as running
  queued: BridgeTask[]
  outbox: BridgeTask[]
  doorbell: string | null
  notes: string[]
  refreshedAt: number
  // when the bridge last changed: a file written, or a task come or gone
  changedAt: number
  // the queued, running and to-review counts before this reading, on the one
  // reading where they changed; null on every other
  shift: [number, number, number] | null
}

declare module 'claude-code' {
  interface PluginState {
    'bridge-mod': { snapshot: BridgeSnapshot | null }
  }
}
