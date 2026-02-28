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

// NOTE: Server config (byline.server.config.ts) is loaded by
// src/server.ts (TanStack Start server entry point) before any
// requests are handled. No need to import it here.

import type { CollectionDefinition } from '@byline/core'
import { getCollectionDefinition, getServerConfig } from '@byline/core'

/**
 * ensureCollection
 *
 * Ensures that a collection exists in the database.
 * If it doesn't exist, creates it based on the collection definition from the registry.
 *
 * @param {string} path - The path of the collection to ensure.
 * @returns The existing or newly created collection, or null if not found in registry.
 */
export async function ensureCollection(
  path: string
): Promise<{ definition: CollectionDefinition; collection: any } | null> {
  const collectionDefinition = getCollectionDefinition(path)
  if (collectionDefinition == null) {
    return null
  }

  const db = getServerConfig().db

  let collection = await db.queries.collections.getCollectionByPath(collectionDefinition.path)
  if (collection == null) {
    // Collection doesn't exist in database yet, create it
    await db.commands.collections.create(collectionDefinition.path, collectionDefinition)
    collection = await db.queries.collections.getCollectionByPath(collectionDefinition.path)
  }

  return { definition: collectionDefinition, collection }
}
