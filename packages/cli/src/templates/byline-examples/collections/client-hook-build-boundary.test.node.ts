import { describe, expect, it } from 'vitest'

import { findServerHookModules } from './client-hook-build-boundary.js'

describe('client hook build boundary', () => {
  it('finds collection hook implementations and shared server registries', () => {
    expect(
      findServerHookModules([
        '/project/byline/collections/docs/hooks.ts',
        '/project/byline/collections/server-hooks.ts?import',
        String.raw`C:\project\byline\collections\run-side-effects.ts`,
        '/project/byline/collections/docs/schema.ts',
      ])
    ).toEqual([
      '/project/byline/collections/docs/hooks.ts',
      '/project/byline/collections/server-hooks.ts?import',
      String.raw`C:\project\byline\collections\run-side-effects.ts`,
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
