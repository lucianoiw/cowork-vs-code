// Reads a Bash command and says what each `git push` in it needs checked.
// Best effort on the command's spelling: it only ever adds a refusal.

export type PushCheck =
  // the destination is main or master
  | { kind: 'deny' }
  // the destination cannot be read off the command
  | { kind: 'unknown' }
  // no refspec: the destination is the current branch of `cwd`
  // (undefined: the session's working directory)
  | { kind: 'branch'; cwd: string | undefined }

const PROTECTED = /^(main|master)$/
const WRAPPERS = new Set([
  'sudo', 'command', 'exec', 'env', 'time', 'nohup',
  'if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{',
])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'eval'])
const GIT_WITH_VALUE = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path',
  '--config-env',
])
const PUSH_WITH_VALUE = new Set([
  '--repo', '-o', '--push-option', '--receive-pack', '--exec',
])
const PUSH_EVERYTHING = new Set(['--all', '--mirror', '--branches'])

// The command as simple commands of words: split at ; & | ( ) ` and newlines,
// quotes and backslashes read as a shell reads them.
const segments = (command: string): string[][] => {
  const all: string[][] = []
  let words: string[] = []
  let word: string | undefined
  let quote: string | undefined

  const endWord = () => {
    if (word !== undefined) {
      words.push(word)
      word = undefined
    }
  }
  const endSegment = () => {
    endWord()
    if (words.length > 0) {
      all.push(words)
    }
    words = []
  }

  for (let i = 0; i < command.length; i += 1) {
    const c = command.charAt(i)

    if (quote !== undefined) {
      if (c === quote) {
        quote = undefined
      } else if (c === '\\' && quote === '"' && i + 1 < command.length) {
        i += 1
        word = (word ?? '') + command.charAt(i)
      } else {
        word = (word ?? '') + c
      }
    } else if (c === '"' || c === "'") {
      quote = c
      word = word ?? ''
    } else if (c === '\\' && i + 1 < command.length) {
      i += 1
      if (command.charAt(i) !== '\n') {
        word = (word ?? '') + command.charAt(i)
      }
    } else if (';&|()`\n'.includes(c)) {
      endSegment()
    } else if (/\s/.test(c)) {
      endWord()
    } else {
      word = (word ?? '') + c
    }
  }
  endSegment()

  return all
}

// Where `to` lands from `base`; null when it cannot be read off the command.
const enter = (
  base: string | undefined | null,
  to: string | undefined,
): string | undefined | null => {
  if (to === undefined || to === '-' || to.startsWith('~') || to.includes('$')) {
    return null
  }
  if (to.startsWith('/')) {
    return to
  }
  if (base === null) {
    return null
  }

  return base === undefined ? to : `${base}/${to}`
}

const pushCheck = (
  args: readonly string[],
  cwd: string | undefined | null,
): PushCheck | undefined => {
  const positionals: string[] = []
  let isEverything = false
  let isTagsOnly = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? ''

    if (arg === '--') {
      positionals.push(...args.slice(i + 1))
      break
    }
    if (PUSH_WITH_VALUE.has(arg)) {
      i += 1
    } else if (PUSH_EVERYTHING.has(arg)) {
      isEverything = true
    } else if (arg === '--tags') {
      isTagsOnly = true
    } else if (!arg.startsWith('-')) {
      positionals.push(arg)
    }
  }

  if (isEverything) {
    return { kind: 'deny' }
  }

  const refspecs = positionals.slice(1)
  let needsBranch = refspecs.length === 0 && !isTagsOnly

  for (let i = 0; i < refspecs.length; i += 1) {
    const refspec = (refspecs[i] ?? '').replace(/^\+/, '')

    if (refspec === 'tag') {
      i += 1
      continue
    }
    if (refspec.includes('$')) {
      return { kind: 'unknown' }
    }

    const colon = refspec.indexOf(':')
    const destination = colon < 0 ? refspec : refspec.slice(colon + 1)

    if (PROTECTED.test(destination.replace(/^(refs\/)?heads\//, ''))) {
      return { kind: 'deny' }
    }
    if (colon < 0 && (refspec === 'HEAD' || refspec === '@')) {
      needsBranch = true
    }
  }

  if (!needsBranch) {
    return undefined
  }

  return cwd === null ? { kind: 'unknown' } : { kind: 'branch', cwd }
}

export const pushChecks = (command: string): PushCheck[] => {
  const checks: PushCheck[] = []
  let cwd: string | undefined | null

  for (const words of segments(command)) {
    let at = 0
    while (
      at < words.length &&
      (WRAPPERS.has(words[at] ?? '') ||
        /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[at] ?? ''))
    ) {
      at += 1
    }
    const name = words[at] ?? ''

    if (name === 'cd') {
      cwd = enter(cwd, words[at + 1])
    } else if (SHELLS.has(name)) {
      for (const script of words.slice(at + 1)) {
        if (/\s/.test(script)) {
          checks.push(...pushChecks(script))
        }
      }
    } else if (name === 'git' || name.endsWith('/git')) {
      let gitCwd = cwd
      at += 1
      while (at < words.length && (words[at] ?? '').startsWith('-')) {
        const option = words[at] ?? ''
        if (option === '-C') {
          gitCwd = enter(gitCwd, words[at + 1])
        }
        at += GIT_WITH_VALUE.has(option) ? 2 : 1
      }
      if (words[at] === 'push') {
        const check = pushCheck(words.slice(at + 1), gitCwd)
        if (check !== undefined) {
          checks.push(check)
        }
      }
    }
  }

  return checks
}
