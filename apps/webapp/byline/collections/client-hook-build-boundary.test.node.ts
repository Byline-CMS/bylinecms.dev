import { describe, expect, it } from 'vitest'

import { findServerHookModules } from './client-hook-build-boundary.js'

describe('client hook build boundary', () => {
  it('finds collection hook implementations and their shared server graph', () => {
    expect(
      findServerHookModules([
        '/project/byline/collections/docs/hooks.ts',
        '/project/byline/collections/create-public-lifecycle-hooks.ts?import',
        String.raw`C:\project\byline\collections\run-side-effects.ts`,
        '/project/byline/collections/events/hooks.mts',
        '/project/byline/collections/create-private-lifecycle-hooks.ts',
        '/project/byline/collections/run-webhook-side-effects.ts?worker',
        '/project/byline/collections/docs/schema.ts',
      ])
    ).toEqual([
      '/project/byline/collections/docs/hooks.ts',
      '/project/byline/collections/create-public-lifecycle-hooks.ts?import',
      String.raw`C:\project\byline\collections\run-side-effects.ts`,
      '/project/byline/collections/events/hooks.mts',
      '/project/byline/collections/create-private-lifecycle-hooks.ts',
      '/project/byline/collections/run-webhook-side-effects.ts?worker',
    ])
  })

  it('allows schemas and unrelated client modules', () => {
    expect(
      findServerHookModules([
        '/project/byline/collections/docs/schema.ts',
        '/project/src/ui/byline/render-blocks.tsx',
      ])
    ).toEqual([])
  })
})
