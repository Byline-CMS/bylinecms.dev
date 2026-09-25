/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public response headers are unchanged by advertised-locale delivery: anonymous
 * responses stay shared-cacheable, any admin session (and therefore every
 * preview) is private, and a stale preview cookie without a session gets the
 * ordinary public response. Withdrawing a translation relies on the same local
 * invalidation and edge TTL as unpublish; nothing here purges a CDN.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  cookies: {} as Record<string, string>,
  headers: {} as Record<string, string>,
}))

vi.mock('@tanstack/react-start', () => ({
  createMiddleware: () => ({ server: <T>(handler: T) => handler }),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getCookie: (name: string) => state.cookies[name],
  setResponseHeader: (name: string, value: string) => {
    state.headers[name] = value
  },
}))

import { ACCESS_TOKEN_COOKIE, PREVIEW_COOKIE, REFRESH_TOKEN_COOKIE } from '@byline/client/server'

import { publicCacheMiddleware } from './public-cache.js'

async function run(): Promise<string | undefined> {
  const handler = publicCacheMiddleware as unknown as (ctx: {
    next: () => Promise<unknown>
  }) => Promise<unknown>
  await handler({ next: async () => 'next' })
  return state.headers['Cache-Control']
}

describe('public cache headers', () => {
  beforeEach(() => {
    state.cookies = {}
    state.headers = {}
  })

  it('keeps anonymous responses shared-cacheable at the edge only', async () => {
    expect(await run()).toBe('public, max-age=0, s-maxage=60, stale-while-revalidate=86400')
  })

  it.each([ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE])(
    'makes a response private when the %s session cookie is present',
    async (cookie) => {
      state.cookies[cookie] = 'token'
      state.cookies[PREVIEW_COOKIE] = '1'
      expect(await run()).toBe('private, no-store')
    }
  )

  it('treats a stale preview cookie without a session as an ordinary public request', async () => {
    state.cookies[PREVIEW_COOKIE] = '1'
    expect(await run()).toBe('public, max-age=0, s-maxage=60, stale-while-revalidate=86400')
  })
})
