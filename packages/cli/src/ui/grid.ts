import pc from 'picocolors'

import type { PhaseState } from '../types.js'

const STATE_GLYPH: Record<PhaseState, string> = {
  pending: pc.dim('○'),
  partial: pc.yellow('◐'),
  done: pc.green('●'),
  blocked: pc.red('✕'),
}

const STATE_LABEL: Record<PhaseState, string> = {
  pending: 'pending',
  partial: 'partial',
  done: 'done',
  blocked: 'blocked',
}

export function renderGrid(rows: { id: string; title: string; state: PhaseState }[]): string {
  const idWidth = Math.max(...rows.map((r) => r.id.length), 4)
  const titleWidth = Math.max(...rows.map((r) => r.title.length), 5)
  const lines = rows.map((r) => {
    const id = r.id.padEnd(idWidth)
    const title = r.title.padEnd(titleWidth)
    return `  ${STATE_GLYPH[r.state]} ${pc.bold(id)}  ${title}  ${pc.dim(STATE_LABEL[r.state])}`
  })
  return lines.join('\n')
}
