import type { Elements, RenderElement } from 'claude-code'

import type { BridgeSnapshot } from '../types'
import { clip, elapsed, parseNote, taskLabel } from './format'
import { HEX, THEME } from './pane'

// The band above the prompt, the bridge's main indicator. Where vectors draw:
// the doorbell, one filled chip per count, the running tasks with their
// clocks, the last note and a button that opens the pane, over a thin bar
// split in the three counts. On the terminal, one line of text.

export const OPEN_KEY = 'open-pane'
const LABEL = 'Ponte'
const OPEN_LABEL = 'Abrir painel'
const FREE = 'ponte livre'
const ACTIVE_MS = 3_600_000
// At most this many running tasks are named, each slug cut to this length.
const MAX_ITEMS = 3
const SLUG_CHARS = 16
// The last note is cut to this length, and left out with less room than that.
const NOTE_CHARS = 60
const NOTE_MIN_CHARS = 16

const CHIPS = [
  { kind: 'running', folder: 'running', label: 'rodando' },
  { kind: 'queued', folder: 'queued', label: 'na fila' },
  { kind: 'review', folder: 'outbox', label: 'para revisar' },
] as const

// A chip's fill: its status color deep enough for white text in both themes.
export const FILL = { running: '#2B6CD4', queued: '#946200', review: '#1E7D4B' }
const ON_FILL = '#FFFFFF'

// Shown while a task sits in a folder, or something changed in the last hour.
export const isBandVisible = (now: BridgeSnapshot | null, time: number): now is BridgeSnapshot =>
  now !== null &&
  (now.running.length + now.queued.length + now.outbox.length > 0 ||
    time - now.changedAt < ACTIVE_MS)

// The chips with something to count; none when the bridge is free.
export const chipsOf = (now: BridgeSnapshot) =>
  CHIPS.filter(chip => now[chip.folder].length > 0).map(chip => ({
    kind: chip.kind,
    text: `${now[chip.folder].length} ${chip.label}`,
  }))

// The running tasks named in the band: `064`, `demo`, `1:12`.
export const runningOf = (now: BridgeSnapshot, time: number) =>
  now.running.slice(0, MAX_ITEMS).map(task => {
    const { number, words } = taskLabel(task.file)

    return { number, words: clip(words, SLUG_CHARS), clock: elapsed(time - task.mtimeMs) }
  })

// The newest note's text, without its date and tag; empty with no notes.
export const lastNoteOf = (now: BridgeSnapshot) => {
  const last = now.notes[now.notes.length - 1]

  return last === undefined ? '' : parseNote(last).text
}

const doorbellAlt = (now: BridgeSnapshot) =>
  now.doorbell === null ? 'Sem campainha' : 'Campainha ok'

const dot = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="16" viewBox="0 0 10 16"><circle cx="5" cy="8.5" r="3.6" fill="${color}"/></svg>`

// A dot with a ring that grows and fades; where nothing animates, the dot alone.
const pulse = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 12 16"><circle cx="6" cy="8.5" r="2.6" fill="none" stroke="${color}" stroke-width="1.2" opacity="0"><animate attributeName="r" values="2.6;5.6" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0" dur="1.6s" repeatCount="indefinite"/></circle><circle cx="6" cy="8.5" r="2.6" fill="${color}"/></svg>`

const BAR_WIDTH = 2000
const BAR_HEIGHT = 4
const BAR_GAP = 6
const BAR_COLORS = [HEX.queued, HEX.running, HEX.review]

// Where the queued, running and to-review segments sit along the bar, each as
// wide as its share; a count of zero takes no room and no gap.
export const barSegments = (counts: readonly number[]) => {
  const total = counts.reduce((sum, count) => sum + count, 0)
  const shown = counts.filter(count => count > 0).length
  const room = BAR_WIDTH - BAR_GAP * Math.max(0, shown - 1)
  const edge = (tasks: number) => (total === 0 ? 0 : Math.round((room * tasks) / total))
  // the tasks and the gaps to the left of the segment being placed
  let tasks = 0
  let gaps = 0

  return counts.map(count => {
    const segment = { x: edge(tasks) + gaps * BAR_GAP, width: edge(tasks + count) - edge(tasks) }
    tasks += count
    gaps += count > 0 && tasks < total ? 1 : 0

    return segment
  })
}

// The bar's drawing; given the counts before a change, each segment slides
// from where it was (once: the next reading draws it still).
export const bar = (counts: readonly number[], from: readonly number[] | null) => {
  const now = barSegments(counts)
  const before = from === null ? null : barSegments(from)
  const slide = (attribute: 'x' | 'width', start: number, end: number) =>
    `<animate attributeName="${attribute}" from="${start}" to="${end}" dur="0.6s" calcMode="spline" keyTimes="0;1" keySplines="0.2 0 0 1" fill="freeze"/>`
  const segments = now
    .map((segment, index) => {
      const was = before?.[index]
      if (segment.width === 0 && (was === undefined || was.width === 0)) {
        return ''
      }

      return `<rect x="${segment.x}" y="0" width="${segment.width}" height="${BAR_HEIGHT}" rx="2" fill="${BAR_COLORS[index]}">${was === undefined ? '' : slide('x', was.x, segment.x) + slide('width', was.width, segment.width)}</rect>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" viewBox="0 0 ${BAR_WIDTH} ${BAR_HEIGHT}" preserveAspectRatio="none"><rect x="0" y="0" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" rx="2" fill="${HEX.quiet}" opacity="0.25"/>${segments}</svg>`
}

type Rich = Pick<Elements['desktop'], 'Box' | 'Text' | 'Svg' | 'Button'>
type Plain = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export const drawBand = (
  { Box, Text, Svg, Button }: Rich,
  now: BridgeSnapshot,
  time: number,
  columns: number,
  open: () => Promise<void>,
): RenderElement => {
  const bell = now.doorbell === null ? HEX.off : HEX.ok
  const chips = chipsOf(now)
  const counts = [now.queued.length, now.running.length, now.outbox.length]

  // What the row has room for, in cells: the label, the chips and the button
  // always; then the running tasks that fit, then the note in what is left.
  let used =
    LABEL.length + 4 + OPEN_LABEL.length + 6 +
    (chips.length === 0
      ? FREE.length + 5
      : chips.reduce((sum, chip) => sum + chip.text.length + 5, 0))
  const items = runningOf(now, time).filter(item => {
    const width = `${item.number} ${item.words} · ${item.clock}`.length + 2
    const fits = used + width <= columns
    used += fits ? width : 0

    return fits
  })
  const noteRoom = Math.min(NOTE_CHARS, columns - used - 2)
  const note = noteRoom >= NOTE_MIN_CHARS ? clip(lastNoteOf(now), noteRoom) : ''

  return (
    <Box flexDirection="column">
      <Box alignItems="center" justifyContent="space-between" columnGap={2} paddingX={1}>
        <Box columnGap={1} alignItems="center" flexShrink={0}>
          <Svg source={dot(bell)} alt={doorbellAlt(now)} width={10} height={16} />
          <Text bold>{LABEL}</Text>
          {chips.length === 0 && (
            <Box borderStyle="round" borderColor="subtle" paddingX={1}>
              <Text dimColor>{FREE}</Text>
            </Box>
          )}
          {chips.map(chip => (
            <Box
              borderStyle="round"
              borderColor={FILL[chip.kind]}
              backgroundColor={FILL[chip.kind]}
              paddingX={1}
              columnGap={1}
              alignItems="center"
            >
              {chip.kind === 'running' && (
                <Svg
                  source={pulse(ON_FILL)}
                  alt="em andamento"
                  width={12}
                  height={16}
                  isInteractive
                />
              )}
              <Text bold color={ON_FILL}>
                {chip.text}
              </Text>
            </Box>
          ))}
          {items.map(item => (
            <Box columnGap={1} paddingLeft={1}>
              {item.number !== '' && (
                <Text bold color={HEX.running}>
                  {item.number}
                </Text>
              )}
              <Text>{item.words}</Text>
              <Text dimColor>{`· ${item.clock}`}</Text>
            </Box>
          ))}
        </Box>
        <Box columnGap={2} alignItems="center" justifyContent="flex-end" flexShrink={1}>
          {note !== '' && (
            <Text dimColor wrap="truncate-end">
              {note}
            </Text>
          )}
          <Button key={OPEN_KEY} label={OPEN_LABEL} onPress={open} />
        </Box>
      </Box>
      <Svg
        source={bar(counts, now.shift)}
        alt={`Na fila ${counts[0]}, rodando ${counts[1]}, para revisar ${counts[2]}`}
        height={3}
        {...(now.shift === null ? {} : { isInteractive: true })}
      />
    </Box>
  )
}

export const drawBandText = (
  { Box, Text, Button }: Plain,
  now: BridgeSnapshot,
  open: () => Promise<void>,
): RenderElement => {
  const chips = chipsOf(now)

  return (
    <Box columnGap={2}>
      <Text wrap="truncate-end">
        <Text color={now.doorbell === null ? THEME.off : THEME.ok}>●</Text>
        {` ${LABEL.toLowerCase()}: `}
        {chips.length === 0 && <Text dimColor>{FREE}</Text>}
        {chips.map((chip, index) => (
          <Text>
            {index > 0 && <Text dimColor>{' · '}</Text>}
            <Text color={THEME[chip.kind]}>{chip.text}</Text>
          </Text>
        ))}
      </Text>
      <Button key={OPEN_KEY} label={OPEN_LABEL} plain dimColor onPress={open} />
    </Box>
  )
}
