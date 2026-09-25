/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Runtime test of the scaffolded Docs hooks (the file generated projects
 * receive), not a source-text assertion: advertised-locale changes must
 * reconcile the search index, including an explicit no-op reconciliation
 * retry after a failed attempt.
 */

import type { SystemFieldsChangeContext } from '@byline/core'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const search = vi.hoisted(() => ({
  collection: vi.fn(),
  indexDocument: vi.fn(),
}))

vi.mock('@byline/client/server', () => ({
  getSystemBylineClient: () => ({ collection: search.collection }),
}))

type SystemFieldsHook = (context: SystemFieldsChangeContext) => void | Promise<void>

// The template imports `@byline/client/server`, which is not a CLI dependency
// (it is mocked above), and `src/templates` is excluded from the CLI's
// TypeScript program. A runtime-only specifier keeps the compiler from
// following the import while Vitest still resolves and loads the module.
const templateHooksPath = '../templates/byline-examples/collections/docs/hooks.js'
let hooks: { afterSystemFieldsChange?: SystemFieldsHook | SystemFieldsHook[] }

beforeAll(async () => {
  hooks = (await import(/* @vite-ignore */ templateHooksPath)).default
})

function context(overrides: Partial<SystemFieldsChangeContext>): SystemFieldsChangeContext {
  return {
    documentId: 'doc-1',
    collectionPath: 'docs',
    requested: { path: false, availableLocales: false },
    changed: { path: false, availableLocales: false },
    reconciliation: false,
    previousPath: 'intro',
    currentPath: 'intro',
    previousAvailableLocales: ['en'],
    currentAvailableLocales: ['en'],
    ...overrides,
  }
}

async function run(ctx: SystemFieldsChangeContext): Promise<void> {
  const hook = hooks.afterSystemFieldsChange
  expect(hook).toBeDefined()
  for (const fn of Array.isArray(hook) ? hook : hook ? [hook] : []) await fn(ctx)
}

describe('scaffolded docs afterSystemFieldsChange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    search.indexDocument.mockResolvedValue(undefined)
    search.collection.mockReturnValue({ indexDocument: search.indexDocument })
  })

  it.each([
    ['enabled', ['en'], ['en', 'es']],
    ['disabled', ['en', 'es'], ['en']],
  ])(
    'reindexes once when a locale is %s and the path is untouched',
    async (_name, before, after) => {
      await run(
        context({
          requested: { path: false, availableLocales: true },
          changed: { path: false, availableLocales: true },
          previousAvailableLocales: before,
          currentAvailableLocales: after,
        })
      )
      expect(search.collection).toHaveBeenCalledWith('docs')
      expect(search.indexDocument).toHaveBeenCalledOnce()
      expect(search.indexDocument).toHaveBeenCalledWith('doc-1')
    }
  )

  it('reindexes once for a path change, or a combined path and locale change', async () => {
    await run(
      context({
        requested: { path: true, availableLocales: false },
        changed: { path: true, availableLocales: false },
        currentPath: 'introduction',
      })
    )
    await run(
      context({
        requested: { path: true, availableLocales: true },
        changed: { path: true, availableLocales: true },
        currentPath: 'introduction',
        currentAvailableLocales: ['en', 'es'],
      })
    )
    expect(search.indexDocument).toHaveBeenCalledTimes(2)
  })

  it('re-runs indexing on an explicit no-op locale reconciliation retry', async () => {
    await run(
      context({
        requested: { path: false, availableLocales: true },
        changed: { path: false, availableLocales: false },
        reconciliation: true,
      })
    )
    expect(search.indexDocument).toHaveBeenCalledOnce()
  })

  it('surfaces an indexing failure so the committed-hook flow can report and retry it', async () => {
    const failure = new Error('index unavailable')
    search.indexDocument.mockRejectedValueOnce(failure)
    await expect(
      run(
        context({
          requested: { path: false, availableLocales: true },
          changed: { path: false, availableLocales: true },
          currentAvailableLocales: ['en', 'es'],
        })
      )
    ).rejects.toBe(failure)
  })
})
