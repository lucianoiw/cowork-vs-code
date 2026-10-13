import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { bar, barSegments } from '../hooks/band'
import {
  ago,
  clamp,
  clip,
  elapsed,
  lastNotes,
  listedUnder,
  parseNote,
  splitTasks,
  taskLabel,
} from '../hooks/format'

const DENY =
  'bridge-mod: pushing to main/master is blocked; changes reach main only through a PR.'

const NO_BAND = '(no band of the mod)'

type World = {
  // path (relative to the project) -> file text; a folder exists when a file
  // is under it. No `.bridge/...` path at all: a project without the bridge.
  files?: Record<string, string>
  // path -> when the file was last modified, in milliseconds; 1 when not given
  mtimes?: Record<string, number>
  // what `git rev-parse --abbrev-ref HEAD` prints
  branch?: string
  // the branch cannot be read: the command itself fails to run
  isBroken?: boolean
}

// The world beneath the mod: a file system and git answered from memory, and
// a record of what the mod showed, ran and (never) wrote.
const world = (
  on: On,
  { files = {}, mtimes = {}, branch = 'main', isBroken = false }: World = {},
) => {
  const seen = {
    statuses: [] as (string | undefined)[],
    commands: [] as string[],
    opened: [] as string[],
    ran: [] as string[],
    gitCwds: [] as (string | undefined)[],
    writes: [] as string[],
  }
  const under = (path: string) => path.slice(path.indexOf('.bridge'))

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('fs.exists', (_$, e) => ({
    value: Object.keys(files).some(file => file.startsWith(under(e.path))),
  }))
  on('fs.list', (_$, e) => ({
    value: Object.keys(files)
      .filter(file => file.startsWith(`${under(e.path)}/`))
      .map(file => file.slice(under(e.path).length + 1))
      .filter(name => !name.includes('/'))
      .map(name => ({
        name,
        kind: 'file' as const,
        size: 1,
        mtimeMs: mtimes[`${under(e.path)}/${name}`] ?? 1,
        isLink: false,
      })),
  }))
  on('fs.read', (_$, e) => {
    const text = files[under(e.path)]
    if (text === undefined) {
      throw new Error(`ENOENT: ${e.path}`)
    }

    return { value: text }
  })
  on('fs.write', (_$, e) => {
    seen.writes.push(e.path)

    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    seen.statuses.push(e.text)

    return { value: undefined }
  })
  // What stands beneath the mod where it leaves the band to the engine.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{NO_BAND}</Text>
  })
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })
  on('command.register', (_$, e) => {
    seen.commands.push(e.name)

    return { value: { command: e.name } }
  })
  on('process.run', (_$, e) => {
    seen.gitCwds.push(e.init?.cwd)
    if (isBroken) {
      throw new Error('cannot run')
    }

    return {
      value: {
        exitCode: 0,
        stdout: `${branch}\n`,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('tool.call', (_$, e) => {
    seen.ran.push(e.tool === 'Bash' ? e.command : e.tool)

    return { result: 'ran' }
  })

  return seen
}

const BRIDGE = {
  '.bridge/working/052-bridge-mod.md': 'task',
  '.bridge/inbox/053-next-thing.md': 'task',
  '.bridge/inbox/054-other.md': 'task',
  '.bridge/outbox/051-done-thing.md': 'report',
  '.bridge/outbox/session-notes.md': 'n1\nn2\nn3\nn4\nn5\nn6\nn7\n',
  '.bridge/doorbell': 'trig_abc123\n',
}
const START = { cwd: '/project', surface: null, isInteractive: true }

// ---- the push guard

const guard = (
  name: string,
  command: string,
  expected: 'passes' | 'denied',
  branch = 'feat/x',
) =>
  test(`${name}: \`${command}\` on ${branch} ${expected}`, async ($, on) => {
    const seen = world(on, { files: BRIDGE, branch })
    const ran = await $.tool.call({ tool: 'Bash', command })

    if (expected === 'passes') {
      expect(ran.deny).toBe(undefined)
      expect(seen.ran).toEqual([command])
    } else {
      expect(ran.deny).toBe(DENY)
      expect(seen.ran).toEqual([])
    }
  })

guard('feature branch', 'git push -u origin feat/x', 'passes')
guard('feature branch', 'git push origin HEAD:feat/x', 'passes')
guard('tags', 'git push origin --tags', 'passes', 'main')
guard('tag named main', 'git push origin tag main', 'passes')
guard('not a push', 'git commit -m "docs; git push origin main"', 'passes')
guard('explicit main', 'git push origin main', 'denied')
guard('explicit master', 'git push origin master', 'denied')
guard('refspec', 'git push origin HEAD:main', 'denied')
guard('refspec', 'git push origin feat/x:refs/heads/main', 'denied')
guard('full ref', 'git push origin refs/heads/main', 'denied')
guard('forced refspec', 'git push origin +main', 'denied')
guard('delete refspec', 'git push origin :main', 'denied')
guard('delete flag', 'git push origin --delete main', 'denied')
guard('force', 'git push --force origin main', 'denied')
guard('force', 'git push -f origin main', 'denied')
guard('force', 'git push --force-with-lease origin HEAD:master', 'denied')
guard('everything', 'git push --all origin', 'denied')
guard('chained', 'git add . && git commit -m x && git push origin main', 'denied')
guard('git options', 'git -C /repo -c a=b push origin main', 'denied')
guard('nested shell', 'bash -c "git push origin main"', 'denied')
guard('bare push', 'git push', 'denied', 'main')
guard('bare push', 'git push', 'denied', 'master')
guard('bare push with remote', 'git push -u origin', 'denied', 'main')
guard('HEAD', 'git push origin HEAD', 'denied', 'main')
guard('bare push', 'git push', 'passes', 'feat/x')
guard('bare force push', 'git push --force', 'passes', 'feat/x')
guard('HEAD', 'git push origin HEAD', 'passes', 'feat/x')

test('a bare push reads the branch in the directory the command names', async ($, on) => {
  const seen = world(on, { files: BRIDGE, branch: 'feat/x' })

  await $.tool.call({ tool: 'Bash', command: 'git push' })
  await $.tool.call({ tool: 'Bash', command: 'git -C /wt/a push' })
  await $.tool.call({ tool: 'Bash', command: 'cd /wt/b && git push' })

  expect(seen.gitCwds).toEqual([undefined, '/wt/a', '/wt/b'])
})

test('a push whose destination cannot be read is denied', async ($, on) => {
  const seen = world(on, { files: BRIDGE, branch: 'feat/x' })

  const variable = await $.tool.call({ tool: 'Bash', command: 'git push origin "$BRANCH"' })
  const unknownDir = await $.tool.call({ tool: 'Bash', command: 'cd "$DIR" && git push' })

  expect(variable.deny).toContain('bridge-mod: cannot tell')
  expect(unknownDir.deny).toContain('bridge-mod: cannot tell')
  expect(seen.ran).toEqual([])
})

test('a guard that fails denies', async ($, on) => {
  const seen = world(on, { files: BRIDGE, isBroken: true })
  const ran = await $.tool.call({ tool: 'Bash', command: 'git push' })

  expect(ran.deny).toContain('bridge-mod: its push guard failed')
  expect(seen.ran).toEqual([])
})

test('other commands and other tools are left alone', async ($, on) => {
  const seen = world(on, { files: BRIDGE })

  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.tool.call({ tool: 'Bash', command: 'echo "git push origin main"' })

  expect(seen.ran).toEqual(['git status', 'echo "git push origin main"'])
  expect(seen.gitCwds).toEqual([])
})

test('without a .bridge folder the guard still denies', async ($, on) => {
  const seen = world(on, { branch: 'main' })
  const explicit = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  const bare = await $.tool.call({ tool: 'Bash', command: 'git push' })
  await $.tool.call({ tool: 'Bash', command: 'git push origin feat/x' })

  expect(explicit.deny).toBe(DENY)
  expect(bare.deny).toBe(DENY)
  expect(seen.ran).toEqual(['git push origin feat/x'])
})

// ---- no status line

test('without a .bridge folder the mod shows and registers nothing, and still guards', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on)

  await $.session.start(START)
  await clock.advance(30_000)
  const ran = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })

  expect(ran.deny).toBe(DENY)
  expect(seen.statuses).toEqual([])
  expect(seen.commands).toEqual([])
  for (const surface of BAND_SURFACES) {
    expect(await bandTexts($, surface)).toEqual([NO_BAND])
  }
})

test('a busy bridge writes nothing to the status line', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { ...BRIDGE }
  const seen = world(on, { files })

  await $.session.start(START)
  expect(seen.commands).toEqual(['bridge-panel'])
  delete files['.bridge/inbox/053-next-thing.md']
  files['.bridge/working/053-next-thing.md'] = 'task'
  await clock.advance(30_000)
  await $.command.run(OPEN)
  for (const surface of BAND_SURFACES) {
    await bandTexts($, surface)
  }

  expect(seen.statuses).toEqual([])
})

test('a bridge whose tasks all leave never touches the status line', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    '.bridge/working/052-bridge-mod.md': 'task',
    '.bridge/outbox/session-notes.md': 'notes',
  }
  const seen = world(on, { files })

  await $.session.start(START)
  delete files['.bridge/working/052-bridge-mod.md']
  await clock.advance(120_000)

  expect(seen.statuses).toEqual([])
})

test('an idle bridge writes nothing to the status line', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, { files: { '.bridge/outbox/session-notes.md': 'notes' } })

  await $.session.start(START)
  await clock.advance(30_000)

  expect(seen.statuses).toEqual([])
})

const PANE = {
  plugin: 'bridge-mod',
  component: 'Pane',
  requestId: 'bridge',
  props: {
    title: 'Bridge',
    isFocused: false,
    bodyColumns: 80,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const OPEN = {
  command: 'bridge-panel',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const NOW = 1_000_000_000
const NOTES = [
  '- 2026-10-13 17:20 old one',
  '- 2026-10-13 17:21 [054] old two',
  '- 2026-10-13 17:30 [stop] Bridge desligada',
  '- 2026-10-13 17:31 Bridge ativa',
  '- 2026-10-13 17:32 [056] Despachada: roda `claude plugin validate`',
  `- 2026-10-13 17:35 [056] ${'longa '.repeat(200)}`,
  '- 2026-10-13 17:36 [057] Na fila',
  '',
].join('\n')
const DATED = { ...BRIDGE, '.bridge/outbox/session-notes.md': NOTES }
const MTIMES = {
  '.bridge/working/052-bridge-mod.md': NOW - 12_000,
  '.bridge/inbox/053-next-thing.md': NOW - 3 * 60_000,
  '.bridge/inbox/054-other.md': NOW - 2 * 3_600_000,
  '.bridge/outbox/051-done-thing.md': NOW - 4 * 86_400_000,
}

// ---- the band above the prompt

const BAND = {
  plugin: 'bridge-mod',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const
// The two surfaces the engine raises the band on.
const BAND_SURFACES = ['terminal', 'desktop'] as const
const HOUR = 3_600_000
const TASK_FOLDERS = ['working', 'inbox', 'outbox'] as const

// The texts the band draws on a surface; `NO_BAND` alone when the mod draws none.
const bandTexts = async ($: Parameters<TestBody>[0], surface: 'terminal' | 'desktop') => {
  const ui = await $.ui.mount({ ...BAND, surface })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()

  return texts
}

// The desktop band's label and chips, without the tasks and the note beside them.
const bandChips = async ($: Parameters<TestBody>[0]) =>
  (await bandTexts($, 'desktop')).filter(text =>
    /^(Ponte|ponte livre|\d+ (rodando|na fila|para revisar))$/.test(text),
  )

// A bridge with that many task files per folder, all written long ago.
const counted = (working: number, inbox: number, outbox: number) => {
  const files: Record<string, string> = {
    '.bridge/doorbell': 'trig_abc123\n',
    '.bridge/outbox/session-notes.md': 'notes',
  }
  const mtimes: Record<string, number> = {}
  ;[working, inbox, outbox].forEach((count, folder) => {
    for (let index = 0; index < count; index += 1) {
      const path = `.bridge/${TASK_FOLDERS[folder]}/0${folder}${index}-task.md`
      files[path] = 'task'
      mtimes[path] = NOW - 5 * HOUR
    }
  })

  return { files, mtimes }
}

test('the band is hidden on a bridge nothing touched in the last hour', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, {
    files: { '.bridge/outbox/session-notes.md': 'notes', '.bridge/doorbell': 'trig_abc123\n' },
    mtimes: { '.bridge/outbox/session-notes.md': NOW - HOUR },
  })

  await $.session.start(START)
  for (const surface of BAND_SURFACES) {
    expect(await bandTexts($, surface)).toEqual([NO_BAND])
  }
})

test('the band shows a free bridge that changed in the last hour', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, {
    files: { '.bridge/outbox/session-notes.md': 'notes', '.bridge/doorbell': 'trig_abc123\n' },
    mtimes: { '.bridge/outbox/session-notes.md': NOW - HOUR + 1_000 },
  })

  await $.session.start(START)
  expect(await bandChips($)).toEqual(['Ponte', 'ponte livre'])
  expect((await bandTexts($, 'terminal'))[0]).toBe('● ponte: ponte livre')
})

test('the band shows a bridge with a task however old its files are', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, counted(0, 1, 0))

  await $.session.start(START)
  expect(await bandChips($)).toEqual(['Ponte', '1 na fila'])
  expect((await bandTexts($, 'terminal'))[0]).toBe('● ponte: 1 na fila')
})

test('the band stays for an hour after the last task leaves, then hides', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { files, mtimes } = counted(0, 0, 1)
  world(on, { files, mtimes })

  await $.session.start(START)
  expect(await bandChips($)).toEqual(['Ponte', '1 para revisar'])

  delete files['.bridge/outbox/020-task.md']
  await clock.advance(10_000)
  expect(await bandChips($)).toEqual(['Ponte', 'ponte livre'])
  await clock.advance(HOUR - 10_000)
  expect(await bandChips($)).toEqual(['Ponte', 'ponte livre'])
  await clock.advance(10_000)
  for (const surface of BAND_SURFACES) {
    expect(await bandTexts($, surface)).toEqual([NO_BAND])
  }
})

test('the band yields to a survey', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, { files: DATED, mtimes: MTIMES })

  await $.session.start(START)
  for (const surface of BAND_SURFACES) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface })
    expect((await ui.findAll({ type: 'Text' })).map(found => found.text)).toEqual([NO_BAND])
    await ui.unmount()
  }
})

const chips = (working: number, inbox: number, outbox: number, expected: string[]) =>
  test(`the band's chips for ${working} running, ${inbox} queued, ${outbox} to review`, async ($, on) => {
    mock.clock(on, { now: NOW })
    world(on, counted(working, inbox, outbox))

    await $.session.start(START)
    expect(await bandChips($)).toEqual(['Ponte', ...expected])
    expect((await bandTexts($, 'terminal'))[0]).toBe(`● ponte: ${expected.join(' · ')}`)
  })

chips(1, 0, 0, ['1 rodando'])
chips(0, 2, 0, ['2 na fila'])
chips(0, 0, 3, ['3 para revisar'])
chips(2, 0, 1, ['2 rodando', '1 para revisar'])
chips(1, 2, 0, ['1 rodando', '2 na fila'])
chips(3, 12, 4, ['3 rodando', '12 na fila', '4 para revisar'])

test('the desktop band colors its chips and the doorbell dot, and animates only while running', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { files, mtimes } = counted(1, 1, 1)
  world(on, { files, mtimes })

  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const colors = Object.fromEntries(
    (await ui.findAll({ type: 'Text' })).map(found => [found.text, found.props.color]),
  )
  // filled chips: white text on the status color, blue, amber, green
  for (const chip of ['1 rodando', '1 na fila', '1 para revisar']) {
    expect(colors[chip]).toBe('#FFFFFF')
  }
  const fills = (await ui.findAll({ type: 'Box' }))
    .filter(found => found.props.borderStyle === 'round')
    .map(found => found.props.backgroundColor)
  expect(fills).toEqual(['#2B6CD4', '#946200', '#1E7D4B'])
  const drawings = await ui.findAll({ type: 'Svg' })
  expect(drawings.map(found => found.props.alt)).toEqual([
    'Campainha ok',
    'em andamento',
    'Na fila 1, rodando 1, para revisar 1',
  ])
  expect(drawings[0]?.props.source).toContain('#5DB884')
  expect(drawings[1]?.props.source).toContain('<animate')
  expect(drawings[1]?.props.isInteractive).toBe(true)
  await ui.unmount()

  delete files['.bridge/working/000-task.md']
  delete files['.bridge/doorbell']
  await $.command.run(OPEN)
  const quiet = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const still = await quiet.findAll({ type: 'Svg' })
  expect(still.map(found => found.props.alt)).toEqual([
    'Sem campainha',
    'Na fila 1, rodando 0, para revisar 1',
  ])
  expect(still[0]?.props.source).toContain('#E0645C')
  expect(still[0]?.props.source).not.toContain('<animate')
  await quiet.unmount()
})

// ---- band v2: the real split, the running tasks, the note and the bar

const STATE = [
  '# Bridge state (written by the dispatcher; 2026-10-13)',
  '',
  '## Running',
  '- 064-demo.md (worktree isolation, Branch: feat/demo; waits on 063-other.md)',
  '- 065 a-very-long-task-name-here (shared)',
  '',
  '## Queue',
  '- 066-pr.md (Action: pr feat/demo) waits for 064',
  '',
  '## Done this session',
  '- 060-old.md done',
  '',
].join('\n')
const task = (file: string, mtimeMs = 1) => ({ file, mtimeMs })

test('listedUnder reads the task of each bullet under one heading of state.md', () => {
  expect(listedUnder(STATE, 'Running')).toEqual(['064-demo.md', '065'])
  expect(listedUnder(STATE, 'Queue')).toEqual(['066-pr.md'])
  expect(listedUnder(STATE, 'Missing')).toEqual([])
  expect(listedUnder('## Running\n(none)\n', 'Running')).toEqual([])
})

test('splitTasks runs only what state.md lists as running and queues the rest', () => {
  const working = [
    task('064-demo.md'),
    task('065-a-very-long-task-name-here.md'),
    task('066-pr.md'),
    task('067-unlisted.md'),
  ]
  const split = splitTasks(working, [task('068-new.md'), task('010-early.md')], STATE)

  expect(split.running.map(one => one.file)).toEqual([
    '064-demo.md',
    '065-a-very-long-task-name-here.md',
  ])
  expect(split.queued.map(one => one.file)).toEqual([
    '010-early.md',
    '066-pr.md',
    '067-unlisted.md',
    '068-new.md',
  ])
})

test('splitTasks falls back to the folders only without a state.md', () => {
  const working = [task('064-demo.md'), task('066-pr.md')]
  const inbox = [task('068-new.md')]

  expect(splitTasks(working, inbox, null)).toEqual({ running: working, queued: inbox })
  expect(splitTasks(working, inbox, '## Running\n(none)\n')).toEqual({
    running: [],
    queued: [task('064-demo.md'), task('066-pr.md'), task('068-new.md')],
  })
})

test('elapsed is a clock of minutes and seconds, with hours when there are any', () => {
  expect(elapsed(0)).toBe('0:00')
  expect(elapsed(7_999)).toBe('0:07')
  expect(elapsed(72_000)).toBe('1:12')
  expect(elapsed(59 * 60_000 + 59_000)).toBe('59:59')
  expect(elapsed(3_600_000 + 2 * 60_000 + 5_000)).toBe('1:02:05')
  expect(elapsed(-5_000)).toBe('0:00')
})

test('clip cuts one line to a length and ends it with an ellipsis', () => {
  expect(clip('short', 10)).toBe('short')
  expect(clip('exactly 10', 10)).toBe('exactly 10')
  expect(clip('a very long task name here', 16)).toBe('a very long tas…')
  expect(clip('word then cut', 6)).toBe('word…')
})

test('barSegments shares the bar by count, in the order queued, running, to review', () => {
  expect(barSegments([0, 0, 0]).map(one => one.width)).toEqual([0, 0, 0])
  expect(barSegments([0, 2, 0])).toEqual([
    { x: 0, width: 0 },
    { x: 0, width: 2000 },
    { x: 2000, width: 0 },
  ])
  // a gap of 6 between segments, the last one ending at the bar's end
  expect(barSegments([1, 3, 2])).toEqual([
    { x: 0, width: 331 },
    { x: 337, width: 994 },
    { x: 1337, width: 663 },
  ])
  expect(barSegments([2, 0, 2])).toEqual([
    { x: 0, width: 997 },
    { x: 1003, width: 0 },
    { x: 1003, width: 997 },
  ])
})

// Four tasks in working/ of which state.md runs three, as in the screenshot.
const LIVE = {
  files: {
    '.bridge/doorbell': 'trig_abc123\n',
    '.bridge/state.md': STATE.replace('## Queue', '- 063-first.md\n\n## Queue'),
    '.bridge/working/063-first.md': 'task',
    '.bridge/working/064-demo.md': 'task',
    '.bridge/working/065-a-very-long-task-name-here.md': 'task',
    '.bridge/working/066-pr.md': 'task',
    '.bridge/outbox/061-done.md': 'report',
    '.bridge/outbox/062-done.md': 'report',
    '.bridge/outbox/session-notes.md': `${NOTES}- 2026-10-13 17:40 [064] ${'Despachada e rodando '.repeat(8)}\n`,
  },
  mtimes: {
    '.bridge/working/063-first.md': NOW - 3_725_000,
    '.bridge/working/064-demo.md': NOW - 72_000,
    '.bridge/working/065-a-very-long-task-name-here.md': NOW - 7_000,
    '.bridge/working/066-pr.md': NOW - 5_000,
  },
}

test('the band counts as running only what state.md runs, on both surfaces', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, LIVE)

  await $.session.start(START)
  expect(await bandChips($)).toEqual(['Ponte', '3 rodando', '1 na fila', '2 para revisar'])
  expect((await bandTexts($, 'terminal'))[0]).toBe(
    '● ponte: 3 rodando · 1 na fila · 2 para revisar',
  )
})

test('the pane puts a task waiting in working/ under the queue', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, LIVE)

  await $.session.start(START)
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = (await terminal.findAll({ type: 'Text' })).map(found => found.text)
  expect(text).toContain('Na fila (1)')
  expect(text).toContain('Rodando (3)')
  expect(text.indexOf('Na fila (1)') < text.findIndex(shown => shown.includes('066'))).toBe(true)
  expect(text.findIndex(shown => shown.includes('066')) < text.indexOf('Rodando (3)')).toBe(true)
  await terminal.unmount()

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const alts = (await ui.findAll({ type: 'Svg' })).map(found => found.props.alt)
    expect(alts).toContain('Na fila: 1')
    expect(alts).toContain('Rodando: 3')
    expect(alts).toContain('Para revisar: 2')
    await ui.unmount()
  }
})

test('the desktop band names the running tasks with their clocks, cut to fit', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, LIVE)

  await $.session.start(START)
  const wide = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, bodyColumns: 200 },
    surface: 'desktop',
  })
  const texts = (await wide.findAll({ type: 'Text' })).map(found => found.text)
  expect(texts.slice(4, 13)).toEqual([
    '063', 'first', '· 1:02:05',
    '064', 'demo', '· 1:12',
    '065', 'a very long tas…', '· 0:07',
  ])
  // the queued task is not named, and the last note is cut with an ellipsis
  expect(texts.join('\n')).not.toContain('066')
  const note = texts[13] ?? ''
  expect(note.startsWith('Despachada e rodando')).toBe(true)
  expect(note.endsWith('…')).toBe(true)
  expect(note.length <= 60).toBe(true)
  expect(texts).toHaveLength(14)
  await wide.unmount()

  // with less room the note goes first, then the tasks that do not fit
  const narrow = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, bodyColumns: 115 },
    surface: 'desktop',
  })
  expect((await narrow.findAll({ type: 'Text' })).map(found => found.text)).toEqual([
    'Ponte', '3 rodando', '1 na fila', '2 para revisar',
    '063', 'first', '· 1:02:05',
    '064', 'demo', '· 1:12',
  ])
  expect(await narrow.find({ type: 'Button', key: 'open-pane' })).toBeDefined()
  await narrow.unmount()
})

test('the bar under the band is split in the three colors and slides once on a change', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { files, mtimes } = counted(1, 1, 2)
  world(on, { files, mtimes })
  const barOf = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const found = (await ui.findAll({ type: 'Svg' })).pop()
    await ui.unmount()

    return found?.props
  }

  await $.session.start(START)
  const first = await barOf()
  expect(first?.alt).toBe('Na fila 1, rodando 1, para revisar 2')
  expect(first?.height).toBe(3)
  for (const color of ['#D9A441', '#5B9FE8', '#5DB884']) {
    expect(first?.source).toContain(`fill="${color}"`)
  }
  expect(first?.source).not.toContain('<animate')
  expect(first?.isInteractive).toBe(undefined)
  expect(first?.source).toBe(bar([1, 1, 2], null))

  delete files['.bridge/inbox/010-task.md']
  await clock.advance(10_000)
  const moved = await barOf()
  expect(moved?.alt).toBe('Na fila 0, rodando 1, para revisar 2')
  expect(moved?.source).toBe(bar([0, 1, 2], [1, 1, 2]))
  expect(moved?.source).toContain('<animate attributeName="width"')
  expect(moved?.isInteractive).toBe(true)

  await clock.advance(10_000)
  const settled = await barOf()
  expect(settled?.source).toBe(bar([0, 1, 2], null))
  expect(settled?.isInteractive).toBe(undefined)
})

test('a free bridge draws an empty bar and no task', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, {
    files: { '.bridge/outbox/session-notes.md': '', '.bridge/doorbell': 'trig_abc123\n' },
    mtimes: { '.bridge/outbox/session-notes.md': NOW - 1_000 },
  })

  await $.session.start(START)
  expect(await bandTexts($, 'desktop')).toEqual(['Ponte', 'ponte livre'])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const drawings = await ui.findAll({ type: 'Svg' })
  expect(drawings.map(found => found.props.alt)).toEqual([
    'Campainha ok',
    'Na fila 0, rodando 0, para revisar 0',
  ])
  expect(drawings[1]?.props.source).toBe(bar([0, 0, 0], null))
  await ui.unmount()
})

test('the terminal band is one line of text with no vector', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, counted(1, 1, 0))

  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  expect(await ui.findAll({ type: 'Box' })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: '● ponte: 1 rodando · 1 na fila' })).toBeDefined()
  await ui.unmount()
})

test('the band follows the bridge at every 10 second refresh', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { files, mtimes } = counted(0, 1, 0)
  world(on, { files, mtimes })

  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '1 na fila' })).toBeDefined()

  delete files['.bridge/inbox/010-task.md']
  files['.bridge/working/010-task.md'] = 'task'
  await clock.advance(10_000)
  expect(await ui.find({ type: 'Text', text: '1 rodando' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 na fila' })).toBe(undefined)
  await ui.unmount()
})

test('"Abrir painel" opens the bridge pane on both surfaces', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, { files: DATED, mtimes: MTIMES })

  await $.session.start(START)
  for (const surface of BAND_SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const button = await ui.find({ type: 'Button', key: 'open-pane' })
    expect(button?.props.label).toBe('Abrir painel')
    await ui.press({ key: 'open-pane' })
    await ui.unmount()
  }

  expect(seen.opened).toEqual(['bridge', 'bridge'])
  expect(seen.writes).toEqual([])
})

// ---- the pane's formatting

test('ago says how long ago in seconds, minutes, hours and days', () => {
  expect(ago(0)).toBe('há 0s')
  expect(ago(59_999)).toBe('há 59s')
  expect(ago(60_000)).toBe('há 1 min')
  expect(ago(3 * 60_000 + 20_000)).toBe('há 3 min')
  expect(ago(59 * 60_000)).toBe('há 59 min')
  expect(ago(3_600_000)).toBe('há 1 h')
  expect(ago(23 * 3_600_000)).toBe('há 23 h')
  expect(ago(86_400_000)).toBe('há 1 d')
  expect(ago(9 * 86_400_000)).toBe('há 9 d')
  expect(ago(-5_000)).toBe('há 0s')
})

test('taskLabel splits the number from the slug and reads dashes as spaces', () => {
  expect(taskLabel('052-bridge-mod.md')).toEqual({ number: '052', words: 'bridge mod' })
  expect(taskLabel('057-pane-design.md')).toEqual({ number: '057', words: 'pane design' })
  expect(taskLabel('7-a--b.md')).toEqual({ number: '7', words: 'a b' })
  expect(taskLabel('no-number.md')).toEqual({ number: '', words: 'no number' })
  expect(taskLabel('notes.md')).toEqual({ number: '', words: 'notes' })
})

test('parseNote reads the time, the optional tag and the text', () => {
  expect(parseNote('- 2026-10-13 17:35 [056] Concluída (done)')).toEqual({
    time: '17:35',
    tag: '[056]',
    text: 'Concluída (done)',
  })
  expect(parseNote('- 2026-10-13 17:30 Bridge ativa. [058] na fila')).toEqual({
    time: '17:30',
    tag: '',
    text: 'Bridge ativa. [058] na fila',
  })
  expect(parseNote('free text')).toEqual({ time: '', tag: '', text: 'free text' })
})

test('lastNotes keeps the last entries and joins indented lines to theirs', () => {
  expect(lastNotes('a\nb\n\nc\n  more of c\nd\n', 3)).toEqual(['b', 'c more of c', 'd'])
  expect(lastNotes('', 5)).toEqual([])
})

test('clamp cuts to three lines and closes an open code span', () => {
  expect(clamp('short', 10)).toBe('short')
  expect(clamp('x'.repeat(31), 10)).toBe(`${'x'.repeat(29)}…`)
  expect(clamp(`${'x'.repeat(25)}\`code span\``, 10)).toBe(`${'x'.repeat(25)}\`cod\`…`)
})

// ---- the pane

test('/bridge-panel opens a pane that draws on every surface', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, { files: DATED, mtimes: MTIMES })

  await $.session.start(START)
  const ran = await $.command.run(OPEN)
  expect(ran.text).toBe('Bridge panel opened.')
  expect(seen.opened).toEqual(['bridge'])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = (await ui.findAll({ type: 'Text' })).map(found => found.text)
    const all = text.join('\n')

    // the header: project, doorbell and how fresh the reading is
    expect(text).toContain('project')
    expect(text).toContain('Campainha ok')
    expect(all).toContain('atualizado há 0s')
    // each task: number, slug in words, age from its mtime
    for (const shown of ['há 12s', 'há 3 min', 'há 2 h', 'há 4 d']) {
      expect(text).toContain(shown)
    }
    for (const shown of ['052', '053', '054', '051', 'bridge mod', 'next thing', 'done thing']) {
      expect(all).toContain(shown)
    }
    expect(all).not.toContain('session-notes')
    expect(all).not.toContain('session notes')
    // the last five notes, newest first, as markdown clamped to three lines
    const notes = (await ui.findAll({ type: 'Markdown' })).map(found => found.text)
    expect(notes).toHaveLength(5)
    expect(notes[0]).toBe('Na fila')
    expect(notes[2]).toBe('Despachada: roda `claude plugin validate`')
    expect(notes[4]).toBe('Bridge desligada')
    expect(notes[1]?.endsWith('…')).toBe(true)
    expect((notes[1] ?? '').length <= 3 * 80).toBe(true)
    expect(all).toContain('17:36')
    expect(all).toContain('[057]')
    expect(all).toContain('[stop]')
    await ui.unmount()
  }
})

test('the terminal draws aligned text and no vector', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, { files: DATED, mtimes: MTIMES })

  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = (await ui.findAll({ type: 'Text' })).map(found => found.text)

  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  expect(text).toContain('project  Campainha ok · atualizado há 0s')
  expect(text).toContain('Na fila (2)')
  expect(text).toContain('  053  next thing  há 3 min')
  expect(text).toContain('  054  other       há 2 h')
  expect(text).toContain('Rodando (1)')
  expect(text).toContain('  052  bridge mod  há 12s')
  expect(text).toContain('Para revisar (1)')
  expect(text).toContain('  051  done thing  há 4 d')
  expect(text).toContain('Últimas notas')
  expect(text).toContain('17:36 [057]')
  await ui.unmount()
})

test('the dashboard draws three cards with a large count each', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, { files: DATED, mtimes: MTIMES })

  await $.session.start(START)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const alts = (await ui.findAll({ type: 'Svg' })).map(found => found.props.alt)
    const titles = (await ui.findAll({ type: 'Text' })).map(found => found.text)

    expect(alts).toContain('Na fila: 2')
    expect(alts).toContain('Rodando: 1')
    expect(alts).toContain('Para revisar: 1')
    expect(titles).toContain('Na fila')
    expect(titles).toContain('Rodando')
    expect(titles).toContain('Para revisar')
    expect(titles).toContain('Últimas notas')
    await ui.unmount()
  }
})

test('the cards stack in a narrow pane and sit side by side in a wide one', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, { files: DATED, mtimes: MTIMES })

  await $.session.start(START)
  const directions = async (bodyColumns: number) => {
    const ui = await $.ui.mount({
      ...PANE,
      props: { ...PANE.props, bodyColumns },
      surface: 'desktop',
    })
    const boxes = await ui.findAll({ type: 'Box' })
    await ui.unmount()

    return boxes.map(found => found.props.flexDirection)
  }

  expect(await directions(60)).not.toContain('row')
  expect(await directions(120)).toContain('row')
})

test('an empty bridge says so in every column and in the notes', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, { files: { '.bridge/state.md': 'state' } })

  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = (await ui.findAll({ type: 'Text' })).map(found => found.text)

    expect(text.filter(shown => shown.trim() === 'nada aqui')).toHaveLength(4)
    expect(text.join('\n')).toContain('Sem campainha')
    expect(text.join('\n')).not.toContain('Campainha ok')
    expect(await ui.findAll({ type: 'Markdown' })).toEqual([])
    if (surface === 'terminal') {
      expect(text).toContain('Na fila (0)')
    } else {
      const alts = (await ui.findAll({ type: 'Svg' })).map(found => found.props.alt)
      expect(alts).toContain('Na fila: 0')
      expect(alts).toContain('Rodando: 0')
      expect(alts).toContain('Para revisar: 0')
    }
    await ui.unmount()
  }
})

test('without a .bridge folder the pane says so on every surface', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on)

  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(
      await ui.find({ type: 'Text', text: 'Sem pasta .bridge neste projeto.' }),
    ).toBeDefined()
    await ui.unmount()
  }
})

test('the pane ages its tasks at every 10 second refresh', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on, { files: DATED, mtimes: MTIMES })

  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'há 12s' })).toBeDefined()

  await clock.advance(10_000)
  expect(await ui.find({ type: 'Text', text: 'há 22s' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'há 12s' })).toBe(undefined)
  await ui.unmount()
})

test('the mod never writes a bridge file', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, { files: BRIDGE })

  await $.session.start(START)
  await clock.advance(30_000)
  await $.command.run(OPEN)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.unmount()
  }
  for (const surface of BAND_SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'open-pane' })
    await ui.unmount()
  }

  expect(seen.writes).toEqual([])
})
