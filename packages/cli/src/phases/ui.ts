import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { applyPlannedWrites } from '../lib/planned-writes.js'
import { toPosixTemplatePath } from '../lib/template-path.js'
import type { Context } from '../context.js'
import type { FileWrite, Phase, Plan } from '../types.js'

const TEMPLATE_DIR = 'ui-byline'
const TARGET_DIR = 'src/ui/byline'
const EXAMPLE_ONLY_PATHS = ['blocks/', 'render-blocks.tsx', 'types/content.ts'] as const

export const uiPhase: Phase = {
  id: 'ui',
  title: 'UI — copy portable serialization components into src/ui/byline/',
  defaultMode: 'auto',

  async detect(ctx) {
    const expected = expectedUiWrites(ctx)
    if (expected.length === 0) return 'pending'
    return expected.every((write) => existsSync(write.path)) ? 'done' : 'pending'
  },

  async plan(ctx) {
    return buildUiPlan(ctx)
  },

  async apply(plan, ctx) {
    if (expectedUiWrites(ctx).length === 0) {
      ctx.logger.error('no UI templates found — was the CLI built with templates?')
      return { state: 'blocked' }
    }
    const result = applyPlannedWrites(plan.writes)
    if (result.written.length > 0) ctx.logger.success(`wrote ${result.written.length} UI file(s)`)
    if (result.conflicts.length > 0) {
      ctx.logger.warn('UI files changed after preview and were left untouched')
      return { state: 'partial' }
    }
    return { state: 'done' }
  },
}

export function buildUiPlan(ctx: Context): Plan {
  const expected = expectedUiWrites(ctx)
  const writes = expected.filter((write) => !existsSync(write.path))
  const examples = ctx.state.get().answers.examples ?? true
  const notes = [
    `target: ${ctx.resolve(TARGET_DIR)}/`,
    `example block renderers: ${examples ? 'included' : 'excluded'}`,
    `${writes.length} file(s) to create, ${expected.length - writes.length} existing preserved`,
  ]
  if (expected.length === 0)
    notes.push('no template files found — was the CLI built with templates?')
  return { writes, commands: [], notes }
}

function expectedUiWrites(ctx: Context): FileWrite[] {
  const templateRoot = join(ctx.templatesDir(), TEMPLATE_DIR)
  if (!existsSync(templateRoot)) return []
  const examples = ctx.state.get().answers.examples ?? true
  return walkFiles(templateRoot)
    .map((abs) => ({ abs, rel: toPosixTemplatePath(relative(templateRoot, abs)) }))
    .filter(({ rel }) => examples || !isExampleOnlyUiPath(rel))
    .map(({ abs, rel }) => ({
      path: ctx.resolve(TARGET_DIR, rel),
      contents: portableUiSource(readFileSync(abs, 'utf8')),
      mode: 'create' as const,
    }))
}

export function isExampleOnlyUiPath(relativePath: string): boolean {
  const rel = toPosixTemplatePath(relativePath)
  return EXAMPLE_ONLY_PATHS.some((path) => rel.startsWith(path))
}

function portableUiSource(source: string): string {
  return source.replaceAll('@/i18n/i18n-config', '@/ui/byline/types/i18n')
}

function walkFiles(root: string): string[] {
  const out: string[] = []
  function walk(dir: string) {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name)
      const st = statSync(abs)
      if (st.isDirectory()) walk(abs)
      else if (st.isFile()) out.push(abs)
    }
  }
  walk(root)
  return out
}
