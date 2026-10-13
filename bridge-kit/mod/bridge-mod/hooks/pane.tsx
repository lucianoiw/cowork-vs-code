import type { Elements } from 'claude-code'

import type { BridgeSnapshot, BridgeTask } from '../types'
import { ago, clamp, parseNote, taskLabel } from './format'

// The bridge pane's two drawings: a dashboard for the surfaces that draw
// vectors (desktop, VS Code, mobile) and aligned text for the terminal.

type Kind = 'queued' | 'running' | 'review'

const COLUMNS: { kind: Kind; title: string; folder: 'queued' | 'running' | 'outbox' }[] = [
  { kind: 'queued', title: 'Na fila', folder: 'queued' },
  { kind: 'running', title: 'Rodando', folder: 'running' },
  { kind: 'review', title: 'Para revisar', folder: 'outbox' },
]
const EMPTY = 'nada aqui'
const NOTES_TITLE = 'Últimas notas'
const NO_BRIDGE = 'Sem pasta .bridge neste projeto.'
// From this many cells across, the three cards sit side by side.
const WIDE_COLUMNS = 84

// Color is kept for status alone; everything else follows the app's theme.
export const HEX = {
  queued: '#D9A441',
  running: '#5B9FE8',
  review: '#5DB884',
  ok: '#5DB884',
  off: '#E0645C',
  quiet: '#8A8A85',
}
export const THEME = {
  queued: 'warning',
  running: 'suggestion',
  review: 'success',
  ok: 'success',
  off: 'error',
} as const

const doorbellLabel = (now: BridgeSnapshot) =>
  now.doorbell === null ? 'Sem campainha' : 'Campainha ok'
const refreshed = (now: BridgeSnapshot, time: number) =>
  `atualizado ${ago(time - now.refreshedAt)}`
// Newest first, each as time, tag and text.
const notesOf = (now: BridgeSnapshot) => [...now.notes].reverse().map(parseNote)

const SHAPES = {
  queued: '<path d="M2.5 9.5 4.5 3h7l2 6.5V13h-11z"/><path d="M2.5 9.5H6l1 1.8h2l1-1.8h3.5"/>',
  running: '<circle cx="8" cy="8" r="5.8"/><path d="M6.7 5.4 10.6 8l-3.9 2.6z" fill="currentColor"/>',
  review: '<circle cx="8" cy="8" r="5.8"/><path d="M5.3 8.2 7.2 10.1 10.8 6"/>',
  bell: '<path d="M4.2 11V7.3a3.8 3.8 0 0 1 7.6 0V11l1.2 1.3H3z"/><path d="M6.6 13.6a1.5 1.5 0 0 0 2.8 0"/>',
}

const icon = (shape: keyof typeof SHAPES, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${SHAPES[shape].replace('currentColor', color)}</svg>`

const dot = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 12 16"><circle cx="6" cy="9" r="3.2" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`

const COUNT_HEIGHT = 40
const countWidth = (count: number) => String(count).length * 22 + 2
const bigCount = (count: number, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${countWidth(count)}" height="${COUNT_HEIGHT}" viewBox="0 0 ${countWidth(count)} ${COUNT_HEIGHT}"><text x="0" y="32" font-family="-apple-system, 'Segoe UI', system-ui, sans-serif" font-size="36" font-weight="600" fill="${color}">${count}</text></svg>`

type Rich = Pick<Elements['mobile'], 'Box' | 'Text' | 'Svg' | 'Markdown'>
type Plain = Pick<Elements['terminal'], 'Box' | 'Text' | 'Markdown'>

export const drawDashboard = (
  { Box, Text, Svg, Markdown }: Rich,
  now: BridgeSnapshot | null,
  time: number,
  columns: number,
) => {
  if (now === null) {
    return <Text dimColor>{NO_BRIDGE}</Text>
  }

  const isWide = columns >= WIDE_COLUMNS
  const bell = now.doorbell === null ? HEX.off : HEX.ok
  const notes = notesOf(now)
  const chip = (task: BridgeTask) => {
    const { number, words } = taskLabel(task.file)

    return (
      <Box
        borderStyle="round"
        borderColor="subtle"
        paddingX={1}
        columnGap={1}
        flexWrap="wrap"
        justifyContent="space-between"
      >
        <Box columnGap={1}>
          {number !== '' && <Text bold>{number}</Text>}
          <Text>{words}</Text>
        </Box>
        <Text dimColor>{ago(time - task.mtimeMs)}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" rowGap={1} paddingX={1}>
      <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={2}>
        <Box flexDirection="column">
          <Text bold>{now.project}</Text>
          <Text dimColor>{refreshed(now, time)}</Text>
        </Box>
        <Box borderStyle="round" borderColor={bell} paddingX={1} columnGap={1} alignItems="center">
          <Svg source={icon('bell', bell)} alt="campainha" width={16} height={16} />
          <Text bold color={bell}>
            {doorbellLabel(now)}
          </Text>
        </Box>
      </Box>

      <Box flexDirection={isWide ? 'row' : 'column'} gap={1}>
        {COLUMNS.map(column => {
          const tasks = now[column.folder]
          const color = HEX[column.kind]

          return (
            <Box
              flexDirection="column"
              flexGrow={1}
              flexShrink={1}
              {...(isWide ? { width: '33%' } : {})}
              borderStyle="round"
              borderColor="subtle"
              paddingX={1}
            >
              <Box columnGap={1} alignItems="center">
                <Svg source={icon(column.kind, color)} alt={column.title} width={16} height={16} />
                <Text bold>{column.title}</Text>
              </Box>
              <Svg
                source={bigCount(tasks.length, color)}
                alt={`${column.title}: ${tasks.length}`}
                width={countWidth(tasks.length)}
                height={COUNT_HEIGHT}
              />
              {tasks.length === 0 && <Text dimColor>{EMPTY}</Text>}
              {tasks.map(chip)}
            </Box>
          )
        })}
      </Box>

      <Box flexDirection="column">
        <Text bold>{NOTES_TITLE}</Text>
        {notes.length === 0 && <Text dimColor>{EMPTY}</Text>}
        {notes.map(note => (
          <Box columnGap={1} alignItems="flex-start">
            <Svg source={dot(HEX.quiet)} alt="nota" width={12} height={16} />
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Box columnGap={1}>
                {note.time !== '' && <Text dimColor>{note.time}</Text>}
                {note.tag !== '' && <Text bold>{note.tag}</Text>}
              </Box>
              <Markdown text={clamp(note.text, columns - 6)} />
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export const drawText = (
  { Box, Text, Markdown }: Plain,
  now: BridgeSnapshot | null,
  time: number,
  columns: number,
) => {
  if (now === null) {
    return <Text dimColor>{NO_BRIDGE}</Text>
  }

  const labels = COLUMNS.flatMap(column => now[column.folder]).map(task => taskLabel(task.file))
  const numberWidth = Math.max(0, ...labels.map(one => one.number.length))
  const wordsWidth = Math.max(0, ...labels.map(one => one.words.length))
  const notes = notesOf(now)

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{now.project}</Text>
        {'  '}
        <Text color={now.doorbell === null ? THEME.off : THEME.ok}>{doorbellLabel(now)}</Text>
        <Text dimColor>{` · ${refreshed(now, time)}`}</Text>
      </Text>
      {COLUMNS.map(column => {
        const tasks = now[column.folder]

        return (
          <Box flexDirection="column">
            <Text bold color={THEME[column.kind]}>{`${column.title} (${tasks.length})`}</Text>
            {tasks.length === 0 && <Text dimColor>{`  ${EMPTY}`}</Text>}
            {tasks.map(task => {
              const { number, words } = taskLabel(task.file)

              return (
                <Text wrap="truncate-end">
                  {'  '}
                  <Text bold>{number.padEnd(numberWidth)}</Text>
                  {`  ${words.padEnd(wordsWidth)}  `}
                  <Text dimColor>{ago(time - task.mtimeMs)}</Text>
                </Text>
              )
            })}
          </Box>
        )
      })}
      <Text bold>{NOTES_TITLE}</Text>
      {notes.length === 0 && <Text dimColor>{`  ${EMPTY}`}</Text>}
      {notes.map(note => (
        <Box flexDirection="column" paddingLeft={2}>
          {`${note.time} ${note.tag}`.trim() !== '' && (
            <Text dimColor>{`${note.time} ${note.tag}`.trim()}</Text>
          )}
          <Box paddingLeft={2}>
            <Markdown text={clamp(note.text, columns - 4)} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}
