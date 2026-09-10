/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const invalidate = vi.fn()
  return { renew: vi.fn(), invalidate, router: { invalidate }, href: '/en/news' }
})
vi.mock('./session-renewal.js', () => ({ renewExpectedSession: mocks.renew }))
vi.mock('@tanstack/react-router', () => ({
  // A real router instance is stable across renders; location changes on navigation.
  useRouter: () => mocks.router,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { href: mocks.href } }),
}))

import { AdminSessionRecovery } from './admin-session-recovery.js'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.href = '/en/news'
  mocks.invalidate.mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(renewable: boolean) {
  await act(async () => {
    root.render(<AdminSessionRecovery renewable={renewable} />)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('AdminSessionRecovery', () => {
  it('renders nothing and does not renew when the session is not renewable', async () => {
    await render(false)
    expect(container.innerHTML).toBe('')
    expect(mocks.renew).not.toHaveBeenCalled()
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })

  it('renews and re-runs the route loaders when the session is renewable', async () => {
    mocks.renew.mockResolvedValue(undefined)
    await render(true)
    expect(mocks.renew).toHaveBeenCalledTimes(1)
    expect(mocks.invalidate).toHaveBeenCalledTimes(1)
    expect(container.innerHTML).toBe('')
  })

  it('does not re-run loaders when renewal fails for a service reason', async () => {
    mocks.renew.mockRejectedValue(new Error('network'))
    await render(true)
    expect(mocks.renew).toHaveBeenCalledTimes(1)
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })

  it('renews only once while mounted even across re-renders', async () => {
    mocks.renew.mockResolvedValue(undefined)
    await render(true)
    await render(true)
    expect(mocks.renew).toHaveBeenCalledTimes(1)
  })

  it('recovers again on a later expiry cycle while the layout stays mounted', async () => {
    mocks.renew.mockResolvedValue(undefined)
    await render(true)
    // The loader re-ran after renewal and reported a live session...
    await render(false)
    // ...and a later navigation finds the access credential expired again.
    await render(true)
    expect(mocks.renew).toHaveBeenCalledTimes(2)
    expect(mocks.invalidate).toHaveBeenCalledTimes(2)
  })

  it('retries on a later navigation after a service failure', async () => {
    mocks.renew.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined)
    await render(true)
    expect(mocks.renew).toHaveBeenCalledTimes(1)
    mocks.href = '/en/news/second-story'
    await render(true)
    expect(mocks.renew).toHaveBeenCalledTimes(2)
    expect(mocks.invalidate).toHaveBeenCalledTimes(1)
  })

  // Runs last: a terminal outcome suppresses further attempts for the life of
  // the page (module state), so later cases in this file would see no renewal.
  it('stops retrying after a terminal auth outcome until the page reloads', async () => {
    mocks.renew.mockRejectedValue(
      Object.assign(new Error('revoked'), { code: 'ERR_REVOKED_TOKEN' })
    )
    await render(true)
    expect(mocks.renew).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
    root = createRoot(container)
    mocks.href = '/en/news/after-revocation'
    await render(true)
    expect(mocks.renew).toHaveBeenCalledTimes(1)
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })
})
