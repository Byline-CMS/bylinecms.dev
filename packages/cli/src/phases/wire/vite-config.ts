import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { applyPlannedWrites } from '../../lib/planned-writes.js'
import {
  analyzeUserConfig,
  extractCanonicalPieces,
  type MergeAnalysis,
} from './vite-config-merge.js'
import type { Context } from '../../context.js'
import type { FileWrite } from '../../types.js'
import type { SubEdit, SubEditResult } from './shared.js'

const REL = 'vite.config.ts'
const TEMPLATE_REL = 'host/vite.config.ts'
const BACKUP_PREFIX = 'vite.config.ts.bak-'

/** `20260729T014500` — sortable, filesystem-safe, no collisions across runs. */
function backupStamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '')
}

/**
 * Named in the preview message so the "Apply wire changes?" confirm states
 * outright that the user's own config survives. The backup is already listed
 * among the planned writes, but that line reads as one more file being created
 * rather than as a safety net — worth saying in words before they answer.
 */
function backupNote(backupPath: string): string {
  return `Your existing ${REL} will be backed up to ${basename(backupPath)}.`
}
const PREDECESSOR_HASHES = new Set([
  // Canonical config immediately before @byline/i18n/react was pre-bundled.
  'f4ae4e2238571af4de1b620baea9c2834f26fe022084960ad58e0d2e4d6d9f6b',
  // Canonical config immediately before MySQL became a scaffold option.
  'b6ca128489e49f5efd40dd49b30a0adf33c7d9285453087d673e2b6c2a2b3696',
  // Canonical config with the app-owned client-hook build boundary.
  'c85b9ed94e70e4d7854e73a71c0021642fcb72353d7af0ace0cb3192b447b94e',
  // Canonical config immediately before the client-hook build boundary shipped.
  '15b9a1f5d4ea4d29989a6b04f8d00651de098721fe23675ef50e5cacb4245b4c',
  '55625734b4e2a9eac6d05f3447e2535b0a7d3480cc8111f467a5e11539abf1cf',
  'b114092dfccf35e93c9d6310a6cda7e500f85552e0152592a0d31d859726e41f',
  'fb54b24c1bbf8dbb4f4f731f6189962b1f2b39cfa820bd122055e01c2031ad16',
])

export const wireViteConfig: SubEdit = {
  key: 'vite-config',
  title: `Verify ${REL} matches the canonical Byline-on-TanStack-Start config`,
  async preview(ctx) {
    return inspect(ctx)
  },
  async apply(ctx, plannedWrites = []) {
    return apply(ctx, plannedWrites)
  },
}

function inspect(ctx: Context): SubEditResult {
  const path = ctx.resolve(REL)
  const canonicalPath = join(ctx.templatesDir(), TEMPLATE_REL)
  if (!existsSync(canonicalPath)) {
    return {
      status: 'blocked',
      message: 'canonical vite.config.ts template missing from cli dist — was the package built?',
    }
  }

  const canonical = readFileSync(canonicalPath, 'utf8')
  if (!existsSync(path)) {
    return {
      status: 'done',
      message: `${REL}: will create canonical Byline config`,
      writes: [{ path, contents: canonical, mode: 'create' }],
    }
  }

  const userText = readFileSync(path, 'utf8')
  if (normalize(userText) === normalize(canonical)) {
    return { status: 'skipped', message: `${REL}: already matches the canonical Byline config` }
  }

  // Timestamped so a second run never collides with an earlier backup. The
  // previous fixed `vite.config.bak` name meant a re-run found the file already
  // present and silently degraded to a manual instruction.
  const backupPath = ctx.resolve(`${BACKUP_PREFIX}${backupStamp()}`)
  if (PREDECESSOR_HASHES.has(hashConfig(userText))) {
    return {
      status: 'done',
      message: `${REL}: recognized canonical predecessor; will replace it. ${backupNote(backupPath)}`,
      writes: [
        { path: backupPath, contents: userText, mode: 'create' },
        { path, contents: canonical, mode: 'patch', before: userText },
      ],
    }
  }

  // Not canonical and not a predecessor — the ordinary first-install case, where
  // the host app brought its own config. Merge Byline's settings into it rather
  // than replacing it, but only where every insertion lands in a key the host
  // has not already claimed.
  let analysis: MergeAnalysis
  try {
    analysis = analyzeUserConfig(userText, extractCanonicalPieces(canonical))
  } catch (error) {
    return {
      status: 'blocked',
      message: `${REL}: could not read Byline's canonical settings (${(error as Error).message})`,
      snippet: canonical,
    }
  }

  if (analysis.kind === 'canonical') {
    return { status: 'skipped', message: `${REL}: already provides Byline's required settings` }
  }

  if (analysis.kind === 'mergeable') {
    const merged = analysis.plan.apply()
    const leftover =
      analysis.plan.unplaced.length > 0
        ? ` Left for you to merge by hand: ${analysis.plan.unplaced.join('; ')}.`
        : ''
    return {
      status: 'done',
      message: `${REL}: will ${analysis.plan.changes.join(', ')}. ${backupNote(backupPath)}${leftover}`,
      writes: [
        { path: backupPath, contents: userText, mode: 'create' },
        { path, contents: merged, mode: 'patch', before: userText },
      ],
      ...(analysis.plan.unplaced.length > 0 ? { snippet: canonical } : {}),
    }
  }

  // Nothing could be placed safely. Block rather than warn: without these
  // settings Vite resolves `@byline/ui`'s CSS-module imports through Node's ESM
  // loader and the app fails to boot with `ERR_UNKNOWN_FILE_EXTENSION ".css"`.
  // Reporting "installation complete" over that is worse than stopping here.
  return {
    status: 'blocked',
    message:
      `${REL}: left untouched — ${analysis.reason}. Byline's SSR settings are required; without ` +
      `them the app fails to boot with ERR_UNKNOWN_FILE_EXTENSION ".css". Merge the settings ` +
      `below, then re-run: byline init --from wire`,
    snippet: canonical,
  }
}

function apply(ctx: Context, plannedWrites: readonly FileWrite[]): SubEditResult {
  const path = ctx.resolve(REL)
  // Backups are timestamped, so match by prefix — the exact name was decided
  // during preview and must not be recomputed here.
  const backupPrefix = ctx.resolve(BACKUP_PREFIX)
  const isBackup = (write: FileWrite) => write.path.startsWith(backupPrefix)
  const writes = plannedWrites.filter((write) => write.path === path || isBackup(write))
  if (writes.length === 0) {
    const current = inspect(ctx)
    if (!current.writes?.length) return current
    return {
      status: 'manual',
      message: `${REL}: planned write is missing; re-run the wire phase`,
      snippet: readCanonical(ctx),
    }
  }

  const result = applyPlannedWrites(writes)
  if (result.conflicts.length > 0) {
    return {
      status: 'manual',
      message: `${REL}: changed after preview and was left untouched`,
      snippet: readCanonical(ctx),
    }
  }
  const backup = writes.find(isBackup)
  if (!backup) {
    return { status: 'done', message: `${REL}: created canonical Byline config` }
  }
  return {
    status: 'done',
    message: `${REL}: updated with Byline's required settings (backup: ${basename(backup.path)})`,
  }
}

function readCanonical(ctx: Context): string | undefined {
  const path = join(ctx.templatesDir(), TEMPLATE_REL)
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

function normalize(text: string): string {
  // Trailing whitespace + final newline differences shouldn't trigger manual.
  return text.replace(/\s+$/g, '').replace(/\r\n/g, '\n')
}

function hashConfig(text: string): string {
  return createHash('sha256').update(normalize(text)).digest('hex')
}
