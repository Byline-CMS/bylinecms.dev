/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ANALYTICS_MAX_BODY_BYTES, type Analytics, getAnalytics } from '@byline/analytics'
import { type BylineLogger, getLogger } from '@byline/core'

export interface AnalyticsEventHandlerOptions {
  /** Host-owned resolver for deployment-specific, request-scoped network facts. */
  resolveRequestContext: AnalyticsRequestContextResolver
  /** Test/embedding seam; production resolves the registered installation runtime. */
  analytics?: () => Pick<Analytics, 'ingest'>
  /** Test/embedding seam; production resolves the initialized application logger. */
  logger?: () => Pick<BylineLogger, 'error'>
}

export interface AnalyticsRequestContext {
  clientIp?: string | null
  country?: string | null
}

export type AnalyticsRequestContextResolver = (
  request: Request
) => AnalyticsRequestContext | Promise<AnalyticsRequestContext>

export interface LocalAnalyticsRequestContextOptions {
  /** Resolve the direct peer address from the host runtime, without forwarded headers. */
  resolveClientIp: (
    request: Request
  ) => string | null | undefined | Promise<string | null | undefined>
  /** Explicit development-only identity for runtimes that expose no peer address. */
  developmentFallbackClientIp?: string
}

export interface TrustedAnalyticsHeadersOptions {
  /** Header overwritten by the trusted reverse proxy with the normalized client address. */
  clientIpHeader: string
  /** Optional header overwritten by the trusted edge with an ISO country code. */
  countryHeader?: string
  /** Explicit context or resolver used only when a trusted header is absent. */
  fallback?: AnalyticsRequestContext | AnalyticsRequestContextResolver
}

/**
 * Resolve an identity for a server reached directly through a loopback URL.
 * Both the URL and the direct peer address must be loopback. This is safe for
 * a directly reached local server. A same-host reverse proxy also appears as
 * a loopback peer, however, so do not expose this fallback through a public
 * proxy where a client can select the Host header.
 */
export function localAnalyticsRequestContext(
  options: LocalAnalyticsRequestContextOptions
): AnalyticsRequestContextResolver {
  const developmentFallbackClientIp =
    options.developmentFallbackClientIp == null
      ? undefined
      : validateFact(options.developmentFallbackClientIp, 'developmentFallbackClientIp', 255)

  return async (request) => {
    const clientIp = await options.resolveClientIp(request)
    if (isLoopbackHostname(new URL(request.url).hostname) && isLoopbackAddress(clientIp)) {
      return { clientIp: validateFact(clientIp, 'resolved clientIp', 255) }
    }
    return developmentFallbackClientIp == null ? {} : { clientIp: developmentFallbackClientIp }
  }
}

/**
 * Resolve network facts from headers owned and overwritten by a trusted proxy.
 * This helper does not establish that trust: the deployment must prevent a
 * client from selecting the configured header values or bypassing the proxy.
 */
export function trustedAnalyticsHeaders(
  options: TrustedAnalyticsHeadersOptions
): AnalyticsRequestContextResolver {
  const clientIpHeader = validateHeaderName(options.clientIpHeader, 'clientIpHeader')
  const countryHeader =
    options.countryHeader == null
      ? undefined
      : validateHeaderName(options.countryHeader, 'countryHeader')
  const fallback =
    typeof options.fallback === 'function' ? options.fallback : validateFallback(options.fallback)

  return async (request) => {
    const fallbackContext =
      typeof fallback === 'function' ? validateFallback(await fallback(request)) : fallback
    return {
      clientIp: request.headers.get(clientIpHeader)?.trim() || fallbackContext?.clientIp,
      country:
        (countryHeader == null ? null : request.headers.get(countryHeader)?.trim()) ||
        fallbackContext?.country,
    }
  }
}

export function createAnalyticsEventHandler(
  options: AnalyticsEventHandlerOptions
): (request: Request) => Promise<Response> {
  const resolveAnalytics = options.analytics ?? getAnalytics

  return async (request) => {
    const body = await readBoundedBody(request, ANALYTICS_MAX_BODY_BYTES)
    try {
      const requestContext = await options.resolveRequestContext(request)
      const result = await resolveAnalytics().ingest({
        method: request.method,
        body: body ?? new Uint8Array(ANALYTICS_MAX_BODY_BYTES + 1),
        origin: request.headers.get('origin'),
        referer: request.headers.get('referer'),
        userAgent: request.headers.get('user-agent'),
        secPurpose: request.headers.get('sec-purpose'),
        xPurpose: request.headers.get('x-purpose'),
        clientIp: requestContext.clientIp,
        country: requestContext.country,
      })

      return analyticsResponse(result.status)
    } catch (error) {
      const logger = options.logger?.() ?? getLogger()
      logger.error({ errorCode: safeErrorCode(error) }, '[analytics] event persistence failed')
      return analyticsResponse(503)
    }
  }
}

function safeErrorCode(error: unknown): string {
  if (error == null || typeof error !== 'object' || !('code' in error)) return 'UNKNOWN'
  const code = error.code
  return typeof code === 'string' && /^[a-z0-9_-]{1,64}$/iu.test(code) ? code : 'UNKNOWN'
}

function analyticsResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array | null> {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > limit) return null
  if (request.body == null) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function validateHeaderName(value: string, label: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/u.test(normalized)) {
    throw new Error(`analytics ${label} must be a valid HTTP header name`)
  }
  return normalized
}

function validateFallback(
  value: AnalyticsRequestContext | undefined
): AnalyticsRequestContext | undefined {
  if (value == null) return undefined
  return {
    ...(value.clientIp == null
      ? {}
      : { clientIp: validateFact(value.clientIp, 'fallback.clientIp', 255) }),
    ...(value.country == null
      ? {}
      : { country: validateFact(value.country, 'fallback.country', 16) }),
  }
}

function validateFact(value: string, label: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new Error(`analytics ${label} must contain 1 to ${maxLength} characters`)
  }
  return normalized
}

function isLoopbackHostname(value: string): boolean {
  const normalized = stripIpv6Brackets(value.toLowerCase())
  return (
    normalized === 'localhost' || normalized.endsWith('.localhost') || isLoopbackAddress(normalized)
  )
}

function isLoopbackAddress(value: string | null | undefined): value is string {
  if (value == null) return false
  const normalized = stripIpv6Brackets(value.trim().toLowerCase())
  return (
    normalized === '::1' ||
    /^127(?:\.\d{1,3}){3}$/u.test(normalized) ||
    /^::ffff:127(?:\.\d{1,3}){3}$/u.test(normalized)
  )
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
}
