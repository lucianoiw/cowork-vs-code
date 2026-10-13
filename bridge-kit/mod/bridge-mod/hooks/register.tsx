import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BridgeSnapshot } from '../types'
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

const taskFiles = async ($: EngineInterface, folder: string) => {
  const entries = await $.fs.list(`${BRIDGE}/${folder}`).catch(() => [])

  return entries
    .filter(
      entry =>
        entry.kind === 'file' &&
        entry.name.endsWith('.md') &&
        entry.name !== NOTES,
    )
    .map(entry => entry.name)
    .sort()
}

// `052-bridge-mod.md` reads `052 bridge-mod`.
const label = (file: string) => {
  const name = file.replace(/\.md$/, '')
  const parts = /^(\d+)-(.+)$/.exec(name)

  return parts === null ? name : `${parts[1]} ${parts[2]}`
}

// What a refresh remembers between ticks; a reload starts it over.
type Memo = { isActive: boolean; lastRanAt: number | undefined; lastWritten: string }

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
  const notes = (await $.fs.read(`${BRIDGE}/outbox/${NOTES}`).catch(() => ''))
    .trimEnd()
    .split('\n')
    .slice(-5)
    .filter(line => line !== '')
  const now: BridgeSnapshot = {
    working,
    inbox,
    outbox,
    doorbell: doorbell === '' ? null : doorbell,
    notes,
  }
  const written = JSON.stringify(now)
  if (written !== memo.lastWritten) {
    await update($, snapshot, () => now)
    memo.lastWritten = written
  }

  const time = await $.clock.now()
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
  const memo: Memo = { isActive: false, lastRanAt: undefined, lastWritten: '' }

  on('session.start', async ($, e, next) => {
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
    const { Box, Text } = $.ui.resolve(e)
    const now = await read($, snapshot)

    if (now === null) {
      return <Text dimColor>No .bridge folder in this project.</Text>
    }

    const folders = [
      { title: 'Running (working)', files: now.working },
      { title: 'Queued (inbox)', files: now.inbox },
      { title: 'To review (outbox)', files: now.outbox },
    ]

    return (
      <Box flexDirection="column">
        {folders.map(folder => (
          <Box flexDirection="column">
            <Text bold>
              {folder.title}: {String(folder.files.length)}
            </Text>
            {folder.files.map(file => (
              <Text>{`  ${label(file)}`}</Text>
            ))}
          </Box>
        ))}
        <Text bold>Doorbell: {now.doorbell ?? 'no doorbell'}</Text>
        <Text bold>Session notes (last 5 lines)</Text>
        {now.notes.length === 0 && <Text dimColor>{'  none'}</Text>}
        {now.notes.map(line => (
          <Text dimColor>{`  ${line}`}</Text>
        ))}
      </Box>
    )
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
