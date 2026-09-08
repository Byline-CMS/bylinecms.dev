/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { isIP } from 'node:net'

import type { ClientIpResolver } from '@byline/auth'

/** Normalize equivalent IPv6 spellings and IPv4-mapped IPv6 before choosing a rate-limit key. */
export function normalizeClientIp(value: string | null | undefined): string | null {
  if (!value || value.length > 64) return null
  const ip = value.trim()
  if (isIP(ip) === 4) return ip
  if (isIP(ip) !== 6 || ip.includes('%')) return null
  const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1)
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(normalized)
  if (mapped) {
    const high = Number.parseInt(mapped[1]!, 16)
    const low = Number.parseInt(mapped[2]!, 16)
    return [high >>> 8, high & 255, low >>> 8, low & 255].join('.')
  }
  return normalized
}

/**
 * Configure either a direct peer resolver or an explicitly trusted proxy header.
 * Header mode requires the deployment to overwrite that header and block proxy bypass.
 * Never falls back from a missing/invalid trusted header to another client-supplied header.
 */
export function createClientIpResolver(options: {
  trustedProxyHeader?: string
  resolvePeerIp: ClientIpResolver
}): ClientIpResolver {
  const header = options.trustedProxyHeader
  if (header !== undefined && !/^[a-z0-9-]+$/i.test(header))
    throw new Error('Invalid trusted IP header')
  let lastDiagnostic = -Infinity
  return async (request) => {
    const ip = normalizeClientIp(
      header === undefined ? await options.resolvePeerIp(request) : request.headers.get(header)
    )
    if (!ip && performance.now() - lastDiagnostic >= 60_000) {
      lastDiagnostic = performance.now()
      console.warn(
        '[byline:client-ip] No valid single client IP; check the configured peer resolver or trusted proxy header.'
      )
    }
    return ip
  }
}
