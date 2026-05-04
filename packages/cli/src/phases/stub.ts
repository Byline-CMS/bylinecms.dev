import type { Context } from '../context.js'
import type { Phase, PhaseId } from '../types.js'

export function stubPhase(id: PhaseId, title: string): Phase {
  return {
    id,
    title,
    defaultMode: 'confirm',
    async detect(ctx: Context) {
      return ctx.state.isComplete(id) ? 'done' : 'pending'
    },
    async plan() {
      return {
        writes: [],
        commands: [],
        notes: [`${id}: not yet implemented in @byline/cli ${currentVersion()}`],
      }
    },
    async apply(_plan, ctx) {
      ctx.logger.warn(`${id} — phase is stubbed; please follow the manual instructions in docs`)
      return { state: 'pending' }
    },
  }
}

function currentVersion(): string {
  return '0.1.0'
}
