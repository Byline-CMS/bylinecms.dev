import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import type { Context } from '../context.js'
import type { Phase } from '../types.js'

const TEMPLATE_DIR = 'routes/_byline'
const TARGET_GROUP_DIR = 'src/routes/_byline'
const DEFAULT_ADMIN_PATH = '/admin'
const ADMIN_SLUG_REGEX = /^[a-z][a-z0-9-]*$/

interface CopyEntry {
  fromAbs: string
  /** Path relative to TEMPLATE_DIR, with `admin/` already rewritten to `${slug}/` if applicable. */
  rel: string
  toAbs: string
  status: 'create' | 'skip-already-exists'
}

export const routesPhase: Phase = {
  id: 'routes',
  title: 'Routes — drop _byline/admin pathless layout into src/routes/',
  defaultMode: 'confirm',

  async detect(ctx) {
    if (ctx.state.isComplete('routes')) return 'done'
    return 'pending'
  },

  async plan(ctx) {
    const adminPath = ctx.state.get().answers.adminPath ?? DEFAULT_ADMIN_PATH
    const slug = pathToSlug(adminPath)
    if (slug === null) {
      return {
        writes: [],
        commands: [],
        notes: [
          `invalid admin path "${adminPath}" — must be a single URL segment matching ${ADMIN_SLUG_REGEX}`,
        ],
      }
    }
    const entries = collectEntries(ctx, slug)

    const created = entries.filter((e) => e.status === 'create').length
    const skipped = entries.filter((e) => e.status === 'skip-already-exists').length

    const notes: string[] = [
      `target: ${ctx.resolve(TARGET_GROUP_DIR)}/`,
      `admin path: ${ctx.state.get().answers.adminPath === undefined ? `will prompt (default ${DEFAULT_ADMIN_PATH})` : adminPath}`,
      slug !== 'admin'
        ? `pathless layout: _byline/${slug}  (renamed from _byline/admin)`
        : 'pathless layout: _byline/admin',
      `${created} file(s) to create, ${skipped} already-existing skipped`,
    ]
    return { writes: [], commands: [], notes }
  },

  async apply(_plan, ctx) {
    let adminPath = ctx.state.get().answers.adminPath
    if (adminPath === undefined) {
      adminPath = await ctx.prompter.text({
        message: 'Where should the admin UI be mounted?',
        defaultValue: DEFAULT_ADMIN_PATH,
        placeholder: DEFAULT_ADMIN_PATH,
      })
      adminPath = adminPath.startsWith('/') ? adminPath : `/${adminPath}`
    }
    const slug = pathToSlug(adminPath)
    if (!slug) {
      ctx.logger.error(
        `invalid admin path "${adminPath}" — must be a single URL segment matching ${ADMIN_SLUG_REGEX}`
      )
      return { state: 'blocked' }
    }
    ctx.state.patchAnswers({ adminPath })

    const entries = collectEntries(ctx, slug)
    if (entries.length === 0) {
      ctx.logger.error(
        'no route templates found — was the cli built with templates copied to dist?'
      )
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
      const raw = readFileSync(entry.fromAbs, 'utf8')
      writeFileSync(entry.toAbs, rewriteRouteIds(raw, slug), 'utf8')
      written++
    }

    ctx.logger.success(`wrote ${written} route file(s) under ${ctx.resolve(TARGET_GROUP_DIR)}/`)
    if (skipped > 0) {
      ctx.logger.info(
        `${skipped} file(s) already existed and were left untouched — re-running routes is non-destructive`
      )
    }

    ctx.prompter.note(
      [
        'The routes were dropped under a TanStack Router pathless layout',
        "(`src/routes/_byline/`). The `_byline` segment doesn't add to the URL —",
        '`/_byline/admin/users` resolves to `/admin/users` — but it does scope',
        'the Byline UI kit stylesheets (loaded by `_byline/route.tsx`) to admin',
        '+ sign-in pages only.',
        '',
        'If your app has front-end routes at the root of `src/routes/`, consider',
        'moving them under their own pathless layout (e.g. `_front-end/`) so the',
        "Byline reset / styles don't bleed into them. If you DO want to use the",
        'Byline UI kit on your public site too, just import the same stylesheets',
        'from your front-end layout:',
        '',
        "  import '@byline/ui/reset.css'",
        "  import '@byline/ui/styles.css'",
        '',
        'See the reference webapp at https://github.com/Byline-CMS/bylinecms.dev',
        '— `apps/webapp/src/routes/_byline/route.tsx` (admin) and',
        '  `apps/webapp/src/routes/{-$lng}/_public/route.tsx` (front-end) both',
        'demonstrate this pattern.',
      ].join('\n'),
      'Pathless layout + style isolation'
    )

    return { state: 'done' }
  },
}

function pathToSlug(adminPath: string): string | null {
  const trimmed = adminPath.replace(/^\/+|\/+$/g, '')
  if (!trimmed || trimmed.includes('/')) return null
  return ADMIN_SLUG_REGEX.test(trimmed) ? trimmed : null
}

function collectEntries(ctx: Context, slug: string): CopyEntry[] {
  const templateRoot = join(ctx.templatesDir(), TEMPLATE_DIR)
  if (!existsSync(templateRoot)) return []
  const targetRoot = ctx.resolve(TARGET_GROUP_DIR)

  const entries: CopyEntry[] = []
  for (const abs of walkFiles(templateRoot)) {
    const rel = relative(templateRoot, abs)
    const renamed = slug === 'admin' ? rel : renameAdminSegment(rel, slug)
    const toAbs = join(targetRoot, renamed)
    entries.push({
      fromAbs: abs,
      rel: renamed,
      toAbs,
      status: existsSync(toAbs) ? 'skip-already-exists' : 'create',
    })
  }
  return entries
}

/**
 * Replace the leading `admin/` (or exactly `admin`) directory segment with `<slug>/`.
 * Files outside the admin/ subtree (e.g. `sign-in.tsx`) are returned unchanged.
 */
function renameAdminSegment(rel: string, slug: string): string {
  if (rel === 'admin' || rel.startsWith('admin/')) {
    return `${slug}${rel.slice('admin'.length)}`
  }
  return rel
}

/**
 * Rewrite route-id strings inside the file contents. Route ids are passed
 * positionally to the `create*Route(...)` factories from
 * `@byline/host-tanstack-start/routes` and look like `/_byline/admin/...`.
 *
 * We match the literal `/_byline/admin` prefix only — we do not touch
 * other occurrences of "admin" elsewhere in the file (comments, prop
 * names, etc.).
 */
function rewriteRouteIds(source: string, slug: string): string {
  if (slug === 'admin') return source
  return source.replace(/(['"])\/_byline\/admin\b/g, `$1/_byline/${slug}`)
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
