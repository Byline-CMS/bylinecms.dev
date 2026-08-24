/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import {
  createAnalyticsEventHandler,
  localAnalyticsRequestContext,
  trustedAnalyticsHeaders,
} from './analytics-events.js'

describe('createAnalyticsEventHandler', () => {
  it('passes only explicit trusted request facts and emits no CORS response header', async () => {
    const ingest = vi.fn().mockResolvedValue({ status: 202, accepted: true })
    const handler = createAnalyticsEventHandler({
      resolveRequestContext: trustedAnalyticsHeaders({
        clientIpHeader: 'x-byline-client-ip',
        countryHeader: 'x-byline-client-country',
      }),
      analytics: () => ({ ingest }),
    })
    const body = JSON.stringify({ v: 1, kind: 'page', path: '/', ref: '' })
    const response = await handler(
      new Request('https://www.example.com/api/events', {
        method: 'POST',
        body,
        headers: {
          origin: 'https://www.example.com',
          'user-agent': 'Mozilla/5.0',
          'x-byline-client-country': 'TH',
          'x-byline-client-ip': '203.0.113.10',
          'x-forwarded-for': '198.51.100.99',
        },
      })
    )

    expect(response.status).toBe(202)
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
    expect(ingest).toHaveBeenCalledOnce()
    expect(ingest.mock.calls[0]?.[0]).toMatchObject({
      clientIp: '203.0.113.10',
      country: 'TH',
      origin: 'https://www.example.com',
    })
    expect(ingest.mock.calls[0]?.[0]).not.toHaveProperty('xForwardedFor')
  })

  it('stops reading an oversized stream and reports the contract body-size rejection', async () => {
    const ingest = vi.fn().mockResolvedValue({ status: 400, accepted: false, reason: 'body-size' })
    const handler = createAnalyticsEventHandler({
      resolveRequestContext: trustedAnalyticsHeaders({
        clientIpHeader: 'x-byline-client-ip',
      }),
      analytics: () => ({ ingest }),
    })

    const response = await handler(
      new Request('https://www.example.com/api/events', {
        method: 'POST',
        body: 'x'.repeat(1_025),
        headers: { 'x-byline-client-ip': '203.0.113.10' },
      })
    )

    expect(response.status).toBe(400)
    const received = ingest.mock.calls.at(0)?.at(0)
    expect(received).toBeDefined()
    expect((received?.body as Uint8Array | undefined)?.byteLength).toBe(1_025)
  })

  it('uses an explicit development identity only when the trusted header is absent', async () => {
    const ingest = vi.fn().mockResolvedValue({ status: 202, accepted: true })
    const handler = createAnalyticsEventHandler({
      resolveRequestContext: trustedAnalyticsHeaders({
        clientIpHeader: 'x-byline-client-ip',
        fallback: { clientIp: 'vite-development' },
      }),
      analytics: () => ({ ingest }),
    })
    const body = JSON.stringify({ v: 1, kind: 'page', path: '/', ref: '' })

    await handler(
      new Request('http://localhost:5173/api/events', {
        method: 'POST',
        body,
      })
    )
    await handler(
      new Request('http://localhost:5173/api/events', {
        method: 'POST',
        body,
        headers: { 'x-byline-client-ip': '203.0.113.10' },
      })
    )

    expect(ingest.mock.calls[0]?.[0].clientIp).toBe('vite-development')
    expect(ingest.mock.calls[1]?.[0].clientIp).toBe('203.0.113.10')
  })

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'accepts direct loopback identity %s for a localhost production preview',
    async (clientIp) => {
      const resolver = localAnalyticsRequestContext({ resolveClientIp: () => clientIp })

      await expect(resolver(new Request('http://localhost:5173/api/events'))).resolves.toEqual({
        clientIp,
      })
    }
  )

  it('requires both a loopback URL and a loopback direct peer', async () => {
    const loopbackPeer = localAnalyticsRequestContext({ resolveClientIp: () => '127.0.0.1' })
    const publicPeer = localAnalyticsRequestContext({ resolveClientIp: () => '203.0.113.10' })

    await expect(loopbackPeer(new Request('https://www.example.com/api/events'))).resolves.toEqual(
      {}
    )
    await expect(publicPeer(new Request('http://localhost:5173/api/events'))).resolves.toEqual({})
  })

  it('prefers the trusted proxy header over a local fallback resolver', async () => {
    const resolver = trustedAnalyticsHeaders({
      clientIpHeader: 'x-byline-client-ip',
      fallback: localAnalyticsRequestContext({ resolveClientIp: () => '127.0.0.1' }),
    })

    await expect(
      resolver(
        new Request('http://localhost:5173/api/events', {
          headers: { 'x-byline-client-ip': '203.0.113.10' },
        })
      )
    ).resolves.toEqual({ clientIp: '203.0.113.10', country: undefined })
  })

  it('rejects an empty development identity', () => {
    expect(() =>
      trustedAnalyticsHeaders({
        clientIpHeader: 'x-byline-client-ip',
        fallback: { clientIp: ' ' },
      })
    ).toThrow('fallback.clientIp must contain 1 to 255 characters')
  })

  it('rejects an invalid configured trust header before serving requests', () => {
    expect(() =>
      trustedAnalyticsHeaders({
        clientIpHeader: 'not a header:',
      })
    ).toThrow('valid HTTP header name')
  })

  it('accepts deployment facts from a host resolver without assuming a proxy', async () => {
    const ingest = vi.fn().mockResolvedValue({ status: 202, accepted: true })
    const resolveRequestContext = vi.fn().mockReturnValue({
      clientIp: 'direct-platform-client',
      country: 'NZ',
    })
    const handler = createAnalyticsEventHandler({
      resolveRequestContext,
      analytics: () => ({ ingest }),
    })
    const request = new Request('https://www.example.com/telemetry/events', {
      method: 'POST',
      body: JSON.stringify({ v: 1, kind: 'page', path: '/', ref: '' }),
    })

    expect((await handler(request)).status).toBe(202)
    expect(resolveRequestContext).toHaveBeenCalledWith(request)
    expect(ingest.mock.calls[0]?.[0]).toMatchObject({
      clientIp: 'direct-platform-client',
      country: 'NZ',
    })
  })

  it('contains persistence failures as an empty 503 and logs no request facts', async () => {
    const visitorHash = 'a'.repeat(64)
    const error = Object.assign(new Error('new row violates analytics constraint'), {
      code: '23514',
      detail: `Failing row contains visitor ${visitorHash}`,
    })
    const ingest = vi.fn().mockRejectedValue(error)
    const logError = vi.fn()
    const handler = createAnalyticsEventHandler({
      resolveRequestContext: trustedAnalyticsHeaders({
        clientIpHeader: 'x-byline-client-ip',
      }),
      analytics: () => ({ ingest }),
      logger: () => ({ error: logError }),
    })

    const response = await handler(
      new Request('https://www.example.com/api/events', {
        method: 'POST',
        body: JSON.stringify({ v: 1, kind: 'page', path: '/', ref: '' }),
        headers: {
          origin: 'https://www.example.com',
          'user-agent': 'Mozilla/5.0',
          'x-byline-client-ip': '203.0.113.10',
        },
      })
    )

    expect(response.status).toBe(503)
    expect(await response.text()).toBe('')
    expect(logError).toHaveBeenCalledWith(
      { errorCode: '23514' },
      '[analytics] event persistence failed'
    )
    const logged = JSON.stringify(logError.mock.calls)
    expect(logged).not.toContain('203.0.113.10')
    expect(logged).not.toContain(visitorHash)
    expect(logged).not.toContain(error.message)
    expect(logged).not.toContain(error.detail)
  })

  it('does not trust arbitrary persistence error codes', async () => {
    const ingest = vi.fn().mockRejectedValue({ code: 'unsafe value: 203.0.113.10' })
    const logError = vi.fn()
    const handler = createAnalyticsEventHandler({
      resolveRequestContext: trustedAnalyticsHeaders({
        clientIpHeader: 'x-byline-client-ip',
      }),
      analytics: () => ({ ingest }),
      logger: () => ({ error: logError }),
    })

    await handler(
      new Request('https://www.example.com/api/events', {
        method: 'POST',
        body: JSON.stringify({ v: 1, kind: 'page', path: '/', ref: '' }),
      })
    )

    expect(logError).toHaveBeenCalledWith(
      { errorCode: 'UNKNOWN' },
      '[analytics] event persistence failed'
    )
  })
})
