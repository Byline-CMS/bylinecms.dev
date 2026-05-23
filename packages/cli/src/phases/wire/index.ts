import { wireBylineLayoutTsx } from './byline-layout-tsx.js'
import { wireServerTs } from './server-ts.js'
import { wireServerUploads } from './server-uploads.js'
import { wireStartTs } from './start-ts.js'
import { wireTsconfig } from './tsconfig.js'
import { wireViteConfig } from './vite-config.js'
import type { Phase, PhaseResult, PhaseState } from '../../types.js'
import type { SubEdit, SubEditResult } from './shared.js'

// Order matters: `wireServerTs` injects the side-effect import for
// `byline/server.config` at the top of `src/server.ts`; `wireServerUploads`
// then runs in the same file to wrap the `fetch` handler with the runtime
// uploads helper. The two sub-edits are independent, but keeping them
// adjacent makes the resulting diff easier to read.
const SUB_EDITS: SubEdit[] = [
  wireServerTs,
  wireServerUploads,
  wireStartTs,
  wireBylineLayoutTsx,
  wireTsconfig,
  wireViteConfig,
]

export const wirePhase: Phase = {
  id: 'wire',
  title: 'Wire — inject imports + path mappings + verify vite.config.ts',
  defaultMode: 'confirm',

  async detect(ctx) {
    if (ctx.state.isComplete('wire')) return 'done'
    return 'pending'
  },

  async plan(ctx) {
    const notes: string[] = []
    for (const sub of SUB_EDITS) {
      const r = await sub.preview(ctx)
      notes.push(formatNote(sub.key, r))
    }
    return { writes: [], commands: [], notes }
  },

  async apply(_plan, ctx): Promise<PhaseResult> {
    const results: { key: string; result: SubEditResult }[] = []
    for (const sub of SUB_EDITS) {
      const r = await sub.apply(ctx)
      results.push({ key: sub.key, result: r })
      ctx.state.setWireSubEdit(sub.key, persistableStatus(r.status))

      switch (r.status) {
        case 'done':
          ctx.logger.success(`  ${sub.key}: ${r.message}`)
          break
        case 'skipped':
          ctx.logger.info(`  ${sub.key}: ${r.message}`)
          break
        case 'manual':
          ctx.logger.warn(`  ${sub.key}: ${r.message}`)
          if (r.snippet) {
            ctx.prompter.note(r.snippet, `${sub.key}: paste this manually`)
          }
          break
        case 'blocked':
          ctx.logger.error(`  ${sub.key}: ${r.message}`)
          break
      }
    }

    return { state: aggregateState(results.map((r) => r.result)) }
  },
}

function formatNote(key: string, r: SubEditResult): string {
  const tag =
    r.status === 'done' ? '+' : r.status === 'skipped' ? '✓' : r.status === 'manual' ? '!' : '✗'
  return `  ${tag} ${key}: ${r.message}`
}

function persistableStatus(s: SubEditResult['status']): 'pending' | 'done' | 'manual' | 'skipped' {
  if (s === 'blocked') return 'pending'
  return s
}

function aggregateState(results: SubEditResult[]): PhaseState {
  if (results.some((r) => r.status === 'blocked')) return 'blocked'
  if (results.some((r) => r.status === 'manual')) return 'partial'
  return 'done'
}
