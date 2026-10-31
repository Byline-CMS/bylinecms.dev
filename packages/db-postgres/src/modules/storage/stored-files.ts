/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  IStoredFileCommands,
  IStoredFileQueries,
  ListStoredFilePathsParams,
  StorageValidator,
  StoredFilePathGroup,
} from '@byline/core'
import { type SQL, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import type * as schema from '../../database/schema/index.js'
import type { DBManager } from '../../lib/db-manager.js'

type DatabaseConnection = NodePgDatabase<typeof schema>

// Stored-file identity maintenance (backfill / verify). Paths compare and
// order with COLLATE "C" — byte order — so the keyset cursor and DISTINCT
// never depend on the database's locale collation.

function scopeFilter(params: {
  storageProvider: string
  collectionId?: string
  identity: 'missing' | 'present'
}): SQL {
  const parts: SQL[] = [
    sql`storage_provider = ${params.storageProvider}`,
    params.identity === 'missing' ? sql`file_hash IS NULL` : sql`file_hash IS NOT NULL`,
  ]
  if (params.collectionId !== undefined) {
    parts.push(sql`collection_id = ${params.collectionId}::uuid`)
  }
  return sql.join(parts, sql` AND `)
}

export class StoredFileQueries implements IStoredFileQueries {
  constructor(private dbManager: DBManager) {}

  private get db(): DatabaseConnection {
    return this.dbManager.get()
  }

  async listStoredFilePaths(params: ListStoredFilePathsParams): Promise<StoredFilePathGroup[]> {
    const filter = scopeFilter(params)
    const after =
      params.afterPath === undefined
        ? sql``
        : sql` AND storage_path COLLATE "C" > ${params.afterPath} COLLATE "C"`

    // A page is a bounded set of distinct paths; `limit` never counts rows.
    const pathsCte = sql`
      SELECT DISTINCT storage_path COLLATE "C" AS storage_path
      FROM byline_store_file
      WHERE ${filter}${after}
      ORDER BY 1
      LIMIT ${params.limit}
    `

    if (params.identity === 'missing') {
      const result = await this.db.execute(pathsCte)
      return (result.rows as Array<{ storage_path: string }>).map((row) => ({
        storagePath: row.storage_path,
        hashes: [],
      }))
    }

    // Every recorded-hash group for each selected path, so a path's groups are
    // never split across pages.
    const result = await this.db.execute(sql`
      WITH paths AS (${pathsCte})
      SELECT f.storage_path COLLATE "C" AS storage_path, f.file_hash, count(*)::int AS row_count
      FROM byline_store_file f
      JOIN paths p ON f.storage_path COLLATE "C" = p.storage_path
      WHERE ${scopeFilter(params)}
      GROUP BY 1, f.file_hash
      ORDER BY 1, f.file_hash
    `)

    const groups: StoredFilePathGroup[] = []
    for (const row of result.rows as Array<{
      storage_path: string
      file_hash: string
      row_count: number
    }>) {
      let group = groups.at(-1)
      if (!group || group.storagePath !== row.storage_path) {
        group = { storagePath: row.storage_path, hashes: [] }
        groups.push(group)
      }
      group.hashes.push({ fileHash: row.file_hash, rowCount: Number(row.row_count) })
    }
    return groups
  }
}

export class StoredFileCommands implements IStoredFileCommands {
  constructor(private dbManager: DBManager) {}

  private get db(): DatabaseConnection {
    return this.dbManager.get()
  }

  async setIdentityForPath(params: {
    storageProvider: string
    storagePath: string
    collectionId?: string
    fileHash: string
    storageValidator: StorageValidator
  }): Promise<number> {
    const collection =
      params.collectionId === undefined
        ? sql``
        : sql` AND collection_id = ${params.collectionId}::uuid`
    const result = await this.db.execute(sql`
      UPDATE byline_store_file
      SET file_hash = ${params.fileHash},
          storage_validator_kind = ${params.storageValidator.kind},
          storage_validator_value = ${params.storageValidator.value},
          updated_at = NOW()
      WHERE storage_provider = ${params.storageProvider}
        AND storage_path COLLATE "C" = ${params.storagePath} COLLATE "C"
        AND file_hash IS NULL${collection}
    `)
    return result.rowCount ?? 0
  }
}
