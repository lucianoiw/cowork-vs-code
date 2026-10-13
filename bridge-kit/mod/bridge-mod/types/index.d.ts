export type BridgeTask = { file: string; mtimeMs: number }

export type BridgeSnapshot = {
  project: string
  working: BridgeTask[]
  inbox: BridgeTask[]
  outbox: BridgeTask[]
  doorbell: string | null
  notes: string[]
  refreshedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'bridge-mod': { snapshot: BridgeSnapshot | null }
  }
}
