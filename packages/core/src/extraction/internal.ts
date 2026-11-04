/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** A string that both has the form of an ISO 8601 date-time and parses as one. */
export function isIsoDateTime(value: unknown): boolean {
  return typeof value === 'string' && ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value))
}

export const isCount = (value: unknown): boolean =>
  Number.isSafeInteger(value) && (value as number) >= 0

/**
 * Whether every slot of an array passes a check. It reads slots by index because
 * `every` skips holes, and it stops at the first failure, so a very long sparse array
 * cannot stall it.
 */
export function everySlot(value: unknown, check: (slot: unknown) => boolean): boolean {
  if (!Array.isArray(value)) return false
  for (let i = 0; i < value.length; i += 1) {
    if (!check(value[i])) return false
  }
  return true
}

/**
 * Sorted keys and no insignificant whitespace, for hashing a configuration. `undefined`
 * object members are dropped, so an unset option hashes like an absent one. Any other
 * value JSON cannot represent exactly is rejected with a `TypeError` rather than coerced,
 * because two different values must never canonicalise the same. That includes array
 * holes and symbol keys.
 */
export function canonicalJson(value: unknown): string {
  return canonicalise(value, [], true)
}

function canonicalise(
  value: unknown,
  ancestors: readonly object[],
  dropUndefined: boolean
): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${value} is not a JSON value`)
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') {
    throw new TypeError(`A ${typeof value} is not a JSON value`)
  }
  if (ancestors.includes(value)) throw new TypeError('A cycle is not a JSON value')
  const path = [...ancestors, value]
  if (Array.isArray(value)) {
    // Indexed, because `map` skips holes. A hole reads as `undefined`, which is rejected.
    const items: string[] = []
    for (let i = 0; i < value.length; i += 1) {
      items.push(canonicalise(value[i], path, dropUndefined))
    }
    return `[${items.join(',')}]`
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Only plain objects are JSON values')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('A symbol key is not a JSON value')
  }
  const members = Object.entries(value)
    .filter(([, member]) => !dropUndefined || member !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalise(member, path, dropUndefined)}`)
  return `{${members.join(',')}}`
}

/**
 * Whether a value is a strict `JsonValue`. Unlike `canonicalJson`, it rejects an
 * `undefined` object member, which would be lost on persistence.
 */
export function isJsonValue(value: unknown): boolean {
  try {
    canonicalise(value, [], false)
    return true
  } catch {
    // Includes a RangeError from a structure nested too deeply to walk.
    return false
  }
}
