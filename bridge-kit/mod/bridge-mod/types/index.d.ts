export type BridgeTask = { file: string; mtimeMs: number }

export type BridgeSnapshot = {
  project: string
  // tasks of working/ and inbox/ whose number a running agent names (from
  // state.md's `## Running` only when the agent list is unavailable)
  running: BridgeTask[]
  // the other tasks of working/ and inbox/, waiting for a free slot
  waiting: BridgeTask[]
  // reports in outbox/ that Cowork has not read yet
  outbox: BridgeTask[]
  doorbell: string | null
  notes: string[]
  refreshedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'bridge-mod': {
      snapshot: BridgeSnapshot | null
      // the pane opened on its own once this session (kept across reloads)
      isAutoOpened: boolean
    }
  }
}
