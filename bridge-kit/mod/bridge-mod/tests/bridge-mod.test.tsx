import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const DENY =
  'bridge-mod: pushing to main/master is blocked; changes reach main only through a PR.'

type World = {
  // path (relative to the project) -> file text; a folder exists when a file
  // is under it. No `.bridge/...` path at all: a project without the bridge.
  files?: Record<string, string>
  // what `git rev-parse --abbrev-ref HEAD` prints
  branch?: string
  // the branch cannot be read: the command itself fails to run
  isBroken?: boolean
}

// The world beneath the mod: a file system and git answered from memory, and
// a record of what the mod showed, ran and (never) wrote.
const world = (
  on: On,
  { files = {}, branch = 'main', isBroken = false }: World = {},
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
      .map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false })),
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

test('without a .bridge folder the guard does nothing', async ($, on) => {
  const seen = world(on)
  const ran = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })

  expect(ran.deny).toBe(undefined)
  expect(seen.ran).toEqual(['git push origin main'])
})

// ---- the status line and the panel

test('without a .bridge folder the mod shows and registers nothing', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on)

  await $.session.start(START)
  await clock.advance(30_000)

  expect(seen.statuses).toEqual([])
  expect(seen.commands).toEqual([])
})

test('the status line counts the task files and refreshes every 10 seconds', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { ...BRIDGE }
  const seen = world(on, { files })

  await $.session.start(START)
  expect(seen.commands).toEqual(['bridge-panel'])
  expect(seen.statuses.at(-1)).toBe('bridge: 1 running · 2 queued · 1 to review')

  delete files['.bridge/inbox/053-next-thing.md']
  files['.bridge/working/053-next-thing.md'] = 'task'
  await clock.advance(9_000)
  expect(seen.statuses.at(-1)).toBe('bridge: 1 running · 2 queued · 1 to review')
  await clock.advance(1_000)
  expect(seen.statuses.at(-1)).toBe('bridge: 2 running · 1 queued · 1 to review')
})

test('the status line clears a minute after the last task ran', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    '.bridge/working/052-bridge-mod.md': 'task',
    '.bridge/outbox/session-notes.md': 'notes',
  }
  const seen = world(on, { files })

  await $.session.start(START)
  expect(seen.statuses.at(-1)).toBe('bridge: 1 running · 0 queued · 0 to review')

  delete files['.bridge/working/052-bridge-mod.md']
  await clock.advance(50_000)
  expect(seen.statuses.at(-1)).toBe('bridge: 0 running · 0 queued · 0 to review')
  await clock.advance(20_000)
  expect(seen.statuses.at(-1)).toBe(undefined)
})

test('an idle bridge shows no status line', async ($, on) => {
  mock.clock(on)
  const seen = world(on, { files: { '.bridge/outbox/session-notes.md': 'notes' } })

  await $.session.start(START)

  expect(seen.statuses).toEqual([undefined])
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

test('/bridge-panel opens a pane listing tasks, doorbell and notes', async ($, on) => {
  mock.clock(on)
  const seen = world(on, { files: BRIDGE })

  await $.session.start(START)
  const ran = await $.command.run({
    command: 'bridge-panel',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  expect(ran.text).toBe('Bridge panel opened.')
  expect(seen.opened).toEqual(['bridge'])

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = (await ui.findAll({ type: 'Text' })).map(found => found.text)

    expect(text).toContain('Running (working): 1')
    expect(text).toContain('  052 bridge-mod')
    expect(text).toContain('Queued (inbox): 2')
    expect(text).toContain('  053 next-thing')
    expect(text).toContain('  054 other')
    expect(text).toContain('To review (outbox): 1')
    expect(text).toContain('  051 done-thing')
    expect(text).toContain('Doorbell: trig_abc123')
    expect(text).toContain('  n3')
    expect(text).toContain('  n7')
    expect(text).not.toContain('  n2')
    expect(text).not.toContain('  session-notes')
    await ui.unmount()
  }
})

test('the pane says when there is no doorbell', async ($, on) => {
  mock.clock(on)
  world(on, { files: { '.bridge/inbox/001-first.md': 'task' } })

  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: 'Doorbell: no doorbell' })).toBeDefined()
  await ui.unmount()
})

test('the mod never writes a bridge file', async ($, on) => {
  const clock = mock.clock(on)
  const seen = world(on, { files: BRIDGE })

  await $.session.start(START)
  await clock.advance(30_000)
  await $.command.run({
    command: 'bridge-panel',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })

  expect(seen.writes).toEqual([])
})
