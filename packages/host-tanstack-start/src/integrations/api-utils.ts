/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * NOTE: Before you dunk on this, this is a prototype implementation
 * of our API and used only for development.
 * We'll extract a properly configured API server soon.
 */

// NOTE: The host's server config (e.g. byline/server.config.ts) is loaded by
// src/server.ts (TanStack Start server entry point) before any
// requests are handled. No need to import it here.

import type { CollectionDefinition, CollectionRecord } from '@byline/core'
import { getCollectionDefinition } from '@byline/core'

import { bylineCore } from './byline-core.js'

export interface EnsuredCollection {
  definition: CollectionDefinition
  collection: {
    id: string
    path: string
    version: number
    schemaHash: string
  }
}

/**
 * Resolve a collection for an admin API request.
 *
 * Collections are reconciled with the database once at startup by
 * `initBylineCore()` (see `packages/core/src/services/collection-bootstrap.ts`).
 * This helper is a per-request cache lookup against the resulting in-memory
 * registry — no DB I/O, no hash work.
 *
 * Returns `null` when the path is not registered in the client/server config.
 */
export async function ensureCollection(path: string): Promise<EnsuredCollection | null> {
  const definition = getCollectionDefinition(path)
  if (definition == null) {
    return null
  }

  let record: CollectionRecord
  try {
    record = bylineCore().getCollectionRecord(path)
  } catch {
    return null
  }

  return {
    definition,
    collection: {
      id: record.collectionId,
      path,
      version: record.version,
      schemaHash: record.schemaHash,
    },
  }
}
