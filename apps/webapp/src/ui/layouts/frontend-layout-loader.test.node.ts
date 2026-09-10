/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('~/public', () => ({ routes: { admin: '/admin' } }))
const mocks = vi.hoisted(() => ({ session: { user: null as unknown, renewable: false } }))
vi.mock('@byline/host-tanstack-start/server-fns/auth', () => ({
  getCurrentAdminSessionSoft: async () => mocks.session,
}))
vi.mock('@byline/client/server', () => ({ readPreviewCookie: () => false }))
vi.mock('../../../../../packages/host-tanstack-start/node_modules/@tanstack/react-start', () => ({
  createServerFn: () => {
    const guards: Array<{ options: { server: (args: unknown) => Promise<unknown> } }> = []
    const builder = {
      middleware: (items: typeof guards) => {
        guards.push(...items)
        return builder
      },
      handler: (handler: () => Promise<unknown>) => async () => {
        for (const guard of guards) await guard.options.server({ next: async () => ({}) })
        return handler()
      },
    }
    return builder
  },
}))
// Exercise the real preview-state function: mocking it to return false would
// hide an accidental admin gate on this public layout dependency.
vi.mock(
  '@byline/host-tanstack-start/server-fns/preview',
  async () => import('../../../../../packages/host-tanstack-start/src/server-fns/preview/state.js')
)

import { loadFrontendLayoutData } from './frontend-layout-loader.js'

describe('anonymous public layout', () => {
  it('loads without admin credentials or preview cookies', async () => {
    await expect(loadFrontendLayoutData()).resolves.toEqual({
      adminUser: null,
      adminPath: '/admin',
      preview: false,
      sessionRenewable: false,
    })
  })

  it('threads the renewable hint through so the layout can recover an expired session', async () => {
    mocks.session = { user: null, renewable: true }
    await expect(loadFrontendLayoutData()).resolves.toMatchObject({
      adminUser: null,
      sessionRenewable: true,
    })
  })
})
