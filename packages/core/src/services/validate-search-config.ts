/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from '../@types/collection-types.js'

/** Whether a `SearchProvider` is registered on `ServerConfig.search`. */
export interface SearchProviderPresence {
  /** `ServerConfig.search != null` */
  provider: boolean
}

/**
 * Validate search configuration across every collection. Throws when any
 * collection opts into search (`CollectionDefinition.search`) but no
 * `SearchProvider` is registered on `ServerConfig.search` — otherwise
 * indexing and `client.search()` would silently no-op.
 *
 * Called once at `initBylineCore()` time, right after the richText field
 * validation. Fail-fast at boot is the right posture; the alternative is a
 * collection that declares it's searchable but never gets indexed.
 *
 * Note: a missing provider is only an error when at least one collection
 * actually opts in. Installations that don't use search leave
 * `ServerConfig.search` unset and pass cleanly.
 */
export function validateSearchConfig(
  collections: CollectionDefinition[],
  adapters: SearchProviderPresence
): void {
  if (adapters.provider) return

  const optedIn = collections.filter((def) => def.search != null).map((def) => def.path)
  if (optedIn.length === 0) return

  throw new Error(
    `initBylineCore: ${optedIn.length} collection(s) opt into search ` +
      `(${optedIn.join(', ')}) but no search provider is registered. ` +
      `Wire one via ServerConfig.search — see \`@byline/search-postgres\` → ` +
      `\`postgresSearch()\` for the built-in Postgres full-text driver.`
  )
}
