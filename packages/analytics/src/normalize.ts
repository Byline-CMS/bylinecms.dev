/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ANALYTICS_MAX_PATH_LENGTH, ANALYTICS_OVERFLOW_KEY } from './config.js'
import type { AnalyticsEventKind } from './types.js'

interface BeaconPayload {
  v: 1
  kind: AnalyticsEventKind
  path: string
  ref: string
}

const PAYLOAD_KEYS = ['kind', 'path', 'ref', 'v'] as const

export function parseBeaconPayload(body: string): BeaconPayload | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (
    keys.length !== PAYLOAD_KEYS.length ||
    keys.some((key, index) => key !== PAYLOAD_KEYS[index])
  ) {
    return null
  }
  if (record.v !== 1 || (record.kind !== 'page' && record.kind !== 'download')) return null
  if (typeof record.path !== 'string' || typeof record.ref !== 'string') return null

  return { v: 1, kind: record.kind, path: record.path, ref: record.ref }
}

export function normalizeAnalyticsPath(value: string): string | null {
  if (!value.startsWith('/') || hasUnpairedSurrogate(value)) return null
  const withoutQuery = value.split(/[?#]/u, 1)[0] ?? ''
  const collapsed = withoutQuery.replace(/\/{2,}/gu, '/')
  const codePoints = [...collapsed]
  const capped = codePoints.slice(0, ANALYTICS_MAX_PATH_LENGTH).join('')
  return capped.length === 0 ? '/' : capped
}

export function isIgnoredAnalyticsPath(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => {
    if (prefix === '/') return true
    return path === prefix || path.startsWith(`${prefix}/`)
  })
}

export function requestHost(
  origin: string | null | undefined,
  referer: string | null | undefined
): string | null {
  const source = origin?.trim() || referer?.trim()
  if (!source || source === 'null') return null
  try {
    return new URL(source).host.toLowerCase().replace(/\.$/, '')
  } catch {
    return null
  }
}

export function normalizeReferrerHost(
  referrer: string,
  publicDomains: ReadonlySet<string>
): string | null {
  if (referrer.trim().length === 0) return null
  try {
    const host = new URL(referrer).host.toLowerCase().replace(/\.$/, '')
    if (host.length === 0 || host === ANALYTICS_OVERFLOW_KEY || publicDomains.has(host)) return null
    return [...host].slice(0, 255).join('')
  } catch {
    return null
  }
}

export function normalizeCountry(value: string | null | undefined): string | null {
  const country = value?.trim().toUpperCase()
  return country != null && /^[A-Z]{2}$/u.test(country) ? country : null
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true
    }
  }
  return false
}
