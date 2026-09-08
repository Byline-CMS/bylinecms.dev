/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { createTestContext } from '../../test-helpers.js'
import { wireStartTs } from './start-ts.js'
import type { Context } from '../../context.js'

const contexts: Context[] = []
afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})
function fixture(options: string) {
  const ctx = createTestContext()
  contexts.push(ctx)
  mkdirSync(ctx.resolve('src'), { recursive: true })
  writeFileSync(
    ctx.resolve('src/start.ts'),
    `import { createStart, createCsrfMiddleware } from '@tanstack/react-start'
import { bylineCodedErrorAdapter } from '@byline/host-tanstack-start/integrations/start-errors'
const csrf = createCsrfMiddleware({filter: ctx => ctx.handlerType === 'serverFn'})
export const startInstance = createStart(() => (${options}))`
  )
  return ctx
}
describe('Start sign-in middleware wiring', () => {
  it('upgrades existing serialization-only wiring and is idempotent', async () => {
    const ctx = fixture('{serializationAdapters:[bylineCodedErrorAdapter]}')
    expect((await wireStartTs.apply(ctx)).status).toBe('done')
    const text = readFileSync(ctx.resolve('src/start.ts'), 'utf8')
    expect(text).toContain('requestMiddleware: [createCsrfMiddleware(')
    expect(text).toContain('passwordSignInMiddleware]')
    expect((await wireStartTs.apply(ctx)).status).toBe('skipped')
    expect(readFileSync(ctx.resolve('src/start.ts'), 'utf8')).toBe(text)
  })
  it('preserves existing CSRF and unrelated middleware', async () => {
    const ctx = fixture(
      '{serializationAdapters:[bylineCodedErrorAdapter],requestMiddleware:[csrf, custom]}'
    )
    expect((await wireStartTs.apply(ctx)).status).toBe('done')
    expect(readFileSync(ctx.resolve('src/start.ts'), 'utf8')).toContain(
      '[csrf, custom, passwordSignInMiddleware]'
    )
  })
  it('leaves computed middleware configuration for manual wiring', async () => {
    const ctx = fixture('{requestMiddleware: buildMiddleware()}')
    const original = readFileSync(ctx.resolve('src/start.ts'), 'utf8')
    expect((await wireStartTs.preview(ctx)).status).toBe('manual')
    expect((await wireStartTs.apply(ctx)).status).toBe('manual')
    expect(readFileSync(ctx.resolve('src/start.ts'), 'utf8')).toBe(original)
  })
})
