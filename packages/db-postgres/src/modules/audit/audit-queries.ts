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
import { desc, eq, type SQL, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { auditLog, documentVersions } from '../../database/schema/index.js'
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

/**
 * One activity row off the UNION — same columns as `byline_audit_log`, but
 * `before` / `after` come back as already-parsed JSON from the pg driver and
 * `occurred_at` as a `Date`, so the shape matches `AuditRow` for `toEntry`.
 */
type ActivityRow = {
  id: string
  document_id: string | null
  collection_id: string | null
  actor_id: string | null
  actor_realm: string
  action: string
  field: string | null
  before: unknown
  after: unknown
  occurred_at: Date
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

  async findAuditLog(params: {
    actorId?: string
    collectionId?: string
    action?: string
    from?: Date
    to?: Date
    page?: number
    page_size?: number
  }): Promise<AuditLogPage> {
    const page = params.page ?? 1
    const pageSize = params.page_size ?? 20
    const offset = (page - 1) * pageSize

    // The activity feed is the UNION of two disjoint event sources, normalised
    // onto the audit-log column shape (see IAuditQueries.findAuditLog):
    //
    //   1. byline_document_versions — content saves. event_type maps to a
    //      `document.created` / `document.updated` action; created_by/created_at
    //      become actor_id/occurred_at; field/before/after are null. Restricted
    //      to create+update so any legacy 'delete' version rows can't surface
    //      (deletions live only in the audit log — the union double-counts
    //      nothing).
    //   2. byline_audit_log — path/locale/status changes, deletions, and
    //      future admin-realm events, used as-is.
    //
    // Filters and ordering apply to the unioned result; occurred_at is the only
    // cross-source sort key (the per-source UUIDv7 ids are separate sequences).
    const union = sql`
      SELECT id, document_id, collection_id, actor_id, actor_realm, action, field, before, after, occurred_at FROM (
        SELECT
          ${documentVersions.id} AS id,
          ${documentVersions.document_id} AS document_id,
          ${documentVersions.collection_id} AS collection_id,
          ${documentVersions.created_by} AS actor_id,
          CASE WHEN ${documentVersions.created_by} IS NULL THEN 'system' ELSE 'admin' END AS actor_realm,
          CASE ${documentVersions.event_type}
            WHEN 'create' THEN 'document.created'
            WHEN 'update' THEN 'document.updated'
            ELSE 'document.' || ${documentVersions.event_type}
          END AS action,
          NULL::varchar AS field,
          NULL::jsonb AS before,
          NULL::jsonb AS after,
          ${documentVersions.created_at} AS occurred_at
        FROM ${documentVersions}
        WHERE ${documentVersions.event_type} IN ('create', 'update')
        UNION ALL
        SELECT
          ${auditLog.id} AS id,
          ${auditLog.document_id} AS document_id,
          ${auditLog.collection_id} AS collection_id,
          ${auditLog.actor_id} AS actor_id,
          ${auditLog.actor_realm} AS actor_realm,
          ${auditLog.action} AS action,
          ${auditLog.field} AS field,
          ${auditLog.before} AS before,
          ${auditLog.after} AS after,
          ${auditLog.occurred_at} AS occurred_at
        FROM ${auditLog}
      ) AS activity`

    const filters: SQL[] = []
    if (params.actorId) filters.push(sql`actor_id = ${params.actorId}`)
    if (params.collectionId) filters.push(sql`collection_id = ${params.collectionId}`)
    if (params.action) filters.push(sql`action = ${params.action}`)
    if (params.from) filters.push(sql`occurred_at >= ${params.from}`)
    if (params.to) filters.push(sql`occurred_at <= ${params.to}`)
    const whereClause = filters.length > 0 ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``

    const totalResult = await this.db.execute<{ count: number }>(
      sql`SELECT count(*) AS count FROM (${union}${whereClause}) AS filtered`
    )
    const total = Number(totalResult.rows[0]?.count) || 0
    const totalPages = Math.ceil(total / pageSize)

    const result = await this.db.execute<ActivityRow>(
      sql`${union}${whereClause} ORDER BY occurred_at DESC, id DESC LIMIT ${pageSize} OFFSET ${offset}`
    )

    return {
      entries: result.rows.map((row) => toEntry(row as AuditRow)),
      meta: { total, page, pageSize, totalPages },
    }
  }
}

export function createAuditQueries(db: DatabaseConnection): AuditQueries {
  return new AuditQueries(db)
}
