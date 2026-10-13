export type BridgeTask = { file: string; mtimeMs: number }

export type BridgeSnapshot = {
  project: string
  working: BridgeTask[]
  inbox: BridgeTask[]
  outbox: BridgeTask[]
  doorbell: string | null
  notes: string[]
  refreshedAt: number
  // when the bridge last changed: a file written, or a task come or gone
  changedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'bridge-mod': { snapshot: BridgeSnapshot | null }
  }
}
