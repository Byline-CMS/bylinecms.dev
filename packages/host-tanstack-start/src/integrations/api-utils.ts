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

import type {
  CollectionDefinition,
  CollectionRecord,
  MultiCollectionDefinition,
} from '@byline/core'
import { getCollectionDefinition, isSingleton } from '@byline/core'

import { bylineCore } from './byline-core.js'

export interface EnsuredDocumentResource {
  definition: CollectionDefinition
  collection: {
    id: string
    path: string
    version: number
    schemaHash: string
  }
}

export interface EnsuredCollection extends EnsuredDocumentResource {
  definition: MultiCollectionDefinition
}

/**
 * Resolve either registered document-resource kind against the reconciled
 * collection record.
 *
 * Collections are reconciled with the database once at startup by
 * `initBylineCore()` (see `packages/core/src/services/collection-bootstrap.ts`).
 * This helper is a per-request cache lookup against the resulting in-memory
 * registry — no DB I/O, no hash work.
 *
 * This broader seam is reserved for operations such as field upload whose core
 * service is explicitly kind-aware; collection route families continue to use
 * `ensureCollection` below.
 */
export async function ensureDocumentResource(
  path: string
): Promise<EnsuredDocumentResource | null> {
  const definition = getCollectionDefinition(path)
  if (definition == null) return null

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

/**
 * Narrow the shared document-resource resolution to a multi-document
 * collection for a collection-scoped admin API request.
 *
 * Returns `null` when the path is unregistered or belongs to a singleton, so
 * collection route families cannot accidentally admit the other resource kind.
 */
export async function ensureCollection(path: string): Promise<EnsuredCollection | null> {
  const resource = await ensureDocumentResource(path)
  return resource != null && !isSingleton(resource.definition)
    ? { ...resource, definition: resource.definition }
    : null
}
