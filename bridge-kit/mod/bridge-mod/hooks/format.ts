// The pane's text formatting: pure functions, PT-BR output.

// How long ago, from a span in milliseconds: `há 12s`, `há 3 min`, `há 2 h`,
// `há 4 d`. A negative span (a clock that moved back) reads as zero.
export const ago = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) {
    return `há ${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `há ${minutes} min`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `há ${hours} h`
  }

  return `há ${Math.floor(hours / 24)} d`
}

// `052-bridge-mod.md` is task `052`, `bridge mod`; a file with no leading
// number has an empty number and its whole name as words.
export const taskLabel = (file: string) => {
  const name = file.replace(/\.md$/, '')
  const parts = /^(\d+)-(.+)$/.exec(name)
  const number = parts?.[1] ?? ''
  const slug = parts?.[2] ?? name

  return { number, words: slug.replace(/-+/g, ' ').trim() }
}

export type Note = { time: string; tag: string; text: string }

// `- 2026-10-13 17:35 [056] Concluída` is time `17:35`, tag `[056]` and the
// text; the tag is optional, and a line of another shape is all text.
export const parseNote = (entry: string): Note => {
  const parts = /^-\s+\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2})\s+(?:(\[[^\]]+\])\s+)?([\s\S]*)$/.exec(
    entry,
  )

  return parts === null
    ? { time: '', tag: '', text: entry.replace(/^-\s+/, '') }
    : { time: parts[1] ?? '', tag: parts[2] ?? '', text: parts[3] ?? '' }
}

// The last `count` entries of the notes file, oldest first: one per line, an
// indented line continuing the entry above it.
export const lastNotes = (text: string, count: number) => {
  const entries: string[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue
    }
    if (/^\s/.test(line) && entries.length > 0) {
      entries[entries.length - 1] += ` ${line.trim()}`
    } else {
      entries.push(line.trimEnd())
    }
  }

  return entries.slice(-count)
}

// Cuts markdown to `lines` rows of `columns` cells, ending in an ellipsis,
// and closes a code span the cut left open.
export const clamp = (text: string, columns: number, lines = 3) => {
  const room = Math.max(1, columns) * lines
  if (text.length <= room) {
    return text
  }
  const cut = text.slice(0, room - 1).trimEnd()
  const isCodeOpen = (cut.match(/`/g) ?? []).length % 2 === 1

  return `${cut}${isCodeOpen ? '`' : ''}…`
}

// A running task's clock, from a span in milliseconds: `0:07`, `1:12`,
// `1:02:05`. A negative span reads as zero.
export const elapsed = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const two = (value: number) => String(value).padStart(2, '0')
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  return hours > 0
    ? `${hours}:${two(minutes)}:${two(seconds % 60)}`
    : `${minutes}:${two(seconds % 60)}`
}

// The tasks the bullets under `## <heading>` of state.md name, each by its
// file (`068-band-v2.md`) or, with no file on the line, its leading number.
export const listedUnder = (state: string, heading: string) => {
  const listed: string[] = []
  let isInside = false
  for (const line of state.split('\n')) {
    if (line.startsWith('#')) {
      isInside = line.replace(/^#+\s*/, '').toLowerCase().startsWith(heading.toLowerCase())
      continue
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)?.[1]
    if (!isInside || bullet === undefined) {
      continue
    }
    const name = /[\w.-]+\.md\b/.exec(bullet)?.[0] ?? /^\d+/.exec(bullet)?.[0]
    if (name !== undefined) {
      listed.push(name)
    }
  }

  return listed
}

type Task = { file: string; mtimeMs: number }

const byFile = (a: Task, b: Task) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)

// A task number as a key: `075` and `75` are the same task.
const numberKey = (number: string) => String(Number(number))

// The fallback for when the agent list is unavailable. The watcher moves every
// task to `working/` at once, so with a state.md only the ones under its
// `## Running` run and the rest of `working/` waits with `inbox/`; without one,
// all of `working/` runs.
export const splitTasks = (working: Task[], inbox: Task[], state: string | null) => {
  if (state === null) {
    return { running: working, waiting: inbox }
  }
  const listed = new Set(listedUnder(state, 'Running'))
  const isRunning = (task: Task) =>
    listed.has(task.file) || listed.has(taskLabel(task.file).number)

  return {
    running: working.filter(isRunning),
    waiting: [...inbox, ...working.filter(task => !isRunning(task))].sort(byFile),
  }
}

type Agent = { status: string; description: string; name?: string }

// The task numbers the running agents name, in their name or description, as
// `Task 175 inbox conversation`, `175-inbox-conversation` or `[175]`.
export const runningNumbers = (agents: readonly Agent[]) => {
  const numbers = new Set<string>()
  for (const agent of agents) {
    if (agent.status !== 'running') {
      continue
    }
    for (const text of [agent.name ?? '', agent.description]) {
      for (const match of text.matchAll(/\btask\s+(\d+)\b|\[(\d+)\]|(?:^|[^\w-])(\d+)-(?=[a-z])/gi)) {
        numbers.add(numberKey(match[1] ?? match[2] ?? match[3] ?? ''))
      }
    }
  }

  return numbers
}

// Which tasks of `working/` and `inbox/` run: those whose number a running
// agent names. The rest wait for a free slot.
export const splitByAgents = (working: Task[], inbox: Task[], numbers: ReadonlySet<string>) => {
  const all = [...working, ...inbox].sort(byFile)
  const isRunning = (task: Task) => {
    const { number } = taskLabel(task.file)

    return number !== '' && numbers.has(numberKey(number))
  }

  return { running: all.filter(isRunning), waiting: all.filter(task => !isRunning(task)) }
}

// The task numbers a task's `Depends: 003, 004` header line names.
export const dependsOn = (text: string) => {
  const line = /^Depends:(.*)$/m.exec(text)?.[1] ?? ''

  return [...line.matchAll(/\d+/g)].map(match => match[0])
}

// The task numbers of the files in done/ and read/: the tasks that are over.
export const finishedNumbers = (files: readonly string[]) =>
  new Set(
    files
      .map(file => taskLabel(file).number)
      .filter(number => number !== '')
      .map(numberKey),
  )

// The dependencies that are not over yet.
export const unmetDepends = (depends: readonly string[], finished: ReadonlySet<string>) =>
  depends.filter(number => !finished.has(numberKey(number)))
