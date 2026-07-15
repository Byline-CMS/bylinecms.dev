import { existsSync, readFileSync } from 'node:fs'

import { renderDiff } from './ui/diff.js'
import type { Context } from './context.js'
import type { Phase, PhaseState, Plan } from './types.js'

/**
 * Returned phase state — caller decides whether to continue. `'blocked'`
 * means the next phase should NOT run; `'partial'` is a soft warning
 * (e.g. wire phase had a manual sub-edit) and the caller may continue.
 */
export async function runPhase(phase: Phase, ctx: Context): Promise<PhaseState> {
  const detected = await phase.detect(ctx)
  if (detected === 'done' && !ctx.cliFlags.force) {
    ctx.logger.success(`${phase.id} — already complete`)
    return 'done'
  }
  if (detected === 'blocked') {
    ctx.logger.error(`${phase.id} — blocked; cannot proceed`)
    return 'blocked'
  }

  ctx.logger.step(`${phase.id} — planning`)
  const plan = await phase.plan(ctx)

  if (plan.writes.length === 0 && plan.commands.length === 0 && plan.notes.length === 0) {
    ctx.logger.info(`${phase.id} — nothing to do`)
    ctx.state.markPhaseComplete(phase.id)
    ctx.state.flush()
    return 'done'
  }

  previewPlan(phase, plan, ctx)

  if (ctx.dryRun) {
    ctx.logger.info(`${phase.id} — dry-run; skipping apply`)
    return 'pending'
  }

  const shouldApply = await decideApply(phase, ctx)
  if (!shouldApply) {
    ctx.logger.warn(`${phase.id} — skipped by user`)
    return 'pending'
  }

  const result = await phase.apply(plan, ctx)
  if (result.notes) for (const n of result.notes) ctx.logger.info(n)

  if (result.state === 'done') {
    ctx.state.markPhaseComplete(phase.id)
    ctx.logger.success(`${phase.id} — done`)
  } else if (result.state === 'partial') {
    ctx.logger.warn(`${phase.id} — partial; re-run to finish`)
  } else if (result.state === 'blocked') {
    ctx.logger.error(`${phase.id} — blocked`)
  }
  ctx.state.flush()
  return result.state
}

function previewPlan(phase: Phase, plan: Plan, ctx: Context): void {
  ctx.logger.raw('')
  ctx.logger.raw(`  ${phase.title}`)
  for (const note of plan.notes) ctx.logger.raw(`    • ${note}`)
  for (const w of plan.writes) {
    const before = w.before ?? readIfExists(w.path)
    const label = w.mode === 'delete' ? 'delete' : before ? 'modify' : 'create'
    ctx.logger.raw(`    ${label}  ${w.path}`)
    if (before !== w.contents) {
      ctx.logger.raw(renderDiff(w.path, before, w.contents))
    }
  }
  for (const c of plan.commands) {
    ctx.logger.raw(`    run     ${c.command} ${c.args.join(' ')}`)
  }
  ctx.logger.raw('')
}

async function decideApply(phase: Phase, ctx: Context): Promise<boolean> {
  // `auto` phases don't gather user-visible writes (e.g. `prompts` just
  // collects answers, `deps` runs npm/pnpm) — gating them behind an
  // "Apply <phase> changes?" confirm produces the awkward "ask if you
  // want to be asked" effect when the phase's own apply() then prompts.
  // Always auto-apply auto phases; let them surface their own prompts.
  if (phase.defaultMode === 'auto') return true
  if (ctx.apply) return true
  if (ctx.yes) return true
  return ctx.prompter.confirm({
    message: `Apply ${phase.id} changes?`,
    defaultValue: true,
  })
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}
