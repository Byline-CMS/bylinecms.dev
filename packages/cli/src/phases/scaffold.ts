import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import type { Context } from '../context.js'
import type { Phase } from '../types.js'

const TARGET_DIR = 'byline'
const BASE_TEMPLATE = 'byline'
const EXAMPLES_TEMPLATE = 'byline-examples'

interface CopyEntry {
  fromAbs: string
  rel: string
  toAbs: string
  source: 'base' | 'examples'
  status: 'create' | 'skip-already-exists'
}

export const scaffoldPhase: Phase = {
  id: 'scaffold',
  title: 'Scaffold — copy byline/ config tree into the app root',
  defaultMode: 'auto',

  async detect(ctx) {
    if (ctx.state.isComplete('scaffold')) return 'done'
    return 'pending'
  },

  async plan(ctx) {
    const examples = ctx.state.get().answers.examples
    const entries = collectEntries(ctx, examples ?? true)

    const fromBase = entries.filter((e) => e.source === 'base' && e.status === 'create').length
    const fromExamples = entries.filter(
      (e) => e.source === 'examples' && e.status === 'create'
    ).length
    const skipped = entries.filter((e) => e.status === 'skip-already-exists').length

    const notes: string[] = [
      `target: ${ctx.resolve(TARGET_DIR)}/`,
      `examples overlay: ${examples === undefined ? 'will prompt (default yes)' : examples ? 'yes' : 'no'}`,
      `${fromBase} base file(s), ${fromExamples} examples file(s), ${skipped} already-existing skipped`,
    ]
    return { writes: [], commands: [], notes }
  },

  async apply(_plan, ctx) {
    let examples = ctx.state.get().answers.examples
    if (examples === undefined) {
      examples = await ctx.prompter.confirm({
        message: 'Include the example collections, blocks, and fields?',
        defaultValue: true,
      })
      ctx.state.patchAnswers({ examples })
    }

    const entries = collectEntries(ctx, examples)
    if (entries.length === 0) {
      ctx.logger.error('no template files found — was the cli built with templates copied to dist?')
      return { state: 'blocked' }
    }

    let written = 0
    let skipped = 0
    for (const entry of entries) {
      if (entry.status === 'skip-already-exists') {
        skipped++
        continue
      }
      mkdirSync(dirname(entry.toAbs), { recursive: true })
      writeFileSync(entry.toAbs, readFileSync(entry.fromAbs, 'utf8'), 'utf8')
      written++
    }

    ctx.logger.success(`wrote ${written} file(s) under ${ctx.resolve(TARGET_DIR)}/`)
    if (skipped > 0) {
      ctx.logger.info(
        `${skipped} file(s) already existed and were left untouched — re-running scaffold is non-destructive`
      )
    }
    return { state: 'done' }
  },
}

function collectEntries(ctx: Context, examples: boolean): CopyEntry[] {
  const targetRoot = ctx.resolve(TARGET_DIR)
  const baseRoot = join(ctx.templatesDir(), BASE_TEMPLATE)
  const examplesRoot = join(ctx.templatesDir(), EXAMPLES_TEMPLATE)

  const examplesFiles = examples && existsSync(examplesRoot) ? walkFiles(examplesRoot) : []
  const examplesRels = new Set(examplesFiles.map((abs) => relative(examplesRoot, abs)))

  const entries: CopyEntry[] = []

  if (existsSync(baseRoot)) {
    for (const abs of walkFiles(baseRoot)) {
      const rel = relative(baseRoot, abs)
      // The examples tree supersedes the base for any path the two share
      // (e.g. server.config.ts, admin.config.ts, seed.ts). Skip the base
      // entry so we don't queue two writes for the same target file.
      if (examplesRels.has(rel)) continue
      const toAbs = join(targetRoot, rel)
      entries.push({
        fromAbs: abs,
        rel,
        toAbs,
        source: 'base',
        status: existsSync(toAbs) ? 'skip-already-exists' : 'create',
      })
    }
  }

  for (const abs of examplesFiles) {
    const rel = relative(examplesRoot, abs)
    const toAbs = join(targetRoot, rel)
    entries.push({
      fromAbs: abs,
      rel,
      toAbs,
      source: 'examples',
      status: existsSync(toAbs) ? 'skip-already-exists' : 'create',
    })
  }

  return entries
}

function walkFiles(root: string): string[] {
  const out: string[] = []
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      const st = statSync(abs)
      if (st.isDirectory()) walk(abs)
      else if (st.isFile()) out.push(abs)
    }
  }
  walk(root)
  return out
}
