/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Unit coverage for per-request memoization. Registers a fake
 * `HostRequestBridge` so "which request am I in" can be simulated: a
 * stable object per request, or `undefined` when running outside a
 * request.
 */

import { registerHostRequestBridge } from '@byline/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { oncePerRequest } from './request-scope.js'

const BRIDGE_SLOT = Symbol.for('__byline_host_request_bridge__')
const previousBridge = (globalThis as Record<PropertyKey, unknown>)[BRIDGE_SLOT]

const bridge = {
  getRequest: vi.fn<() => object | undefined>(),
  getCookie: vi.fn<(name: string) => string | undefined>(),
  setCookie: vi.fn(),
}

describe('oncePerRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerHostRequestBridge(bridge)
    // Default: no request in scope, so every call resolves fresh.
    bridge.getRequest.mockReturnValue(undefined)
  })

  afterEach(() => {
    ;(globalThis as Record<PropertyKey, unknown>)[BRIDGE_SLOT] = previousBridge
  })

  it('resolves the factory once per request per key', async () => {
    bridge.getRequest.mockReturnValue({ id: 'request-a' })
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

    bridge.getRequest.mockReturnValue(requestA)
    const first = await oncePerRequest('ctx', factory)
    bridge.getRequest.mockReturnValue(requestB)
    const second = await oncePerRequest('ctx', factory)

    expect(second).not.toBe(first)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('isolates entries by key within one request', async () => {
    bridge.getRequest.mockReturnValue({ id: 'request-a' })
    const admin = vi.fn(async () => 'admin-context')
    const publicCtx = vi.fn(async () => 'public-context')

    await expect(oncePerRequest('admin', admin)).resolves.toBe('admin-context')
    await expect(oncePerRequest('public', publicCtx)).resolves.toBe('public-context')
    await expect(oncePerRequest('admin', admin)).resolves.toBe('admin-context')

    expect(admin).toHaveBeenCalledTimes(1)
    expect(publicCtx).toHaveBeenCalledTimes(1)
  })

  it('memoizes rejections for the remainder of the request', async () => {
    bridge.getRequest.mockReturnValue({ id: 'request-a' })
    const factory = vi.fn(async () => {
      throw new Error('no admin session')
    })

    await expect(oncePerRequest('ctx', factory)).rejects.toThrow('no admin session')
    await expect(oncePerRequest('ctx', factory)).rejects.toThrow('no admin session')
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('runs unmemoized outside a request', async () => {
    const factory = vi.fn(async () => ({ token: Math.random() }))

    const first = await oncePerRequest('ctx', factory)
    const second = await oncePerRequest('ctx', factory)

    expect(second).not.toBe(first)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('runs unmemoized when no host bridge is registered', async () => {
    ;(globalThis as Record<PropertyKey, unknown>)[BRIDGE_SLOT] = undefined
    const factory = vi.fn(async () => ({ token: Math.random() }))

    const first = await oncePerRequest('ctx', factory)
    const second = await oncePerRequest('ctx', factory)

    expect(second).not.toBe(first)
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
