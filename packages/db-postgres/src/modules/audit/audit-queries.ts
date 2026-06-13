/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Audit-log reads (docs/AUDIT.md — Workstreams 3 & 4). Reads run on the pool
 * directly — they never need to join an audit write's transaction — so this
 * takes the raw connection rather than the `DBManager`. Access scoping is the
 * caller's responsibility (the document's own read gate); these queries do no
 * scoping of their own.
 */

import type { AuditLogEntry, AuditLogPage, IAuditQueries } from '@byline/core'
import { desc, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { auditLog } from '../../database/schema/index.js'
import type * as schema from '../../database/schema/index.js'

type DatabaseConnection = NodePgDatabase<typeof schema>
type AuditRow = typeof auditLog.$inferSelect

function toEntry(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    documentId: row.document_id,
    collectionId: row.collection_id,
    actorId: row.actor_id,
    actorRealm: row.actor_realm,
    action: row.action,
    field: row.field,
    before: row.before,
    after: row.after,
    occurredAt: row.occurred_at,
  }
}

export class AuditQueries implements IAuditQueries {
  constructor(private db: DatabaseConnection) {}

  async getDocumentAuditLog(params: {
    document_id: string
    page?: number
    page_size?: number
  }): Promise<AuditLogPage> {
    const page = params.page ?? 1
    const pageSize = params.page_size ?? 20
    const offset = (page - 1) * pageSize

    const totalResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(auditLog)
      .where(eq(auditLog.document_id, params.document_id))
    const total = Number(totalResult[0]?.count) || 0
    const totalPages = Math.ceil(total / pageSize)

    const rows = await this.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.document_id, params.document_id))
      // id is UUIDv7 — DESC is newest-first without a separate sort column.
      .orderBy(desc(auditLog.id))
      .limit(pageSize)
      .offset(offset)

    return {
      entries: rows.map(toEntry),
      meta: { total, page, pageSize, totalPages },
    }
  }
}

export function createAuditQueries(db: DatabaseConnection): AuditQueries {
  return new AuditQueries(db)
}
