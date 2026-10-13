export type BridgeSnapshot = {
  working: string[]
  inbox: string[]
  outbox: string[]
  doorbell: string | null
  notes: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'bridge-mod': { snapshot: BridgeSnapshot | null }
  }
}
