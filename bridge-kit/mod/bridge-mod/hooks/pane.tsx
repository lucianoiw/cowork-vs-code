import type { Elements, RenderElement } from 'claude-code'

import type { BridgeSnapshot, BridgeTask } from '../types'
import { ago, clamp, elapsed, parseNote, taskLabel } from './format'

// The bridge pane's two drawings: a dashboard for the surfaces that draw
// vectors (desktop, VS Code, mobile) and aligned text for the terminal.

const QUEUE_TITLE = 'Na fila'
const OUTBOX_TITLE = 'Entregue ao Cowork'
const OUTBOX_NOTE = 'Relatórios prontos que o Cowork ainda não leu.'
const RUNNING = 'rodando'
const WAITING = 'aguardando vaga'
const EMPTY = 'nada aqui'
const NOTES_TITLE = 'Últimas notas'
const NO_BRIDGE = 'Sem pasta .bridge neste projeto.'
// From this many cells across, the two cards sit side by side.
const WIDE_COLUMNS = 84

// Color is kept for status alone; everything else follows the app's theme.
export const HEX = {
  waiting: '#D9A441',
  running: '#5B9FE8',
  delivered: '#5DB884',
  ok: '#5DB884',
  off: '#E0645C',
  quiet: '#8A8A85',
}
export const THEME = {
  waiting: 'warning',
  running: 'suggestion',
  delivered: 'success',
  ok: 'success',
  off: 'error',
} as const

const doorbellLabel = (now: BridgeSnapshot) =>
  now.doorbell === null ? 'Sem campainha' : 'Campainha ok'
const refreshed = (now: BridgeSnapshot, time: number) =>
  `atualizado ${ago(time - now.refreshedAt)}`
// Newest first, each as time, tag and text.
const notesOf = (now: BridgeSnapshot) => [...now.notes].reverse().map(parseNote)

// The queue: running tasks first, then the ones waiting for a slot.
type Queued = BridgeTask & { isRunning: boolean }
const queueOf = (now: BridgeSnapshot): Queued[] => [
  ...now.running.map(task => ({ ...task, isRunning: true })),
  ...now.waiting.map(task => ({ ...task, isRunning: false })),
]
// What a queued task's chip says on its right: its clock, or how long it waits.
const stateOf = (task: Queued, time: number) =>
  task.isRunning
    ? `${RUNNING} ${elapsed(time - task.mtimeMs)}`
    : `${WAITING} · ${ago(time - task.mtimeMs)}`
const queueSummary = (now: BridgeSnapshot) =>
  `${now.running.length} ${RUNNING} · ${now.waiting.length} aguardando`

const SHAPES = {
  queue: '<path d="M2.5 9.5 4.5 3h7l2 6.5V13h-11z"/><path d="M2.5 9.5H6l1 1.8h2l1-1.8h3.5"/>',
  delivered: '<path d="M2.2 8.3 13.6 2.6 11 13.4 7.6 10.2z"/><path d="M7.6 10.2 13.6 2.6"/><path d="M7.6 10.2V13.6l1.7-1.9"/>',
  bell: '<path d="M4.2 11V7.3a3.8 3.8 0 0 1 7.6 0V11l1.2 1.3H3z"/><path d="M6.6 13.6a1.5 1.5 0 0 0 2.8 0"/>',
}

const icon = (shape: keyof typeof SHAPES, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${SHAPES[shape]}</svg>`

const ring = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 12 16"><circle cx="6" cy="9" r="3.2" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`

const dot = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 12 16"><circle cx="6" cy="8.5" r="3.2" fill="${color}"/></svg>`

// A dot with a ring that grows and fades; where nothing animates, the dot alone.
const pulse = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 12 16"><circle cx="6" cy="8.5" r="2.6" fill="none" stroke="${color}" stroke-width="1.2" opacity="0"><animate attributeName="r" values="2.6;5.6" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0" dur="1.6s" repeatCount="indefinite"/></circle><circle cx="6" cy="8.5" r="2.6" fill="${color}"/></svg>`

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
  const queue = queueOf(now)
  const chip = (task: BridgeTask, mark: [string, string] | null, right: string, color?: string) => {
    const { number, words } = taskLabel(task.file)

    return (
      <Box
        borderStyle="round"
        borderColor={color ?? 'subtle'}
        paddingX={1}
        columnGap={1}
        flexWrap="wrap"
        justifyContent="space-between"
      >
        <Box columnGap={1} alignItems="center">
          {mark !== null && <Svg source={mark[0]} alt={mark[1]} width={12} height={16} />}
          {number !== '' && <Text bold>{number}</Text>}
          <Text>{words}</Text>
        </Box>
        {color === undefined ? <Text dimColor>{right}</Text> : <Text color={color}>{right}</Text>}
      </Box>
    )
  }
  const card = (
    shape: keyof typeof SHAPES,
    title: string,
    color: string,
    count: number,
    caption: string,
    body: RenderElement[],
  ) => (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      {...(isWide ? { width: '50%' } : {})}
      borderStyle="round"
      borderColor="subtle"
      paddingX={1}
    >
      <Box columnGap={1} alignItems="center">
        <Svg source={icon(shape, color)} alt={title} width={16} height={16} />
        <Text bold>{title}</Text>
      </Box>
      <Box columnGap={1} alignItems="flex-end" flexWrap="wrap">
        <Svg
          source={bigCount(count, color)}
          alt={`${title}: ${count}`}
          width={countWidth(count)}
          height={COUNT_HEIGHT}
        />
        <Text dimColor>{caption}</Text>
      </Box>
      {body.length === 0 && <Text dimColor>{EMPTY}</Text>}
      {body}
    </Box>
  )

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
        {card(
          'queue',
          QUEUE_TITLE,
          now.running.length > 0 ? HEX.running : HEX.waiting,
          queue.length,
          queueSummary(now),
          queue.map(task =>
            task.isRunning
              ? chip(task, [pulse(HEX.running), RUNNING], stateOf(task, time), HEX.running)
              : chip(task, [dot(HEX.waiting), WAITING], stateOf(task, time)),
          ),
        )}
        {card(
          'delivered',
          OUTBOX_TITLE,
          HEX.delivered,
          now.outbox.length,
          OUTBOX_NOTE,
          now.outbox.map(task => chip(task, null, ago(time - task.mtimeMs))),
        )}
      </Box>

      <Box flexDirection="column">
        <Text bold>{NOTES_TITLE}</Text>
        {notes.length === 0 && <Text dimColor>{EMPTY}</Text>}
        {notes.map(note => (
          <Box columnGap={1} alignItems="flex-start">
            <Svg source={ring(HEX.quiet)} alt="nota" width={12} height={16} />
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

  const queue = queueOf(now)
  const labels = [...queue, ...now.outbox].map(task => taskLabel(task.file))
  const numberWidth = Math.max(0, ...labels.map(one => one.number.length))
  const wordsWidth = Math.max(0, ...labels.map(one => one.words.length))
  const notes = notesOf(now)
  const name = (task: BridgeTask) => {
    const { number, words } = taskLabel(task.file)

    return [number.padEnd(numberWidth), words.padEnd(wordsWidth)] as const
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{now.project}</Text>
        {'  '}
        <Text color={now.doorbell === null ? THEME.off : THEME.ok}>{doorbellLabel(now)}</Text>
        <Text dimColor>{` · ${refreshed(now, time)}`}</Text>
      </Text>

      <Text bold>{`${QUEUE_TITLE} (${queue.length})`}</Text>
      {queue.length === 0 && <Text dimColor>{`  ${EMPTY}`}</Text>}
      {queue.map(task => {
        const [number, words] = name(task)
        const color = task.isRunning ? THEME.running : THEME.waiting

        return (
          <Text wrap="truncate-end">
            {'  '}
            <Text color={color}>{task.isRunning ? '●' : '○'}</Text>
            {' '}
            <Text bold>{number}</Text>
            {`  ${words}  `}
            {task.isRunning ? (
              <Text color={color}>{stateOf(task, time)}</Text>
            ) : (
              <Text dimColor>{stateOf(task, time)}</Text>
            )}
          </Text>
        )
      })}

      <Text bold>{`${OUTBOX_TITLE} (${now.outbox.length})`}</Text>
      <Text dimColor>{`  ${OUTBOX_NOTE}`}</Text>
      {now.outbox.length === 0 && <Text dimColor>{`  ${EMPTY}`}</Text>}
      {now.outbox.map(task => {
        const [number, words] = name(task)

        return (
          <Text wrap="truncate-end">
            {'  '}
            <Text color={THEME.delivered}>✓</Text>
            {' '}
            <Text bold>{number}</Text>
            {`  ${words}  `}
            <Text dimColor>{ago(time - task.mtimeMs)}</Text>
          </Text>
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
