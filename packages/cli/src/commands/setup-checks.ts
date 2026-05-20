import { existsSync, readFileSync } from 'node:fs'

import { DEP_SPECS, type DepSpec } from '../manifest/deps.js'
import { ENV_FILE_PATHS, ENV_SPECS, type EnvFile, type EnvKey } from '../manifest/env.js'
import type { Context } from '../context.js'

export type SetupCheckResult = 'proceed' | 'aborted'

/**
 * Pre-flight gate for `byline setup`. Policy:
 *
 * - Missing core `@byline/*` deps     → hard bail (seeds will throw on import).
 * - Missing both `.env` and `.env.local` → hard bail (every downstream phase
 *                                       reads them).
 * - Missing keys across either file   → warn and confirm (default No). Some
 *                                       keys may legitimately be supplied via
 *                                       shell env; the user is best placed
 *                                       to judge.
 *
 * `--yes` does NOT auto-confirm the soft warning — the default is No, so
 * `-y` against a partial env aborts. That matches the intent: `-y` is
 * "I don't want to type defaults," not "I don't care if my env is broken."
 */
export async function runSetupChecks(ctx: Context): Promise<SetupCheckResult> {
  const missingDeps = findMissingBylineDeps(ctx)
  if (missingDeps === null) {
    ctx.logger.error('package.json not found or unreadable — run `byline init` first')
    return 'aborted'
  }
  if (missingDeps.length > 0) {
    ctx.logger.error('core @byline/* packages are not installed in this app:')
    for (const spec of missingDeps) {
      ctx.logger.raw(`    - ${spec.name}@${spec.version}`)
    }
    ctx.logger.info(`install them with: ${installHint(ctx)}`)
    ctx.logger.info('or run the full wizard: byline init')
    return 'aborted'
  }

  const envFilesPresent = (Object.keys(ENV_FILE_PATHS) as EnvFile[]).filter((f) =>
    existsSync(ctx.resolve(ENV_FILE_PATHS[f]))
  )
  if (envFilesPresent.length === 0) {
    ctx.logger.error(
      'neither .env nor .env.local found — run `byline init --only env` to scaffold them'
    )
    return 'aborted'
  }

  const missingEnvKeys = findMissingEnvKeys(ctx)
  if (missingEnvKeys.length > 0) {
    ctx.logger.warn('env files are missing keys Byline expects:')
    for (const key of missingEnvKeys) {
      const spec = ENV_SPECS.find((s) => s.key === key)
      const target = spec ? ENV_FILE_PATHS[spec.file] : '.env'
      ctx.logger.raw(`    - ${key}  (${spec?.group}, ${target}) — ${spec?.description}`)
    }
    ctx.logger.info(
      'these may be supplied via shell env instead; otherwise downstream phases will fail'
    )
    const ok = await ctx.prompter.confirm({
      message: 'Proceed anyway?',
      defaultValue: false,
    })
    if (!ok) {
      ctx.logger.info('aborted — fill in the missing keys (or set them in your shell) and re-run')
      return 'aborted'
    }
  }

  return 'proceed'
}

function findMissingBylineDeps(ctx: Context): DepSpec[] | null {
  const pkgPath = ctx.resolve('package.json')
  if (!existsSync(pkgPath)) return null
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as typeof pkg
  } catch {
    return null
  }
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ])
  return DEP_SPECS.filter((s) => s.group === 'byline' && !declared.has(s.name))
}

function findMissingEnvKeys(ctx: Context): EnvKey[] {
  // Read each file independently and check each spec against the file it
  // actually belongs to. A key missing from `.env.local` is missing even if
  // a stray copy lives in `.env` (and vice versa) — we want each value in
  // the canonical place.
  const present: Record<EnvFile, Set<string>> = { public: new Set(), secret: new Set() }
  for (const file of Object.keys(ENV_FILE_PATHS) as EnvFile[]) {
    try {
      present[file] = parseEnvKeys(readFileSync(ctx.resolve(ENV_FILE_PATHS[file]), 'utf8'))
    } catch {
      // missing file → empty set; missing keys will be reported below
    }
  }
  return ENV_SPECS.filter((s) => !present[s.file].has(s.key)).map((s) => s.key)
}

/**
 * Minimal `.env` key extractor — we only need to know which keys are
 * declared with a non-empty value, so quotes/escapes/multiline don't
 * matter. Treats `KEY=` (empty) as missing.
 */
function parseEnvKeys(contents: string): Set<string> {
  const keys = new Set<string>()
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key && value) keys.add(key)
  }
  return keys
}

function installHint(ctx: Context): string {
  switch (ctx.pm) {
    case 'pnpm':
      return 'pnpm add @byline/admin @byline/auth @byline/client @byline/core @byline/db-postgres @byline/host-tanstack-start @byline/richtext-lexical @byline/storage-local @byline/ui'
    case 'yarn':
      return 'yarn add @byline/admin @byline/auth @byline/client @byline/core @byline/db-postgres @byline/host-tanstack-start @byline/richtext-lexical @byline/storage-local @byline/ui'
    case 'bun':
      return 'bun add @byline/admin @byline/auth @byline/client @byline/core @byline/db-postgres @byline/host-tanstack-start @byline/richtext-lexical @byline/storage-local @byline/ui'
    case 'npm':
      return 'npm install @byline/admin @byline/auth @byline/client @byline/core @byline/db-postgres @byline/host-tanstack-start @byline/richtext-lexical @byline/storage-local @byline/ui'
  }
}
