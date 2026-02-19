/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
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
import { booleanSchema } from '@infonomic/schemas'
import * as z from 'zod'

export const collectionListSchema = z.object({
  page: z.coerce.number().min(1).optional(),
  page_size: z.coerce.number().min(1).max(100).optional(),
  order: z.string().optional(),
  desc: booleanSchema(true),
  query: z.string().optional(),
  locale: z.string().optional(),
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
 * Normalise known date-like fields to Date instances before persisting.
 */
export function normaliseDateFields(data: Record<string, any>): void {
  if (typeof data.created_at === 'string') data.created_at = new Date(data.created_at)
  if (typeof data.updated_at === 'string') data.updated_at = new Date(data.updated_at)
  if (typeof data.publishedOn === 'string') data.publishedOn = new Date(data.publishedOn)
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
