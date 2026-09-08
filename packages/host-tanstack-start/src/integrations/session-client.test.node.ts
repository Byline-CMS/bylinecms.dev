/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ renew: vi.fn() }))
vi.mock('../server-fns/auth/renew.js', () => ({ renewAdminSession: mocks.renew }))
vi.mock('@byline/client/server', () => ({ getAdminRequestContext: vi.fn() }))

let middleware: typeof import('./session-middleware.js')
let coordination: typeof import('./session-coordination.js')
const boundary = (outcome: string) =>
  new Response('result', { headers: { 'x-byline-auth-boundary': outcome } })
const request = async (body: BodyInit = 'edit') => {
  return middleware.adminSessionMiddleware.options.client?.({
    next: (options: any) => options.fetch('http://localhost/business', { method: 'POST', body }),
  } as any)
}
beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  const storage = new Map<string, string>()
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('BroadcastChannel', undefined)
  coordination = await import('./session-coordination.js')
  middleware = await import('./session-middleware.js')
  coordination.acceptSession('A')
  mocks.renew.mockResolvedValue({ sessionId: 'A' })
})
afterEach(() => vi.unstubAllGlobals())

describe('coordinated business resend', () => {
  it('coalesces six expiry responses into one renewal and resends each operation once', async () => {
    const fetch = vi.fn().mockImplementationOnce(() => boundary('renew'))
    for (let i = 1; i < 6; i++) fetch.mockImplementationOnce(() => boundary('renew'))
    fetch.mockImplementation(() => boundary('handled'))
    vi.stubGlobal('fetch', fetch)
    await Promise.all(Array.from({ length: 6 }, () => request()))
    expect(mocks.renew).toHaveBeenCalledTimes(1)
    expect(mocks.renew).toHaveBeenCalledWith({ data: { expectedSessionId: 'A' } })
    expect(fetch).toHaveBeenCalledTimes(12)
  })
  it('re-serializes multipart uploads without cloning or teeing the request', async () => {
    const bodies: Array<{ title: string; file: string }> = []
    const clone = vi.spyOn(Request.prototype, 'clone')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const form = await new Request(input, init).formData()
        bodies.push({
          title: String(form.get('title')),
          file: await (form.get('upload') as Blob).text(),
        })
        return boundary(bodies.length === 1 ? 'renew' : 'handled')
      })
    )
    const body = new FormData()
    body.set('title', 'An editorial change')
    body.set('upload', new Blob(['file-content']), 'example.txt')
    await request(body)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toEqual({ title: 'An editorial change', file: 'file-content' })
    expect(bodies[1]).toEqual(bodies[0])
    expect(clone).not.toHaveBeenCalled()
    clone.mockRestore()
  })
  it('renews but requires an explicit retry for a one-shot stream body', async () => {
    const fetch = vi.fn().mockResolvedValue(boundary('renew'))
    vi.stubGlobal('fetch', fetch)
    const stream = new ReadableStream({
      start(controller) {
        controller.close()
      },
    })
    await expect(request(stream)).rejects.toThrow('Please retry the operation')
    expect(fetch).toHaveBeenCalledOnce()
    expect(mocks.renew).toHaveBeenCalledOnce()
  })
  it('never retries a post-handler error or an ambiguous network failure', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('failed', { status: 500, headers: { 'x-byline-auth-boundary': 'handled' } })
      )
    vi.stubGlobal('fetch', fetch)
    await request()
    expect(fetch).toHaveBeenCalledOnce()
    fetch.mockReset().mockRejectedValue(new Error('connection lost'))
    await expect(request()).rejects.toThrow('connection lost')
    expect(fetch).toHaveBeenCalledOnce()
    expect(mocks.renew).not.toHaveBeenCalled()
  })
  it('does not replay work when the session changes during renewal', async () => {
    const fetch = vi.fn().mockResolvedValue(boundary('renew'))
    vi.stubGlobal('fetch', fetch)
    mocks.renew.mockImplementation(async () => {
      coordination.flagSessionChanged()
      return { sessionId: 'A' }
    })
    await expect(request()).rejects.toThrow('Session changed')
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('stops after one resend even if access expires again', async () => {
    const fetch = vi.fn().mockImplementation(() => boundary('renew'))
    vi.stubGlobal('fetch', fetch)
    await request()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(mocks.renew).toHaveBeenCalledOnce()
  })
})
