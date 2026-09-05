/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ISingletonCommands, ISingletonQueries } from '@byline/core'
import { eq } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'

import { singletonDocuments } from '../../database/schema/index.js'
import { lockCollectionRegistration } from './collection-registration.js'
import type * as schema from '../../database/schema/index.js'
import type { DBManager } from '../../lib/db-manager.js'

type DatabaseConnection = MySql2Database<typeof schema>

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
    await lockCollectionRegistration(this.dbManager, collectionId, 'exclusive')
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
