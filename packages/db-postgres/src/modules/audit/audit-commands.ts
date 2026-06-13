/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Append-only audit-log writes (docs/AUDIT.md — Workstream 2). A deliberately
 * dumb command: it inserts one row and knows nothing about *which* changes
 * warrant an audit entry — that policy lives in the lifecycle services, which
 * wrap the mutation + this append in `withTransaction` so they commit
 * atomically. Runs on the `DBManager` executor, so an `append` issued inside a
 * `withTransaction` boundary joins the ambient transaction.
 */

import type { AuditLogAppendInput, IAuditCommands } from '@byline/core'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { v7 as uuidv7 } from 'uuid'

import { auditLog } from '../../database/schema/index.js'
import type * as schema from '../../database/schema/index.js'
import type { DBManager } from '../../lib/db-manager.js'

type DatabaseConnection = NodePgDatabase<typeof schema>

export class AuditCommands implements IAuditCommands {
  constructor(private dbManager: DBManager) {}

  /** Ambient transaction when a `withTransaction` boundary is open, else the pool. */
  private get db(): DatabaseConnection {
    return this.dbManager.get()
  }

  async append(input: AuditLogAppendInput): Promise<{ id: string }> {
    const id = uuidv7() // time-ordered, so id ordering ≈ occurred_at ordering
    await this.db.insert(auditLog).values({
      id,
      document_id: input.documentId ?? null,
      collection_id: input.collectionId ?? null,
      actor_id: input.actorId ?? null,
      actor_realm: input.actorRealm,
      action: input.action,
      field: input.field ?? null,
      // `?? null` only coerces undefined → SQL NULL; a real `false`/`0`/`''`
      // before/after value is preserved.
      before: input.before ?? null,
      after: input.after ?? null,
      // occurred_at defaults to now() at the DB.
    })
    return { id }
  }
}

export function createAuditCommands(dbManager: DBManager): AuditCommands {
  return new AuditCommands(dbManager)
}
