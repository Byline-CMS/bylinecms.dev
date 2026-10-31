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
import type { MySql2Database } from 'drizzle-orm/mysql2'
import type { ResultSetHeader } from 'mysql2'

import type * as schema from '../../database/schema/index.js'
import type { DBManager } from '../../lib/db-manager.js'

type DatabaseConnection = MySql2Database<typeof schema>

// Stored-file identity maintenance (backfill / verify). Storage keys,
// provider names and recorded digests must compare exactly. The database
// default collation (utf8mb4_0900_ai_ci) folds case and accents, and even
// utf8mb4_bin is PAD SPACE (it equates 'a.pdf' and 'a.pdf '). utf8mb4_0900_bin
// is NO PAD but needs MySQL 8.0.17, above the adapter's 8.0.14 floor. So every
// comparison, DISTINCT, ORDER BY, join and GROUP BY here goes through
// CAST(... AS BINARY): byte equality, trailing spaces significant, byte order.

const binary = (expression: SQL): SQL => sql`CAST(${expression} AS BINARY)`

function scopeFilter(
  params: {
    storageProvider: string
    collectionId?: string
    identity: 'missing' | 'present'
  },
  alias = ''
): SQL {
  const column = (name: string) => sql.raw(`${alias}${name}`)
  const parts: SQL[] = [
    sql`${binary(column('storage_provider'))} = ${binary(sql`${params.storageProvider}`)}`,
    params.identity === 'missing'
      ? sql`${column('file_hash')} IS NULL`
      : sql`${column('file_hash')} IS NOT NULL`,
  ]
  if (params.collectionId !== undefined) {
    parts.push(sql`${column('collection_id')} = ${params.collectionId}`)
  }
  return sql.join(parts, sql` AND `)
}

function rowsOf<T>(result: unknown): T[] {
  return (result as unknown as [T[], unknown])[0]
}

/** mysql2 returns binary-cast columns as Buffers; decode them back to text. */
function text(value: string | Buffer): string {
  return Buffer.isBuffer(value) ? value.toString('utf8') : value
}

export class StoredFileQueries implements IStoredFileQueries {
  constructor(private dbManager: DBManager) {}

  private get db(): DatabaseConnection {
    return this.dbManager.get()
  }

  async listStoredFilePaths(params: ListStoredFilePathsParams): Promise<StoredFilePathGroup[]> {
    const after =
      params.afterPath === undefined
        ? sql``
        : sql` AND ${binary(sql`storage_path`)} > ${binary(sql`${params.afterPath}`)}`

    // A page is a bounded set of distinct paths; `limit` never counts rows.
    const pathsQuery = sql`
      SELECT DISTINCT ${binary(sql`storage_path`)} AS path_key
      FROM byline_store_file
      WHERE ${scopeFilter(params)}${after}
      ORDER BY path_key
      LIMIT ${params.limit}
    `

    if (params.identity === 'missing') {
      const result = await this.db.execute(pathsQuery)
      return rowsOf<{ path_key: string | Buffer }>(result).map((row) => ({
        storagePath: text(row.path_key),
        hashes: [],
      }))
    }

    // Every recorded-hash group for each selected path, so a path's groups are
    // never split across pages. Digests group by bytes, so differently spelled
    // legacy values are reported separately.
    const result = await this.db.execute(sql`
      WITH paths AS (${pathsQuery})
      SELECT p.path_key, ${binary(sql`f.file_hash`)} AS hash_key, COUNT(*) AS row_count
      FROM byline_store_file f
      JOIN paths p ON ${binary(sql`f.storage_path`)} = p.path_key
      WHERE ${scopeFilter(params, 'f.')}
      GROUP BY p.path_key, hash_key
      ORDER BY p.path_key, hash_key
    `)

    const groups: StoredFilePathGroup[] = []
    for (const row of rowsOf<{
      path_key: string | Buffer
      hash_key: string | Buffer
      row_count: number | string
    }>(result)) {
      const storagePath = text(row.path_key)
      let group = groups.at(-1)
      if (!group || group.storagePath !== storagePath) {
        group = { storagePath, hashes: [] }
        groups.push(group)
      }
      group.hashes.push({ fileHash: text(row.hash_key), rowCount: Number(row.row_count) })
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
      params.collectionId === undefined ? sql`` : sql` AND collection_id = ${params.collectionId}`
    const result = await this.db.execute(sql`
      UPDATE byline_store_file
      SET file_hash = ${params.fileHash},
          storage_validator_kind = ${params.storageValidator.kind},
          storage_validator_value = ${params.storageValidator.value},
          updated_at = NOW()
      WHERE ${binary(sql`storage_provider`)} = ${binary(sql`${params.storageProvider}`)}
        AND ${binary(sql`storage_path`)} = ${binary(sql`${params.storagePath}`)}
        AND file_hash IS NULL${collection}
    `)
    return (result as unknown as [ResultSetHeader, unknown])[0].affectedRows
  }
}
