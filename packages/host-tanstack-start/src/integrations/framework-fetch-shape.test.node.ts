/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

// Exercise the installed framework serializer, not a copy of its fetch logic.
// Its internal path is deliberately pinned here so an upgrade requires review.
const frameworkRequire = createRequire(import.meta.resolve('@tanstack/react-start/client-rpc'))
const coreManifest = frameworkRequire.resolve('@tanstack/start-client-core/package.json')
const fetcherUrl = new URL('./dist/esm/client-rpc/serverFnFetcher.js', pathToFileURL(coreManifest))
const { serverFnFetcher } = await import(/* @vite-ignore */ fetcherUrl.href)
const storageUrl = new URL(
  './dist/esm/index.js',
  pathToFileURL(createRequire(coreManifest).resolve('@tanstack/start-storage-context/package.json'))
)
const { runWithStartContext } = await import(/* @vite-ignore */ storageUrl.href)

describe('framework server-function fetch shape', () => {
  it.each(['GET', 'POST', 'FormData'])(
    'keeps %s requests reusable without stream cloning',
    async (kind) => {
      const form = new FormData()
      form.set('upload', new Blob(['content']), 'fixture.txt')
      const fetch = vi.fn(async (url: unknown, init: RequestInit) => {
        expect(
          typeof url === 'string' &&
            (init.body === undefined ||
              typeof init.body === 'string' ||
              init.body instanceof FormData)
        ).toBe(true)
        return new Response('ok', { headers: { 'x-tss-raw': 'true' } })
      })
      await runWithStartContext({ startOptions: {} }, () =>
        serverFnFetcher(
          'http://localhost/server-fn/fixture',
          [
            {
              method: kind === 'GET' ? 'GET' : 'POST',
              data: kind === 'FormData' ? form : { title: 'example' },
            },
          ],
          fetch
        )
      )
      expect(fetch).toHaveBeenCalledOnce()
    }
  )
})
