/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Unit coverage for the client-bundle guard's module classifier. Production
 * application builds exercise the Vite plugin itself; these focused cases pin
 * path normalization and the supported server-only filename conventions.
 */
import { describe, expect, it } from 'vitest'

import { findServerHookModules } from './client-hook-boundary.js'

describe('client hook boundary', () => {
  it('finds collection hook implementations and their shared server graph', () => {
    expect(
      findServerHookModules([
        '/project/byline/collections/docs/hooks.ts',
        '/project/byline/collections/server-hooks.ts?import',
        String.raw`C:\project\byline\collections\create-revalidation-lifecycle-hooks.ts`,
        '/project/byline/collections/events/hooks.mts',
        '/project/byline/collections/run-webhook-side-effects.ts?worker',
        '/project/byline/collections/docs/schema.ts',
      ])
    ).toEqual([
      '/project/byline/collections/docs/hooks.ts',
      '/project/byline/collections/server-hooks.ts?import',
      String.raw`C:\project\byline\collections\create-revalidation-lifecycle-hooks.ts`,
      '/project/byline/collections/events/hooks.mts',
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
