import type { AgentInfo, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  ago,
  clamp,
  elapsed,
  lastNotes,
  listedUnder,
  parseNote,
  runningNumbers,
  splitByAgents,
  splitTasks,
  taskLabel,
} from '../hooks/format'

const DENY =
  'bridge-mod: pushing to main/master is blocked; changes reach main only through a PR.'

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
  // what `$.agent.list()` answers; `null`: the list cannot be read
  agents?: AgentInfo[] | null
}

// A subagent of the session as `$.agent.list()` gives it.
const agent = (description: string, status: AgentInfo['status'] = 'running'): AgentInfo => ({
  id: `a-${description}`,
  description,
  type: 'general-purpose',
  status,
})

// The world beneath the mod: a file system, the agent list and git answered
// from memory, and a record of what the mod showed, ran and (never) wrote.
const world = (
  on: On,
  { files = {}, mtimes = {}, branch = 'main', isBroken = false, agents = [] }: World = {},
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
  on('agent.list', () => {
    if (agents === null) {
      throw new Error('no agent list here')
    }

    return { value: agents }
  })
  on('ui.status', (_$, e) => {
    seen.statuses.push(e.text)

    return { value: undefined }
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
// The agent the dispatcher runs task 052 under.
const RUNS_052 = [agent('Task 052 bridge mod')]
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

// ---- no band, no status line

test('without a .bridge folder the mod shows, registers and opens nothing, and still guards', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on)

  await $.session.start(START)
  await clock.advance(30_000)
  const ran = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })

  expect(ran.deny).toBe(DENY)
  expect(seen.statuses).toEqual([])
  expect(seen.commands).toEqual([])
  expect(seen.opened).toEqual([])
})

test('the mod draws nothing above the prompt', async ($, on) => {
  const beneath = '(the engine band)'
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{beneath}</Text>
  })
  mock.clock(on, { now: NOW })
  world(on, { files: DATED, mtimes: MTIMES, agents: RUNS_052 })

  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'bridge-mod',
      component: 'AbovePrompt',
      surface,
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 100,
        scroll: { offset: 0, bodyRows: 9 },
        view: {},
      },
    })
    expect((await ui.findAll({ type: 'Text' })).map(found => found.text)).toEqual([beneath])
    await ui.unmount()
  }
})

test('a busy bridge writes nothing to the status line', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { ...BRIDGE }
  const seen = world(on, { files, agents: RUNS_052 })

  await $.session.start(START)
  expect(seen.commands).toEqual(['bridge-panel'])
  delete files['.bridge/inbox/053-next-thing.md']
  files['.bridge/working/053-next-thing.md'] = 'task'
  await clock.advance(30_000)
  await $.command.run(OPEN)

  expect(seen.statuses).toEqual([])
})

// ---- the pane opens on its own

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

test('the pane opens on its own once a session finds the bridge, and /bridge-panel reopens it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, { files: DATED, mtimes: MTIMES })

  await $.session.start(START)
  expect(seen.opened).toEqual(['bridge'])

  await clock.advance(60_000)
  expect(seen.opened).toEqual(['bridge'])

  const ran = await $.command.run(OPEN)
  expect(ran.text).toBe('Bridge panel opened.')
  expect(seen.opened).toEqual(['bridge', 'bridge'])
})

test('a reload of the mod does not open the pane again', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, { files: DATED, mtimes: MTIMES })

  await $.session.start(START)
  await $.session.start(START)

  expect(seen.opened).toEqual(['bridge'])
})

test('a .bridge folder that appears later opens the pane at the next refresh', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  const seen = world(on, { files })

  await $.session.start(START)
  await clock.advance(10_000)
  expect(seen.opened).toEqual([])
  expect(seen.commands).toEqual([])

  files['.bridge/inbox/070-new.md'] = 'task'
  await clock.advance(10_000)
  expect(seen.commands).toEqual(['bridge-panel'])
  expect(seen.opened).toEqual(['bridge'])

  await clock.advance(30_000)
  expect(seen.opened).toEqual(['bridge'])
})

// ---- which tasks run

test('runningNumbers reads the task numbers the running agents name', () => {
  expect(
    [
      ...runningNumbers([
        agent('Task 175 inbox conversation'),
        agent('177-learn-from-edits'),
        agent('[178] automations'),
        agent('task 075 lower case and zero'),
        agent('Task 190 done long ago', 'completed'),
        agent('Task 191 waits for a message', 'idle'),
        agent('Read the 2026-10-13 notes'),
        { ...agent('no number in the description'), name: 'Task 192 by name' },
      ]),
    ].sort(),
  ).toEqual(['175', '177', '178', '192', '75'])
  expect([...runningNumbers([])]).toEqual([])
})

test('splitByAgents runs the tasks of working/ and inbox/ a running agent names', () => {
  const task = (file: string) => ({ file, mtimeMs: 1 })
  const split = splitByAgents(
    [task('175-inbox-conversation.md'), task('176-blocked.md'), task('075-old.md')],
    [task('177-learn-from-edits.md'), task('notes.md')],
    new Set(['175', '177', '75']),
  )

  expect(split.running.map(one => one.file)).toEqual([
    '075-old.md',
    '175-inbox-conversation.md',
    '177-learn-from-edits.md',
  ])
  expect(split.waiting.map(one => one.file)).toEqual(['176-blocked.md', 'notes.md'])
})

// As on the Postato project: three agents running, five tasks in the folders,
// and a state.md in another format that names none of them as running.
const POSTATO = {
  files: {
    '.bridge/doorbell': 'trig_abc123\n',
    '.bridge/state.md': '# State\n\nRunning: 175, 177, 178\n',
    '.bridge/working/175-inbox-conversation.md': 'task',
    '.bridge/working/177-learn-from-edits.md': 'task',
    '.bridge/working/178-automations.md': 'task',
    '.bridge/working/179-later.md': 'task',
    '.bridge/inbox/180-new.md': 'task',
  },
  mtimes: {
    '.bridge/working/175-inbox-conversation.md': NOW - 72_000,
    '.bridge/working/177-learn-from-edits.md': NOW - 30_000,
    '.bridge/working/178-automations.md': NOW - 5_000,
    '.bridge/working/179-later.md': NOW - 5_000,
    '.bridge/inbox/180-new.md': NOW - 60_000,
  },
  agents: [
    agent('Task 175 inbox conversation'),
    agent('Task 177 learn from edits'),
    agent('Task 178 automations'),
    agent('Explore the repo'),
  ],
}

test('the pane runs what the running agents name, whatever state.md says', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, POSTATO)

  await $.session.start(START)
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = (await terminal.findAll({ type: 'Text' })).map(found => found.text)
  expect(text).toContain('Na fila (5)')
  expect(text).toContain('  ● 175  inbox conversation  rodando 1:12')
  expect(text).toContain('  ● 177  learn from edits    rodando 0:30')
  expect(text).toContain('  ● 178  automations         rodando 0:05')
  expect(text).toContain('  ○ 179  later               aguardando vaga · há 5s')
  expect(text).toContain('  ○ 180  new                 aguardando vaga · há 1 min')
  // running first, then waiting
  expect(text.findIndex(one => one.includes('178')) < text.findIndex(one => one.includes('179'))).toBe(true)
  await terminal.unmount()

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const shown = (await desktop.findAll({ type: 'Text' })).map(found => found.text)
  expect(shown).toContain('3 rodando · 2 aguardando')
  expect(shown.filter(one => one.startsWith('rodando '))).toEqual([
    'rodando 1:12',
    'rodando 0:30',
    'rodando 0:05',
  ])
  expect(shown.filter(one => one.startsWith('aguardando vaga'))).toHaveLength(2)
  const marks = (await desktop.findAll({ type: 'Svg' })).filter(
    found => found.props.alt === 'rodando' || found.props.alt === 'aguardando vaga',
  )
  expect(marks.map(found => found.props.alt)).toEqual([
    'rodando',
    'rodando',
    'rodando',
    'aguardando vaga',
    'aguardando vaga',
  ])
  // running: a blue pulsing dot; waiting: a still amber one
  expect(marks[0]?.props.source).toContain('#5B9FE8')
  expect(marks[0]?.props.source).toContain('<animate')
  expect(marks[3]?.props.source).toContain('#D9A441')
  expect(marks[3]?.props.source).not.toContain('<animate')
  await desktop.unmount()
})

test('a task starts running at the refresh after its agent does', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const agents = [...RUNS_052]
  world(on, { files: DATED, mtimes: MTIMES, agents })

  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '1 rodando · 2 aguardando' })).toBeDefined()

  agents.push(agent('Task 053 next thing'))
  agents[0] = agent('Task 052 bridge mod', 'completed')
  await clock.advance(10_000)
  expect(await ui.find({ type: 'Text', text: '1 rodando · 2 aguardando' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'rodando 3:10' })).toBeDefined()
  await ui.unmount()
})

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

test('without an agent list the pane falls back to state.md', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, {
    files: {
      '.bridge/state.md': STATE,
      '.bridge/working/064-demo.md': 'task',
      '.bridge/working/066-pr.md': 'task',
      '.bridge/inbox/068-new.md': 'task',
    },
    agents: null,
  })

  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '1 rodando · 2 aguardando' })).toBeDefined()
  await ui.unmount()
})

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
  expect(split.waiting.map(one => one.file)).toEqual([
    '010-early.md',
    '066-pr.md',
    '067-unlisted.md',
    '068-new.md',
  ])
})

test('splitTasks falls back to the folders only without a state.md', () => {
  const working = [task('064-demo.md'), task('066-pr.md')]
  const inbox = [task('068-new.md')]

  expect(splitTasks(working, inbox, null)).toEqual({ running: working, waiting: inbox })
  expect(splitTasks(working, inbox, '## Running\n(none)\n')).toEqual({
    running: [],
    waiting: [task('064-demo.md'), task('066-pr.md'), task('068-new.md')],
  })
})

// ---- the pane's formatting

test('elapsed is a clock of minutes and seconds, with hours when there are any', () => {
  expect(elapsed(0)).toBe('0:00')
  expect(elapsed(7_999)).toBe('0:07')
  expect(elapsed(72_000)).toBe('1:12')
  expect(elapsed(59 * 60_000 + 59_000)).toBe('59:59')
  expect(elapsed(3_600_000 + 2 * 60_000 + 5_000)).toBe('1:02:05')
  expect(elapsed(-5_000)).toBe('0:00')
})

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

test('the pane draws on every surface', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, { files: DATED, mtimes: MTIMES, agents: RUNS_052 })

  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = (await ui.findAll({ type: 'Text' })).map(found => found.text)
    const all = text.join('\n')

    // the header: project, doorbell and how fresh the reading is
    expect(text).toContain('project')
    expect(text).toContain('Campainha ok')
    expect(all).toContain('atualizado há 0s')
    // the queue: the running clock, then how long the others wait
    expect(all).toContain('rodando 0:12')
    expect(all).toContain('aguardando vaga · há 3 min')
    expect(all).toContain('aguardando vaga · há 2 h')
    // the delivered reports, explained, with their age
    expect(all).toContain('Relatórios prontos que o Cowork ainda não leu.')
    expect(all).toContain('há 4 d')
    for (const shown of ['052', '053', '054', '051', 'bridge mod', 'next thing', 'done thing']) {
      expect(all).toContain(shown)
    }
    expect(all).not.toContain('session-notes')
    expect(all).not.toContain('session notes')
    expect(all).not.toContain('Rodando')
    expect(all).not.toContain('Para revisar')
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
  world(on, { files: DATED, mtimes: MTIMES, agents: RUNS_052 })

  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = (await ui.findAll({ type: 'Text' })).map(found => found.text)

  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  expect(text).toContain('project  Campainha ok · atualizado há 0s')
  expect(text).toContain('Na fila (3)')
  expect(text).toContain('  ● 052  bridge mod  rodando 0:12')
  expect(text).toContain('  ○ 053  next thing  aguardando vaga · há 3 min')
  expect(text).toContain('  ○ 054  other       aguardando vaga · há 2 h')
  expect(text).toContain('Entregue ao Cowork (1)')
  expect(text).toContain('  Relatórios prontos que o Cowork ainda não leu.')
  expect(text).toContain('  ✓ 051  done thing  há 4 d')
  expect(text).toContain('Últimas notas')
  expect(text).toContain('17:36 [057]')
  await ui.unmount()
})

test('the dashboard draws two cards with a large count each', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, { files: DATED, mtimes: MTIMES, agents: RUNS_052 })

  await $.session.start(START)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const alts = (await ui.findAll({ type: 'Svg' })).map(found => found.props.alt)
    const titles = (await ui.findAll({ type: 'Text' })).map(found => found.text)

    expect(alts).toContain('Na fila: 3')
    expect(alts).toContain('Entregue ao Cowork: 1')
    expect(alts.filter(alt => /: \d+$/.test(String(alt)))).toHaveLength(2)
    expect(titles).toContain('Na fila')
    expect(titles).toContain('1 rodando · 2 aguardando')
    expect(titles).toContain('Entregue ao Cowork')
    expect(titles).toContain('Relatórios prontos que o Cowork ainda não leu.')
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

test('an empty bridge says so in both columns and in the notes', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, { files: { '.bridge/state.md': 'state' } })

  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = (await ui.findAll({ type: 'Text' })).map(found => found.text)

    expect(text.filter(shown => shown.trim() === 'nada aqui')).toHaveLength(3)
    expect(text.join('\n')).toContain('Sem campainha')
    expect(text.join('\n')).not.toContain('Campainha ok')
    expect(await ui.findAll({ type: 'Markdown' })).toEqual([])
    if (surface === 'terminal') {
      expect(text).toContain('Na fila (0)')
      expect(text).toContain('Entregue ao Cowork (0)')
    } else {
      const alts = (await ui.findAll({ type: 'Svg' })).map(found => found.props.alt)
      expect(alts).toContain('Na fila: 0')
      expect(alts).toContain('Entregue ao Cowork: 0')
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
  world(on, { files: DATED, mtimes: MTIMES, agents: RUNS_052 })

  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'rodando 0:12' })).toBeDefined()

  await clock.advance(10_000)
  expect(await ui.find({ type: 'Text', text: 'rodando 0:22' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'rodando 0:12' })).toBe(undefined)
  await ui.unmount()
})

test('the mod never writes a bridge file', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, { files: BRIDGE, agents: RUNS_052 })

  await $.session.start(START)
  await clock.advance(30_000)
  await $.command.run(OPEN)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.unmount()
  }

  expect(seen.writes).toEqual([])
})
