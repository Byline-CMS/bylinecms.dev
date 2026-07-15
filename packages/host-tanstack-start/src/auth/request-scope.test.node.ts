/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Unit coverage for per-request memoization. Mocks the Start runtime's
 * `getRequest` so "which request am I in" can be simulated: a stable
 * object per request, or a throw when running outside a request.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRequest: vi.fn(),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: mocks.getRequest,
}))

import { oncePerRequest } from './request-scope.js'

describe('oncePerRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRequest.mockImplementation(() => {
      throw new Error('No StartEvent found in AsyncLocalStorage')
    })
  })

  it('resolves the factory once per request per key', async () => {
    mocks.getRequest.mockReturnValue({ id: 'request-a' })
    const factory = vi.fn(async () => ({ token: Math.random() }))

    const first = await oncePerRequest('ctx', factory)
    const second = await oncePerRequest('ctx', factory)

    expect(second).toBe(first)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('keys memoization by request identity', async () => {
    const requestA = { id: 'a' }
    const requestB = { id: 'b' }
    const factory = vi.fn(async () => ({ token: Math.random() }))

    mocks.getRequest.mockReturnValue(requestA)
    const first = await oncePerRequest('ctx', factory)
    mocks.getRequest.mockReturnValue(requestB)
    const second = await oncePerRequest('ctx', factory)

    expect(second).not.toBe(first)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('isolates entries by key within one request', async () => {
    mocks.getRequest.mockReturnValue({ id: 'request-a' })
    const admin = vi.fn(async () => 'admin-context')
    const publicCtx = vi.fn(async () => 'public-context')

    await expect(oncePerRequest('admin', admin)).resolves.toBe('admin-context')
    await expect(oncePerRequest('public', publicCtx)).resolves.toBe('public-context')
    await expect(oncePerRequest('admin', admin)).resolves.toBe('admin-context')

    expect(admin).toHaveBeenCalledTimes(1)
    expect(publicCtx).toHaveBeenCalledTimes(1)
  })

  it('memoizes rejections for the remainder of the request', async () => {
    mocks.getRequest.mockReturnValue({ id: 'request-a' })
    const factory = vi.fn(async () => {
      throw new Error('no admin session')
    })

    await expect(oncePerRequest('ctx', factory)).rejects.toThrow('no admin session')
    await expect(oncePerRequest('ctx', factory)).rejects.toThrow('no admin session')
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('runs unmemoized outside the Start runtime', async () => {
    const factory = vi.fn(async () => ({ token: Math.random() }))

    const first = await oncePerRequest('ctx', factory)
    const second = await oncePerRequest('ctx', factory)

    expect(second).not.toBe(first)
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
