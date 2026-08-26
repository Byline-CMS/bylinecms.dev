/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  ERR_DATABASE,
  ERR_NOT_FOUND,
  type ISingletonCommands,
  type ISingletonQueries,
} from '@byline/core'
import { eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { singletonDocuments } from '../../database/schema/index.js'
import type * as schema from '../../database/schema/index.js'
import type { DBManager } from '../../lib/db-manager.js'

type DatabaseConnection = NodePgDatabase<typeof schema>

export class SingletonCommands implements ISingletonCommands {
  constructor(private dbManager: DBManager) {}

  /**
   * Resolve the executor per access so an enclosing `withTransaction`
   * boundary is honoured through the adapter's ambient transaction manager.
   */
  private get db(): DatabaseConnection {
    return this.dbManager.get()
  }

  async lockSlot(collectionId: string): Promise<void> {
    if (!this.dbManager.isInTransaction()) {
      throw ERR_DATABASE({
        message: 'singleton slot locks require an active transaction',
        details: { collectionId },
      })
    }

    const locked = await this.db.execute(sql`
      SELECT id FROM byline_collections
      WHERE id = ${collectionId}::uuid
      FOR UPDATE
    `)
    if (locked.rows.length === 0) {
      throw ERR_NOT_FOUND({
        message: 'singleton slot registration not found',
        details: { collectionId },
      })
    }
  }

  async setMapping(collectionId: string, documentId: string): Promise<void> {
    await this.db
      .insert(singletonDocuments)
      .values({ collection_id: collectionId, document_id: documentId })
  }

  async clearMapping(collectionId: string): Promise<void> {
    await this.db
      .delete(singletonDocuments)
      .where(eq(singletonDocuments.collection_id, collectionId))
  }
}

export class SingletonQueries implements ISingletonQueries {
  constructor(private dbManager: DBManager) {}

  private get db(): DatabaseConnection {
    return this.dbManager.get()
  }

  async getMappedDocumentId(collectionId: string): Promise<string | null> {
    const rows = await this.db
      .select({ documentId: singletonDocuments.document_id })
      .from(singletonDocuments)
      .where(eq(singletonDocuments.collection_id, collectionId))
      .limit(1)
    return rows[0]?.documentId ?? null
  }
}
