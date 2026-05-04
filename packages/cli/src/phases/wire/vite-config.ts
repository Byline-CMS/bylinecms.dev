import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Context } from '../../context.js'
import type { SubEdit, SubEditResult } from './shared.js'

const REL = 'vite.config.ts'
const TEMPLATE_REL = 'host/vite.config.ts'

export const wireViteConfig: SubEdit = {
  key: 'vite-config',
  title: `Verify ${REL} matches the canonical Byline-on-TanStack-Start config`,
  async preview(ctx) {
    return run(ctx, true)
  },
  async apply(ctx) {
    return run(ctx, false)
  },
}

async function run(ctx: Context, _dryRun: boolean): Promise<SubEditResult> {
  const path = ctx.resolve(REL)
  if (!existsSync(path)) {
    return {
      status: 'blocked',
      message: `${REL} not found — host phase should have caught this`,
    }
  }

  const canonicalPath = join(ctx.templatesDir(), TEMPLATE_REL)
  if (!existsSync(canonicalPath)) {
    return {
      status: 'blocked',
      message: 'canonical vite.config.ts template missing from cli dist — was the package built?',
    }
  }

  const userText = readFileSync(path, 'utf8')
  const canonical = readFileSync(canonicalPath, 'utf8')
  if (normalize(userText) === normalize(canonical)) {
    return { status: 'skipped', message: `${REL}: already matches the canonical Byline config` }
  }

  if (_dryRun) {
    return {
      status: 'manual',
      message: `${REL}: differs from canonical — apply will back up existing file to vite.config.bak and replace it`,
      snippet: canonical,
    }
  }

  // Back up the user's existing config then install the canonical template.
  const backupPath = ctx.resolve('vite.config.bak')
  copyFileSync(path, backupPath)
  writeFileSync(path, canonical, 'utf8')
  return {
    status: 'done',
    message: `${REL}: existing file backed up to vite.config.bak and replaced with the canonical Byline vite.config.ts config`,
  }
}

function normalize(text: string): string {
  // Trailing whitespace + final newline differences shouldn't trigger manual.
  return text.replace(/\s+$/g, '').replace(/\r\n/g, '\n')
}
