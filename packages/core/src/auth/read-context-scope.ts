/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ReadContext } from '../@types/db-types.js'

export interface ReadContextScope {
  root: ReadContext
  ancestry: readonly object[]
}

const readContextScopes = new WeakMap<ReadContext, ReadContextScope>()

export function getReadContextScope(readContext: ReadContext): ReadContextScope {
  return readContextScopes.get(readContext) ?? { root: readContext, ancestry: [] }
}

/** Resolve a scoped hook context to the ReadContext for its logical request. */
export function resolveReadContextRoot(readContext: ReadContext): ReadContext {
  return getReadContextScope(readContext).root
}

/**
 * Carry hook ancestry by object identity, not by a forgeable public property.
 * All mutable read-budget state still delegates to the logical root context.
 */
export function createHookReadContext(parent: ReadContextScope, entry: object): ReadContext {
  const root = parent.root
  const scoped = {} as ReadContext
  Object.defineProperties(scoped, {
    visited: { enumerable: true, get: () => root.visited, set: (value) => (root.visited = value) },
    beforeReadCache: {
      enumerable: true,
      get: () => root.beforeReadCache,
      set: (value) => (root.beforeReadCache = value),
    },
    readCount: {
      enumerable: true,
      get: () => root.readCount,
      set: (value) => (root.readCount = value),
    },
    maxReads: {
      enumerable: true,
      get: () => root.maxReads,
      set: (value) => (root.maxReads = value),
    },
    maxDepth: {
      enumerable: true,
      get: () => root.maxDepth,
      set: (value) => (root.maxDepth = value),
    },
  })
  readContextScopes.set(scoped, { root, ancestry: [...parent.ancestry, entry] })
  return scoped
}
