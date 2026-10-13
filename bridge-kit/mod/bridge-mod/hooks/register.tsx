import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BridgeSnapshot, BridgeTask } from '../types'
import { lastNotes } from './format'
import { drawDashboard, drawText } from './pane'
import { pushChecks } from './push-guard'

const BRIDGE = '.bridge'
const PANE = 'bridge'
const COMMAND = 'bridge-panel'
const NOTES = 'session-notes.md'
const TICK_MS = 10_000
const QUIET_MS = 60_000

const DENY =
  'bridge-mod: pushing to main/master is blocked; changes reach main only through a PR.'
const DENY_UNKNOWN =
  'bridge-mod: cannot tell which branch this push goes to, so it is blocked; name the remote and a branch that is not main/master.'
const DENY_FAILED =
  'bridge-mod: its push guard failed, so this call is blocked.'

const snapshot = atom({ plugin: 'bridge-mod', key: 'snapshot' } as const, null)

const taskFiles = async ($: EngineInterface, folder: string): Promise<BridgeTask[]> => {
  const entries = await $.fs.list(`${BRIDGE}/${folder}`).catch(() => [])

  return entries
    .filter(
      entry =>
        entry.kind === 'file' &&
        entry.name.endsWith('.md') &&
        entry.name !== NOTES,
    )
    .map(entry => ({ file: entry.name, mtimeMs: entry.mtimeMs }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}

// What a refresh remembers between ticks; a reload starts it over.
type Memo = { isActive: boolean; lastRanAt: number | undefined; project: string }

// Reads the bridge folders (never writes them) and shows what they hold.
const refresh = async ($: EngineInterface, memo: Memo) => {
  if (!(await $.fs.exists(BRIDGE))) {
    if (memo.isActive) {
      $.ui.status(undefined)
    }

    return
  }
  if (!memo.isActive) {
    await $.command.register({
      name: COMMAND,
      description: 'Show the Cowork bridge tasks, doorbell and session notes',
    })
    memo.isActive = true
  }

  const [working, inbox, outbox] = await Promise.all([
    taskFiles($, 'working'),
    taskFiles($, 'inbox'),
    taskFiles($, 'outbox'),
  ])
  const doorbell = (await $.fs.read(`${BRIDGE}/doorbell`).catch(() => '')).trim()
  const notes = lastNotes(await $.fs.read(`${BRIDGE}/outbox/${NOTES}`).catch(() => ''), 5)
  const time = await $.clock.now()
  const now: BridgeSnapshot = {
    project: memo.project,
    working,
    inbox,
    outbox,
    doorbell: doorbell === '' ? null : doorbell,
    notes,
    refreshedAt: time,
  }
  // Written at every tick, so the pane's ages are drawn again.
  await update($, snapshot, () => now)

  if (working.length > 0) {
    memo.lastRanAt = time
  }
  const isQuiet =
    working.length + inbox.length + outbox.length === 0 &&
    (memo.lastRanAt === undefined || time - memo.lastRanAt >= QUIET_MS)

  $.ui.status(
    isQuiet
      ? undefined
      : `bridge: ${working.length} running · ${inbox.length} queued · ${outbox.length} to review`,
  )
}

export const register: Register = on => {
  const memo: Memo = { isActive: false, lastRanAt: undefined, project: '' }

  on('session.start', async ($, e, next) => {
    memo.project = e.cwd.split(/[\\/]/).filter(part => part !== '').pop() ?? ''
    $.clock.every(TICK_MS, () => {
      void refresh($, memo).catch(() => undefined)
    })
    await refresh($, memo).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    await refresh($, memo)
    await $.ui.open({ id: PANE, title: 'Bridge' })

    return { text: 'Bridge panel opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const now = await read($, snapshot)
    const time = await $.clock.now()
    const columns = e.props.bodyColumns

    return e.surface === 'terminal'
      ? drawText($.ui.resolve(e), now, time, columns)
      : drawDashboard($.ui.resolve(e), now, time, columns)
  })

  // Denies a `git push` that lands on main or master, in every project, with
  // or without a `.bridge` folder. It only ever denies.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const checks = pushChecks(e.command)

    if (checks.length === 0) {
      return next(e)
    }

    for (const check of checks) {
      if (check.kind === 'deny') {
        return { deny: DENY }
      }
      if (check.kind === 'unknown') {
        return { deny: DENY_UNKNOWN }
      }

      const head = await $.process.run(
        ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
        check.cwd === undefined ? {} : { cwd: check.cwd },
      )
      if (head.exitCode !== 0) {
        return { deny: DENY_UNKNOWN }
      }
      if (/^(main|master)$/.test(head.stdout.trim())) {
        return { deny: DENY }
      }
    }

    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: DENY_FAILED }))
}
