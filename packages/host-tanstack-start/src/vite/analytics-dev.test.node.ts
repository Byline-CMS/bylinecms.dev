/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import { ANALYTICS_AGENT_SOURCE } from '@byline/analytics-agent/source'
import type { Plugin } from 'vite'
import { describe, expect, it, vi } from 'vitest'

import { bylineAnalyticsDev } from './analytics-dev.js'

type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void
) => void | Promise<void>

describe('bylineAnalyticsDev', () => {
  it('directly serves browser script requests before Vite can transform them', async () => {
    const handler = captureMiddleware(bylineAnalyticsDev())
    const request = requestStub('GET', '/b.js?version=current', {
      accept: '*/*',
      'sec-fetch-dest': 'script',
    })
    const { response, headers, end } = responseStub()
    const next = vi.fn()

    await handler(request, response, next)

    expect(response.statusCode).toBe(200)
    expect(headers).toEqual({
      'cache-control': 'public, max-age=3600, must-revalidate',
      'content-type': 'text/javascript; charset=utf-8',
      'x-content-type-options': 'nosniff',
    })
    expect(end).toHaveBeenCalledWith(ANALYTICS_AGENT_SOURCE)
    expect(next).not.toHaveBeenCalled()
    expect(request.headers).toEqual({
      accept: '*/*',
      'sec-fetch-dest': 'script',
    })
  })

  it('continues unrelated requests through the Vite middleware chain', async () => {
    const handler = captureMiddleware(bylineAnalyticsDev())
    const { response, end } = responseStub()
    const next = vi.fn()

    await handler(requestStub('GET', '/about'), response, next)
    await handler(requestStub('POST', '/api/events'), response, next)

    expect(next).toHaveBeenCalledTimes(2)
    expect(end).not.toHaveBeenCalled()
  })

  it('supports a custom public agent path', async () => {
    const handler = captureMiddleware(bylineAnalyticsDev({ agentPath: '/first-party.js' }))
    const defaultResponse = responseStub()
    const customResponse = responseStub()
    const next = vi.fn()

    await handler(requestStub('GET', '/b.js'), defaultResponse.response, next)
    await handler(requestStub('GET', '/first-party.js'), customResponse.response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(defaultResponse.end).not.toHaveBeenCalled()
    expect(customResponse.end).toHaveBeenCalledWith(ANALYTICS_AGENT_SOURCE)
  })
})

function captureMiddleware(plugin: Plugin): Middleware {
  const handlers: Middleware[] = []
  const configureServer = plugin.configureServer

  expect(typeof configureServer).toBe('function')
  if (typeof configureServer !== 'function') {
    throw new Error('Expected a Vite configureServer hook')
  }

  configureServer.call(
    {} as never,
    {
      middlewares: {
        use(handler: Middleware) {
          handlers.push(handler)
        },
      },
    } as never
  )

  const handler = handlers[0]
  expect(handler).toBeDefined()
  if (handler == null) throw new Error('Expected a Vite middleware')
  return handler
}

function requestStub(
  method: string,
  url: string,
  headers: IncomingMessage['headers'] = {}
): IncomingMessage {
  return { method, url, headers } as IncomingMessage
}

function responseStub(): {
  response: ServerResponse
  headers: Record<string, string | number | readonly string[]>
  end: ReturnType<typeof vi.fn>
} {
  const headers: Record<string, string | number | readonly string[]> = {}
  const end = vi.fn()
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name] = value
      return response
    },
    end,
  } as unknown as ServerResponse
  return { response, headers, end }
}
