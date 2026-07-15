import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { applyPlannedWrites } from '../../lib/planned-writes.js'
import type { Context } from '../../context.js'
import type { FileWrite } from '../../types.js'
import type { SubEdit, SubEditResult } from './shared.js'

const REL = 'vite.config.ts'
const TEMPLATE_REL = 'host/vite.config.ts'
const PREDECESSOR_HASHES = new Set([
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

  const backupPath = ctx.resolve('vite.config.bak')
  if (PREDECESSOR_HASHES.has(hashConfig(userText)) && !existsSync(backupPath)) {
    return {
      status: 'done',
      message: `${REL}: recognized canonical predecessor; will back up and replace it`,
      writes: [
        { path: backupPath, contents: userText, mode: 'create' },
        { path, contents: canonical, mode: 'patch', before: userText },
      ],
    }
  }

  return {
    status: 'manual',
    message: `${REL}: divergent user config was left untouched; merge the canonical requirements manually`,
    snippet: canonical,
  }
}

function apply(ctx: Context, plannedWrites: readonly FileWrite[]): SubEditResult {
  const path = ctx.resolve(REL)
  const backupPath = ctx.resolve('vite.config.bak')
  const writes = plannedWrites.filter((write) => write.path === path || write.path === backupPath)
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
  return {
    status: 'done',
    message: writes.some((write) => write.path === backupPath)
      ? `${REL}: canonical predecessor backed up and replaced`
      : `${REL}: created canonical Byline config`,
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
