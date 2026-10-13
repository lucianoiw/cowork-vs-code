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
