/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { isRedirect } from '@tanstack/react-router'

import { ERR_ACCESS_EXPIRED, ERR_REVOKED_TOKEN, ERR_UNAUTHENTICATED } from '@byline/auth'
import { describe, expect, it, vi } from 'vitest'

import { loadAdminLayoutContext } from './admin-layout-guard.js'

const context = { user: { sessionId: 'login-1' } }
const signInPath = '/sign-in'
const href = '/admin/collections/pages?page=2'

function deps(overrides: Partial<Parameters<typeof loadAdminLayoutContext>[0]> = {}) {
  return {
    load: vi.fn().mockResolvedValue(context),
    renewSession: vi.fn().mockResolvedValue(undefined),
    isBrowser: true,
    sessionChanged: () => false,
    signInPath,
    href,
    ...overrides,
  }
}

async function expectSignInRedirect(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown
  )
  expect(isRedirect(error)).toBe(true)
  const options = (error as { options: { to?: string; search?: Record<string, unknown> } }).options
  expect(options.to).toBe(signInPath)
  expect(options.search).toEqual({ callbackUrl: href })
}

describe('loadAdminLayoutContext', () => {
  it('returns the loaded context when the access credential verifies', async () => {
    const d = deps()
    await expect(loadAdminLayoutContext(d)).resolves.toBe(context)
    expect(d.renewSession).not.toHaveBeenCalled()
  })

  it('renews in the browser after access expiry and retries the load once', async () => {
    const d = deps({
      load: vi
        .fn()
        .mockRejectedValueOnce(ERR_ACCESS_EXPIRED({ message: 'expired' }))
        .mockResolvedValueOnce(context),
    })
    await expect(loadAdminLayoutContext(d)).resolves.toBe(context)
    expect(d.renewSession).toHaveBeenCalledTimes(1)
    expect(d.load).toHaveBeenCalledTimes(2)
  })

  it('redirects to sign-in on the server after access expiry without renewing', async () => {
    const d = deps({
      isBrowser: false,
      load: vi.fn().mockRejectedValue(ERR_ACCESS_EXPIRED({ message: 'expired' })),
    })
    await expectSignInRedirect(loadAdminLayoutContext(d))
    expect(d.renewSession).not.toHaveBeenCalled()
    expect(d.load).toHaveBeenCalledTimes(1)
  })

  it('redirects to sign-in when browser renewal reports a terminal outcome', async () => {
    const d = deps({
      load: vi.fn().mockRejectedValue(ERR_ACCESS_EXPIRED({ message: 'expired' })),
      renewSession: vi.fn().mockRejectedValue(ERR_REVOKED_TOKEN({ message: 'revoked' })),
    })
    await expectSignInRedirect(loadAdminLayoutContext(d))
    expect(d.load).toHaveBeenCalledTimes(1)
  })

  it('redirects to sign-in when browser renewal fails for a non-auth reason', async () => {
    const d = deps({
      load: vi.fn().mockRejectedValue(ERR_ACCESS_EXPIRED({ message: 'expired' })),
      renewSession: vi.fn().mockRejectedValue(new Error('network')),
    })
    await expectSignInRedirect(loadAdminLayoutContext(d))
    expect(d.load).toHaveBeenCalledTimes(1)
  })

  it('propagates a non-auth failure from the retried load after a successful renewal', async () => {
    const failure = new Error('analytics runtime unavailable')
    const d = deps({
      load: vi
        .fn()
        .mockRejectedValueOnce(ERR_ACCESS_EXPIRED({ message: 'expired' }))
        .mockRejectedValueOnce(failure),
    })
    await expect(loadAdminLayoutContext(d)).rejects.toBe(failure)
    expect(d.renewSession).toHaveBeenCalledTimes(1)
  })

  it('redirects to sign-in when the retried load still reports an auth error', async () => {
    const d = deps({
      load: vi
        .fn()
        .mockRejectedValueOnce(ERR_ACCESS_EXPIRED({ message: 'expired' }))
        .mockRejectedValueOnce(ERR_UNAUTHENTICATED({ message: 'no session' })),
    })
    await expectSignInRedirect(loadAdminLayoutContext(d))
    expect(d.renewSession).toHaveBeenCalledTimes(1)
  })

  it('redirects to sign-in without renewing when no session is present', async () => {
    const d = deps({
      load: vi.fn().mockRejectedValue(ERR_UNAUTHENTICATED({ message: 'no session' })),
    })
    await expectSignInRedirect(loadAdminLayoutContext(d))
    expect(d.renewSession).not.toHaveBeenCalled()
  })

  it('redirects without renewing when the page already flagged a session change', async () => {
    const d = deps({
      sessionChanged: () => true,
      load: vi.fn().mockRejectedValue(ERR_ACCESS_EXPIRED({ message: 'expired' })),
    })
    await expectSignInRedirect(loadAdminLayoutContext(d))
    expect(d.renewSession).not.toHaveBeenCalled()
  })

  it('rethrows non-auth load failures unchanged', async () => {
    const failure = new Error('database unavailable')
    const d = deps({ load: vi.fn().mockRejectedValue(failure) })
    await expect(loadAdminLayoutContext(d)).rejects.toBe(failure)
    expect(d.renewSession).not.toHaveBeenCalled()
  })
})
