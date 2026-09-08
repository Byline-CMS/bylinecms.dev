import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { createTestContext } from '../../test-helpers.js'
import { wireServerTs } from './server-ts.js'
import type { Context } from '../../context.js'

const contexts: Context[] = []
afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})
function fixture(text: string) {
  const ctx = createTestContext()
  contexts.push(ctx)
  mkdirSync(ctx.resolve('src'), { recursive: true })
  writeFileSync(ctx.resolve('src/server.ts'), text)
  return ctx
}
describe('host scheduler wiring', () => {
  it('upgrades an existing config import, preserves the handler, and is idempotent', async () => {
    const ctx = fixture("import '../byline/server.config.ts'\nexport default handler")
    const original = readFileSync(ctx.resolve('src/server.ts'), 'utf8')
    expect((await wireServerTs.preview(ctx)).status).toBe('done')
    expect(readFileSync(ctx.resolve('src/server.ts'), 'utf8')).toBe(original)
    expect((await wireServerTs.apply(ctx)).status).toBe('done')
    const text = readFileSync(ctx.resolve('src/server.ts'), 'utf8')
    expect(text).toContain(
      'globalThis.__bylineSchedulerController__ ??= startBylineScheduler(getBylineCore())'
    )
    expect(text).toContain('export default handler')
    expect((await wireServerTs.apply(ctx)).status).toBe('skipped')
    expect(readFileSync(ctx.resolve('src/server.ts'), 'utf8')).toBe(text)
  })
  it('preserves an existing aliased scheduler startup', async () => {
    const text =
      "import '../byline/server.config'\nimport { startBylineScheduler as start } from '@byline/core/scheduler'\nstart(core, { concurrency: 2 })"
    const ctx = fixture(text)
    expect((await wireServerTs.apply(ctx)).status).toBe('skipped')
    expect(readFileSync(ctx.resolve('src/server.ts'), 'utf8')).toBe(text)
  })
})
