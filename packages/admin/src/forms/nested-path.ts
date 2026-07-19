/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Minimal nested `get`/`set` over string field paths, replacing lodash-es
 * (which pulled a large shared chunk onto unrelated bundles). Supports the
 * dot + bracket notation produced by the form field-path builders, e.g.
 * `title`, `a.b.c`, `items[0].title`, `blocks[id=abc].nested[1].field`.
 *
 * `set` mirrors lodash semantics: it creates intermediate **arrays** when the
 * next path segment is a numeric index and plain **objects** otherwise, and it
 * mutates `object` in place (callers shallow-copy the root first, as before).
 *
 * Deliberately NOT a general lodash replacement — it does not handle quoted
 * keys (`a["b.c"]`), negative indices, or array-path inputs, none of which the
 * form paths ever produce. See nested-path.test.node.ts for the covered cases.
 */

import { type PathSegment, parseInstancePath } from '@byline/core'

/** Split a field path into segments: `items[0].title` -> ['items','0','title']. */
export function toPath(path: string): string[] {
  return path.match(/[^.[\]]+/g) ?? []
}

function selectId(value: unknown, id: string): number {
  if (!Array.isArray(value)) return -1
  return value.findIndex((item) => item != null && typeof item === 'object' && item._id === id)
}

function newContainer(next: PathSegment | undefined): any[] | Record<string, unknown> {
  return next?.kind === 'index' || next?.kind === 'id' ? [] : {}
}

// Returns `any` (not `T | undefined`) to match lodash's loose `get` contract,
// so existing call sites that treat the result as `any` keep type-checking.
export function get<T = any>(object: unknown, path: string): T {
  if (object == null) return undefined as T
  const parsed = parseInstancePath(path)
  if (!parsed.ok) return undefined as T

  let current: any = object
  for (const segment of parsed.segments) {
    if (current == null) return undefined as T
    if (segment.kind === 'field') {
      current = current[segment.name]
    } else if (segment.kind === 'index') {
      current = current[segment.index]
    } else if (segment.kind === 'id') {
      const index = selectId(current, segment.id)
      if (index === -1) return undefined as T
      current = current[index]
    } else {
      return undefined as T
    }
  }
  return current as T
}

/** Whether every stable-id selector in a path still identifies a live item. */
export function hasExistingIdTargets(object: unknown, path: string): boolean {
  const parsed = parseInstancePath(path)
  if (!parsed.ok) return false

  let current: any = object
  for (const segment of parsed.segments) {
    if (segment.kind === 'field') {
      current = current?.[segment.name]
    } else if (segment.kind === 'index') {
      current = current?.[segment.index]
    } else if (segment.kind === 'id') {
      const index = selectId(current, segment.id)
      if (index === -1) return false
      current = current[index]
    } else {
      return false
    }
  }
  return true
}

/** Set a path and report whether all stable-id selectors resolved. */
export function setWithResult<T extends object>(object: T, path: string, value: unknown): boolean {
  if (object == null) return false
  const parsed = parseInstancePath(path)
  if (!parsed.ok || parsed.segments.length === 0) return false

  let current: any = object
  for (let i = 0; i < parsed.segments.length; i++) {
    const segment = parsed.segments[i] as PathSegment
    const next = parsed.segments[i + 1]
    const last = i === parsed.segments.length - 1

    if (segment.kind === 'field') {
      if (last) {
        current[segment.name] = value
        return true
      }
      const existing = current[segment.name]
      if (existing == null || typeof existing !== 'object') {
        // Do not create a partial container on the way to an item identity
        // that may no longer exist. Normal non-ID lodash-style writes still
        // create their intermediate structure below.
        if (parsed.segments.slice(i + 1).some((candidate) => candidate.kind === 'id')) return false
        current[segment.name] = newContainer(next)
      }
      current = current[segment.name]
      continue
    }

    if (segment.kind === 'index') {
      if (!Array.isArray(current)) return false
      if (last) {
        current[segment.index] = value
        return true
      }
      const existing = current[segment.index]
      if (existing == null || typeof existing !== 'object') {
        if (parsed.segments.slice(i + 1).some((candidate) => candidate.kind === 'id')) return false
        current[segment.index] = newContainer(next)
      }
      current = current[segment.index]
      continue
    }

    if (segment.kind === 'id') {
      const index = selectId(current, segment.id)
      if (index === -1) return false
      if (last) {
        current[index] = value
        return true
      }
      current = current[index]
      continue
    }

    return false
  }
  return false
}

export function set<T extends object>(object: T, path: string, value: unknown): T {
  setWithResult(object, path, value)
  return object
}
