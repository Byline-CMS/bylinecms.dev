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
 * `title`, `a.b.c`, `items[0].title`, `blocks[2].nested[1].field`.
 *
 * `set` mirrors lodash semantics: it creates intermediate **arrays** when the
 * next path segment is a numeric index and plain **objects** otherwise, and it
 * mutates `object` in place (callers shallow-copy the root first, as before).
 *
 * Deliberately NOT a general lodash replacement — it does not handle quoted
 * keys (`a["b.c"]`), negative indices, or array-path inputs, none of which the
 * form paths ever produce. See nested-path.test.node.ts for the covered cases.
 */

const isIndexKey = (key: string): boolean => /^(?:0|[1-9]\d*)$/.test(key)

/** Split a field path into segments: `items[0].title` -> ['items','0','title']. */
export function toPath(path: string): string[] {
  return path.match(/[^.[\]]+/g) ?? []
}

// Returns `any` (not `T | undefined`) to match lodash's loose `get` contract,
// so existing call sites that treat the result as `any` keep type-checking.
export function get<T = any>(object: unknown, path: string): T {
  if (object == null) return undefined as T
  let current: any = object
  for (const key of toPath(path)) {
    if (current == null) return undefined as T
    current = current[key]
  }
  return current as T
}

export function set<T extends object>(object: T, path: string, value: unknown): T {
  if (object == null) return object
  const keys = toPath(path)
  if (keys.length === 0) return object

  let current: any = object
  for (let i = 0; i < keys.length - 1; i++) {
    // Bounded by the loop condition, so these indexed reads are always defined.
    const key = keys[i] as string
    const nextKey = keys[i + 1] as string
    const existing = current[key]
    if (existing == null || typeof existing !== 'object') {
      // Create the container the next segment needs: array for an index, else object.
      current[key] = isIndexKey(nextKey) ? [] : {}
    }
    current = current[key]
  }
  current[keys[keys.length - 1] as string] = value
  return object
}
