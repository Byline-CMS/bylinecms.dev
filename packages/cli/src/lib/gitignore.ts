import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface GitignoreEntry {
  /** Canonical pattern we want present. */
  pattern: string
  /**
   * Other exact-line patterns that, if found, mean `pattern` is already
   * covered. We deliberately do NOT try to interpret full `.gitignore`
   * matching semantics (negations, directory-only patterns, etc.); a missed
   * equivalent just means an extra line gets added — never the reverse.
   */
  equivalents?: readonly string[]
}

export interface EnsureGitignoreResult {
  /** True when no `.gitignore` existed and we created one. */
  created: boolean
  /** Patterns we appended on this run. */
  added: string[]
  /** Patterns already covered (canonical or equivalent). */
  alreadyCovered: string[]
}

const HEADER = '# Added by @byline/cli — Byline install state and local secrets.'

/**
 * Idempotently ensures `entries` are present in the host app's `.gitignore`.
 *
 * Existing user-written content is preserved verbatim; missing entries are
 * appended in a single block at the end of the file, preceded by a short
 * comment that explains where they came from. Re-running is a no-op when
 * every entry is already covered.
 *
 * If the file does not exist it is created.
 */
export function ensureGitignore(
  cwd: string,
  entries: readonly GitignoreEntry[]
): EnsureGitignoreResult {
  const path = resolve(cwd, '.gitignore')
  const existed = existsSync(path)
  const raw = existed ? readFileSync(path, 'utf8') : ''

  const present = new Set(
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  )

  const toAdd: string[] = []
  const alreadyCovered: string[] = []
  for (const e of entries) {
    const covered = present.has(e.pattern) || (e.equivalents ?? []).some((eq) => present.has(eq))
    if (covered) alreadyCovered.push(e.pattern)
    else toAdd.push(e.pattern)
  }

  if (toAdd.length === 0) {
    return { created: false, added: [], alreadyCovered }
  }

  const block = `${HEADER}\n${toAdd.join('\n')}\n`
  const separator = raw === '' ? '' : raw.endsWith('\n') ? '\n' : '\n\n'
  writeFileSync(path, raw + separator + block, 'utf8')

  return { created: !existed, added: toAdd, alreadyCovered }
}
