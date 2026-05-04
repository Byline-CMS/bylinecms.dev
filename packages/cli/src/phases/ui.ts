import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import type { Context } from '../context.js'
import type { Phase } from '../types.js'

const TEMPLATE_DIR = 'ui-byline'
const TARGET_DIR = 'src/ui/byline'

interface CopyEntry {
  fromAbs: string
  toAbs: string
  status: 'create' | 'skip-already-exists'
}

export const uiPhase: Phase = {
  id: 'ui',
  title: 'UI — copy serialization components into src/ui/byline/',
  defaultMode: 'auto',

  async detect(ctx) {
    if (ctx.state.isComplete('ui')) return 'done'
    return 'pending'
  },

  async plan(ctx) {
    const entries = collectEntries(ctx)
    const created = entries.filter((e) => e.status === 'create').length
    const skipped = entries.filter((e) => e.status === 'skip-already-exists').length
    const notes: string[] = [
      `target: ${ctx.resolve(TARGET_DIR)}/`,
      `${created} file(s) to create, ${skipped} already-existing skipped`,
    ]
    if (entries.length === 0) notes.push('(no template files — was the cli built with templates?)')
    return { writes: [], commands: [], notes }
  },

  async apply(_plan, ctx) {
    const entries = collectEntries(ctx)
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
        `${skipped} file(s) already existed and were left untouched — re-running ui is non-destructive`
      )
    }

    ctx.prompter.note(
      [
        'src/ui/byline/types/i18n.ts        — `Locale = string` stub. Replace with your',
        '                                       narrower locale union if you have one.',
        'src/ui/byline/components/link/     — `LangLink` is a single-locale pass-through.',
        '  lang-link.tsx                      Replace if you use a multi-locale strategy.',
        'src/ui/byline/render-blocks.tsx    — Sample renderer wired to the example PhotoBlock /',
        '                                       RichTextBlock schemas. Adapt to your own block',
        '                                       definitions, or delete if not using examples.',
        '',
        'Reference implementations live in https://github.com/Byline-CMS/bylinecms.dev',
      ].join('\n'),
      'UI: customisation pointers'
    )
    return { state: 'done' }
  },
}

function collectEntries(ctx: Context): CopyEntry[] {
  const templateRoot = join(ctx.templatesDir(), TEMPLATE_DIR)
  if (!existsSync(templateRoot)) return []
  const targetRoot = ctx.resolve(TARGET_DIR)

  const entries: CopyEntry[] = []
  for (const abs of walkFiles(templateRoot)) {
    const rel = relative(templateRoot, abs)
    const toAbs = join(targetRoot, rel)
    entries.push({
      fromAbs: abs,
      toAbs,
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
