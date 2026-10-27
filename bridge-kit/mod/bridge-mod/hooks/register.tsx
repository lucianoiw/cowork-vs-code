import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { BridgeSnapshot, BridgeTask } from '../types'
import {
  dependsOn,
  finishedNumbers,
  lastNotes,
  runningNumbers,
  splitByAgents,
  splitTasks,
  unmetDepends,
} from './format'
import { drawDashboard, drawText } from './pane'
import { pushChecks } from './push-guard'

const BRIDGE = '.bridge'
const PANE = 'bridge'
const TITLE = 'Bridge'
const COMMAND = 'bridge-panel'
const SKILL = 'bridge'
const HINT = 'Ponte ativa: /bridge-panel abre o painel'
const NOTES = 'session-notes.md'
const TICK_MS = 10_000

const DENY =
  'bridge-mod: pushing to main/master is blocked; changes reach main only through a PR.'
const DENY_UNKNOWN =
  'bridge-mod: cannot tell which branch this push goes to, so it is blocked; name the remote and a branch that is not main/master.'
const DENY_FAILED =
  'bridge-mod: its push guard failed, so this call is blocked.'

const snapshot = atom({ plugin: 'bridge-mod', key: 'snapshot' } as const, null)
const isAutoOpened = atom({ plugin: 'bridge-mod', key: 'isAutoOpened' } as const, false)

// A folder's task files.
const taskFiles = async ($: EngineInterface, folder: string) => {
  const entries = await $.fs.list(`${BRIDGE}/${folder}`).catch(() => [])

  return entries
    .filter(
      entry =>
        entry.kind === 'file' &&
        entry.name.endsWith('.md') &&
        entry.name !== NOTES,
    )
    .map((entry): BridgeTask => ({ file: entry.name, mtimeMs: entry.mtimeMs }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}

// Which tasks run: the session's running agents say so; state.md only when
// the agent list cannot be read.
const split = async ($: EngineInterface, working: BridgeTask[], inbox: BridgeTask[]) => {
  const agents = await $.agent.list().catch(() => null)
  if (agents !== null) {
    return splitByAgents(working, inbox, runningNumbers(agents))
  }
  const state = await $.fs.read(`${BRIDGE}/state.md`).catch(() => null)

  return splitTasks(working, inbox, state)
}

// The waiting tasks of working/ whose `Depends:` names a task with no file
// in done/ or read/ yet carry those numbers in `waitingFor`.
const withDepends = async ($: EngineInterface, waiting: BridgeTask[], working: BridgeTask[]) => {
  const inWorking = new Set(working.map(task => task.file))
  if (!waiting.some(task => inWorking.has(task.file))) {
    return waiting
  }
  const over = await Promise.all(
    ['done', 'read'].map(folder => $.fs.list(`${BRIDGE}/${folder}`).catch(() => [])),
  )
  const finished = finishedNumbers(over.flat().map(entry => entry.name))

  return Promise.all(
    waiting.map(async task => {
      if (!inWorking.has(task.file)) {
        return task
      }
      const text = await $.fs.read(`${BRIDGE}/working/${task.file}`).catch(() => '')
      const missing = unmetDepends(dependsOn(text), finished)

      return missing.length === 0 ? task : { ...task, waitingFor: missing }
    }),
  )
}

// What a refresh remembers between ticks; a reload starts it over.
type Memo = {
  isActive: boolean
  project: string
  // the 10 s timer, and when it last fired (or was armed)
  timer: Timer | null
  tickedAt: number
  // refreshes started, and the newest one that wrote the snapshot, so a slow
  // refresh never overwrites a newer reading
  started: number
  written: number
}

// Reads the bridge folders (never writes them) and shows what they hold. The
// first time it finds the bridge in a session, it opens the pane. That open is
// unasked (a timer or session.start), so the engine places it only on a wide
// terminal (144 columns, 110 once asked) or a surface that places panes; when
// it waits undrawn, a toast says once how to open it.
const refresh = async ($: EngineInterface, memo: Memo) => {
  if (!(await $.fs.exists(BRIDGE))) {
    return
  }
  const seq = ++memo.started
  if (!memo.isActive) {
    // A failed registration is tried again at the next refresh and never
    // keeps the snapshot from being written.
    memo.isActive = await $.command
      .register({
        name: COMMAND,
        description: 'Show the Cowork bridge tasks, doorbell and session notes',
      })
      .then(() => true, () => false)
  }

  const [working, inbox, outbox] = await Promise.all([
    taskFiles($, 'working'),
    taskFiles($, 'inbox'),
    taskFiles($, 'outbox'),
  ])
  const doorbell = (await $.fs.read(`${BRIDGE}/doorbell`).catch(() => '')).trim()
  const notes = lastNotes(await $.fs.read(`${BRIDGE}/outbox/${NOTES}`).catch(() => ''), 5)
  const { running, waiting } = await split($, working, inbox)
  const now: BridgeSnapshot = {
    project: memo.project,
    running,
    waiting: await withDepends($, waiting, working),
    outbox,
    doorbell: doorbell === '' ? null : doorbell,
    notes,
    refreshedAt: await $.clock.now(),
  }
  // Written at every tick, so the pane's ages are drawn again.
  if (seq < memo.written) {
    return
  }
  memo.written = seq
  await update($, snapshot, () => now)

  if (!(await read($, isAutoOpened))) {
    await update($, isAutoOpened, () => true)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    if (!opened.isPlaced) {
      $.ui.toast(HINT)
    }
  }
}

// A refresh that never throws: a failure keeps the last reading and puts its
// message in the snapshot, for the pane header to show dimmed.
const tick = async ($: EngineInterface, memo: Memo) => {
  try {
    await refresh($, memo)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await update($, snapshot, last => (last === null ? last : { ...last, error: message })).catch(
      () => undefined,
    )
  }
}

// (Re)starts the 10 s timer. Its periods can end without a reload (a refused
// period ends the interval), so events arm it again when it went quiet.
const arm = async ($: EngineInterface, memo: Memo) => {
  memo.timer?.cancel()
  memo.tickedAt = await $.clock.now()
  memo.timer = $.clock.every(TICK_MS, () => {
    void $.clock
      .now()
      .then(time => {
        memo.tickedAt = time
      })
      .catch(() => undefined)
    void tick($, memo)
  })
}

// A refresh on an event of the session, re-arming the timer if it missed
// three periods. Never throws.
const poke = async ($: EngineInterface, memo: Memo) => {
  try {
    if ((await $.clock.now()) - memo.tickedAt > 3 * TICK_MS) {
      await arm($, memo)
    }
  } catch {
    // the timer is tried again at the next event
  }
  await tick($, memo)
}

export const register: Register = on => {
  const memo: Memo = {
    isActive: false,
    project: '',
    timer: null,
    tickedAt: 0,
    started: 0,
    written: 0,
  }

  on('session.start', async ($, e, next) => {
    memo.project = e.cwd.split(/[\\/]/).filter(part => part !== '').pop() ?? ''
    await arm($, memo).catch(() => undefined)
    await tick($, memo)

    return next(e)
  })

  // After each tool call and at the end of each turn (the session's, or a
  // subagent's), so the pane follows the dispatcher moving files right away.
  on('tool.call', async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      void poke($, memo)
    }
  })
  on('turn.complete', async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      void poke($, memo)
    }
  })

  on('command.run', { command: COMMAND }, async $ => {
    await tick($, memo)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Bridge panel opened.' }
  })

  // `/bridge` (not `/bridge stop`) opens the pane too: an open from the hook
  // of a command the person typed is asked, so the engine places it at any
  // width. The skill itself always runs.
  on('command.run', { command: SKILL }, async ($, e, next) => {
    if (e.args.trim() !== 'stop') {
      await tick($, memo)
      await $.ui.open({ id: PANE, title: TITLE })
    }

    return next(e)
  }).catch(($, e, next) => next(e))

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
