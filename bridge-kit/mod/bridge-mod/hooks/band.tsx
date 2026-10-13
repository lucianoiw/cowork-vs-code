import type { Elements, RenderElement } from 'claude-code'

import type { BridgeSnapshot } from '../types'
import { HEX, THEME } from './pane'

// The band above the prompt, the bridge's main indicator: the doorbell, one
// chip per count and a button that opens the pane. A row of rounded chips for
// the surfaces that draw vectors, one line of text for the terminal.

export const OPEN_KEY = 'open-pane'
const LABEL = 'Ponte'
const OPEN_LABEL = 'Abrir painel'
const FREE = 'ponte livre'
const ACTIVE_MS = 3_600_000

const CHIPS = [
  { kind: 'running', folder: 'working', label: 'rodando' },
  { kind: 'queued', folder: 'inbox', label: 'na fila' },
  { kind: 'review', folder: 'outbox', label: 'para revisar' },
] as const

// Shown while a task sits in a folder, or something changed in the last hour.
export const isBandVisible = (now: BridgeSnapshot | null, time: number): now is BridgeSnapshot =>
  now !== null &&
  (now.working.length + now.inbox.length + now.outbox.length > 0 ||
    time - now.changedAt < ACTIVE_MS)

// The chips with something to count; none when the bridge is free.
export const chipsOf = (now: BridgeSnapshot) =>
  CHIPS.filter(chip => now[chip.folder].length > 0).map(chip => ({
    kind: chip.kind,
    text: `${now[chip.folder].length} ${chip.label}`,
  }))

const doorbellAlt = (now: BridgeSnapshot) =>
  now.doorbell === null ? 'Sem campainha' : 'Campainha ok'

const dot = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="16" viewBox="0 0 10 16"><circle cx="5" cy="8.5" r="3.6" fill="${color}"/></svg>`

// A dot with a ring that grows and fades; where nothing animates, the dot alone.
const pulse = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 12 16"><circle cx="6" cy="8.5" r="2.6" fill="none" stroke="${color}" stroke-width="1.2" opacity="0"><animate attributeName="r" values="2.6;5.6" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0" dur="1.6s" repeatCount="indefinite"/></circle><circle cx="6" cy="8.5" r="2.6" fill="${color}"/></svg>`

type Rich = Pick<Elements['desktop'], 'Box' | 'Text' | 'Svg' | 'Button'>
type Plain = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export const drawBand = (
  { Box, Text, Svg, Button }: Rich,
  now: BridgeSnapshot,
  open: () => Promise<void>,
): RenderElement => {
  const bell = now.doorbell === null ? HEX.off : HEX.ok
  const chips = chipsOf(now)

  return (
    <Box
      alignItems="center"
      justifyContent="space-between"
      flexWrap="wrap"
      columnGap={2}
      paddingX={1}
    >
      <Box columnGap={1} alignItems="center">
        <Svg source={dot(bell)} alt={doorbellAlt(now)} width={10} height={16} />
        <Text bold>{LABEL}</Text>
      </Box>
      <Box columnGap={1} alignItems="center" justifyContent="center" flexWrap="wrap" flexGrow={1}>
        {chips.length === 0 && (
          <Box borderStyle="round" borderColor="subtle" paddingX={1}>
            <Text dimColor>{FREE}</Text>
          </Box>
        )}
        {chips.map(chip => (
          <Box
            borderStyle="round"
            borderColor={HEX[chip.kind]}
            paddingX={1}
            columnGap={1}
            alignItems="center"
          >
            {chip.kind === 'running' && (
              <Svg
                source={pulse(HEX.running)}
                alt="em andamento"
                width={12}
                height={16}
                isInteractive
              />
            )}
            <Text bold color={HEX[chip.kind]}>
              {chip.text}
            </Text>
          </Box>
        ))}
      </Box>
      <Button key={OPEN_KEY} label={OPEN_LABEL} onPress={open} />
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
