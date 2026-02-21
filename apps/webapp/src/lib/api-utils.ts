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
import { normaliseDateFields } from '@byline/core/services'
import { booleanSchema } from '@infonomic/schemas'
import * as z from 'zod'

export { normaliseDateFields }

export const collectionListSchema = z.object({
  page: z.coerce.number().min(1).optional(),
  page_size: z.coerce.number().min(1).max(100).optional(),
  order: z.string().optional(),
  desc: booleanSchema(true),
  query: z.string().optional(),
  locale: z.string().optional(),
  status: z.string().optional(),
})

export const historySchema = z.object({
  document_id: z.string(),
  page: z.coerce.number().min(1).optional(),
  page_size: z.coerce.number().min(1).max(100).optional(),
  order: z.string().optional(),
  desc: booleanSchema(true),
  locale: z.string().optional(),
})

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

/**
 * Parse URL search params into a plain object.
 */
export function searchParamsToObject(url: URL): Record<string, string> {
  const obj: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    obj[key] = value
  })
  return obj
}
