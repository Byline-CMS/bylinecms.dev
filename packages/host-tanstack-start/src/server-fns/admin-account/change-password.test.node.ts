/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Handler-level tests isolate transport; session-middleware tests exercise the real pre-handler boundary.
vi.mock('../../integrations/session-middleware.js', () => ({ adminSessionMiddleware: {} }))

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  command: vi.fn(),
  clear: vi.fn(),
  preview: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      middleware: () => chain,
      validator: () => ({ handler: (handler: unknown) => handler }),
    }
    return chain
  },
}))
vi.mock('@byline/admin/admin-account', () => ({ changeAccountPasswordCommand: mocks.command }))
vi.mock('@byline/client/server', () => ({
  getAdminRequestContext: mocks.context,
  clearSessionCookies: mocks.clear,
  clearPreviewCookie: mocks.preview,
}))
vi.mock('../../integrations/byline-core.js', () => ({ bylineCore: () => ({ adminStore: {} }) }))

import { changeAccountPassword } from './change-password.js'

const call = changeAccountPassword as unknown as (args: { data: unknown }) => Promise<unknown>
beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue({ actor: { id: 'current' } })
})
describe('password change cookie policy', () => {
  it('clears the changing session and preview only after the mutation succeeds', async () => {
    mocks.command.mockImplementation(async () => {
      expect(mocks.clear).not.toHaveBeenCalled()
      return { id: 'current', vid: 2 }
    })
    await expect(call({ data: {} })).resolves.toEqual({ id: 'current', vid: 2 })
    expect(mocks.clear).toHaveBeenCalledOnce()
    expect(mocks.preview).toHaveBeenCalledOnce()
  })
  it.each(['current password', 'stale revision', 'database rollback'])(
    'does not clear cookies after %s failure',
    async (reason) => {
      mocks.command.mockRejectedValue(new Error(reason))
      await expect(call({ data: {} })).rejects.toThrow(reason)
      expect(mocks.clear).not.toHaveBeenCalled()
      expect(mocks.preview).not.toHaveBeenCalled()
    }
  )
  it('does not mutate or clear cookies when authentication fails', async () => {
    mocks.context.mockRejectedValue(new Error('unauthenticated'))
    await expect(call({ data: {} })).rejects.toThrow('unauthenticated')
    expect(mocks.command).not.toHaveBeenCalled()
    expect(mocks.clear).not.toHaveBeenCalled()
  })
})
