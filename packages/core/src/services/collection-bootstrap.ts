/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { fingerprintCollection } from '../storage/collection-fingerprint.js'
import type { CollectionDefinition, IDbAdapter } from '../@types/index.js'
import type { BylineLogger } from '../lib/logger.js'

/**
 * Snapshot of a collection's current registration: the DB row id, the
 * schema version stamped on new `documentVersions` rows, and the fingerprint
 * that was recorded the last time the bootstrap ran. Cached on the core
 * instance for the lifetime of the process.
 */
export interface CollectionRecord {
  collectionId: string
  version: number
  schemaHash: string
}

export interface EnsureCollectionsInput {
  definitions: CollectionDefinition[]
  db: IDbAdapter
  logger?: BylineLogger
}

/**
 * Reconcile every registered `CollectionDefinition` with its row in the
 * `collections` table. Runs once at startup from `initBylineCore()`.
 *
 * Behaviour per collection:
 *   1. Compute the data-shape fingerprint.
 *   2. If no row exists: insert with `version = definition.version ?? 1`
 *      and the fingerprint.
 *   3. If a row exists and the fingerprint matches: no-op.
 *   4. If a row exists and the fingerprint differs:
 *        - `definition.version` pinned explicitly and `> stored.version` → use it
 *        - `definition.version` pinned explicitly and `<= stored.version` → throw
 *        - otherwise → auto-bump to `stored.version + 1`
 *      Then write back `{ config, version, schema_hash, updated_at }`.
 *
 * Returns a `Map<path, CollectionRecord>` to be cached on the core instance
 * so downstream callers (lifecycle, upload, client handle) can resolve
 * `(collectionId, collectionVersion)` without another DB round-trip.
 */
export async function ensureCollections({
  definitions,
  db,
  logger,
}: EnsureCollectionsInput): Promise<Map<string, CollectionRecord>> {
  // Each collection reconciles independently (separate rows, independent
  // SELECT/UPDATE paths), so we fan out with Promise.all. At 20+ collections
  // or higher DB latency this turns linear round-trips into one concurrent
  // batch.
  const reconciled = await Promise.all(
    definitions.map((definition) => reconcileCollection(definition, db, logger))
  )

  const records = new Map<string, CollectionRecord>()
  for (const entry of reconciled) {
    records.set(entry.path, entry.record)
  }
  return records
}

async function reconcileCollection(
  definition: CollectionDefinition,
  db: IDbAdapter,
  logger: BylineLogger | undefined
): Promise<{ path: string; record: CollectionRecord }> {
  const fingerprint = await fingerprintCollection(definition)
  const existing = await db.queries.collections.getCollectionByPath(definition.path)

  if (existing == null) {
    const initialVersion = definition.version ?? 1
    const inserted = await db.commands.collections.create(definition.path, definition, {
      version: initialVersion,
      schemaHash: fingerprint,
    })
    const row = Array.isArray(inserted) ? inserted[0] : inserted
    const collectionId = row?.id as string | undefined
    if (!collectionId) {
      throw new Error(
        `ensureCollections: insert for '${definition.path}' did not return a row id`
      )
    }
    logger?.info(
      { collectionPath: definition.path, version: initialVersion },
      'collection registered'
    )
    return {
      path: definition.path,
      record: { collectionId, version: initialVersion, schemaHash: fingerprint },
    }
  }

  const collectionId = existing.id as string
  const storedVersion = ((existing.version as number | undefined) ?? 1) | 0
  const storedHash = (existing.schema_hash as string | null | undefined) ?? null

  // Unchanged — stored hash matches. We trust the hash and skip the write
  // even if `definition.version` was pinned to something higher; the hash
  // is the source of truth for "did the shape change?".
  if (storedHash === fingerprint) {
    return {
      path: definition.path,
      record: { collectionId, version: storedVersion, schemaHash: fingerprint },
    }
  }

  // Hash differs (or was never recorded) — decide the next version.
  let nextVersion: number
  if (definition.version !== undefined) {
    if (definition.version < storedVersion) {
      throw new Error(
        `ensureCollections: collection '${definition.path}' pins version ` +
          `${definition.version} but the database already records version ${storedVersion}. ` +
          `Pinning backwards is not allowed.`
      )
    }
    nextVersion = definition.version
  } else {
    // First-run after Phase-1 migration: schema_hash was NULL, so this
    // looks like a change. Don't bump — just backfill the hash at the
    // same version the DB already holds.
    nextVersion = storedHash === null ? storedVersion : storedVersion + 1
  }

  await db.commands.collections.update(collectionId, {
    config: definition,
    version: nextVersion,
    schemaHash: fingerprint,
  })

  if (nextVersion !== storedVersion) {
    logger?.info(
      {
        collectionPath: definition.path,
        previousVersion: storedVersion,
        version: nextVersion,
      },
      'collection schema version bumped'
    )
  } else {
    logger?.debug(
      { collectionPath: definition.path, version: storedVersion },
      'collection schema hash backfilled'
    )
  }

  return {
    path: definition.path,
    record: { collectionId, version: nextVersion, schemaHash: fingerprint },
  }
}
