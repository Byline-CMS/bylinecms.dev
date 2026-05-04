import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { execa } from 'execa'

import { renderDiff } from './ui/diff.js'
import type { Context } from './context.js'
import type { Phase, Plan } from './types.js'

export async function runPhase(phase: Phase, ctx: Context): Promise<void> {
  const detected = await phase.detect(ctx)
  if (detected === 'done' && !ctx.cliFlags.force) {
    ctx.logger.success(`${phase.id} — already complete`)
    return
  }
  if (detected === 'blocked') {
    ctx.logger.error(`${phase.id} — blocked; cannot proceed`)
    return
  }

  ctx.logger.step(`${phase.id} — planning`)
  const plan = await phase.plan(ctx)

  if (plan.writes.length === 0 && plan.commands.length === 0 && plan.notes.length === 0) {
    ctx.logger.info(`${phase.id} — nothing to do`)
    ctx.state.markPhaseComplete(phase.id)
    ctx.state.flush()
    return
  }

  previewPlan(phase, plan, ctx)

  if (ctx.dryRun) {
    ctx.logger.info(`${phase.id} — dry-run; skipping apply`)
    return
  }

  const shouldApply = await decideApply(phase, ctx)
  if (!shouldApply) {
    ctx.logger.warn(`${phase.id} — skipped by user`)
    return
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
}

function previewPlan(phase: Phase, plan: Plan, ctx: Context): void {
  ctx.logger.raw('')
  ctx.logger.raw(`  ${phase.title}`)
  for (const note of plan.notes) ctx.logger.raw(`    • ${note}`)
  for (const w of plan.writes) {
    const before = w.before ?? readIfExists(w.path)
    const label = before ? 'modify' : 'create'
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
  if (ctx.apply && phase.defaultMode === 'confirm') return true
  if (phase.defaultMode === 'auto' && ctx.apply !== false) return true
  if (ctx.yes) return true
  return ctx.prompter.confirm({
    message: `Apply ${phase.id} changes?`,
    defaultValue: phase.defaultMode === 'auto',
  })
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

export async function executePlan(plan: Plan, ctx: Context): Promise<void> {
  for (const w of plan.writes) {
    mkdirSync(dirname(w.path), { recursive: true })
    writeFileSync(w.path, w.contents, 'utf8')
  }
  for (const c of plan.commands) {
    await execa(c.command, c.args, { cwd: c.cwd ?? ctx.cwd, stdio: 'inherit' })
  }
}
