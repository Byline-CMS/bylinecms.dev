/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Audit-log reads (docs/06-auth-and-security/02-auditability.md — Workstreams 3 & 4). Reads run on the pool
 * directly — they never need to join an audit write's transaction — so this
 * takes the raw `db` (drizzle over the pool) rather than the `DBManager`.
 * Access scoping is the caller's responsibility (the document's own read
 * gate); these queries do no scoping of their own. Mirrors
 * `packages/db-postgres/src/modules/audit/audit-queries.ts` with the CAST /
 * string-concat / result-shape adjustments the mysql2 driver requires — see
 * inline comments at each divergence.
 */

import type { AuditLogEntry, AuditLogPage, IAuditQueries } from '@byline/core'
import { desc, eq, type SQL, sql } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'

import { auditLog, documentVersions } from '../../database/schema/index.js'
import type * as schema from '../../database/schema/index.js'

type DatabaseConnection = MySql2Database<typeof schema>
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
 * One activity row off the UNION — same columns as `byline_audit_log`. The
 * mysql2 driver parses JSON columns already (confirmed live, matching
 * `normalize-row.ts`'s finding for the storage UNION ALL — an inserted JS
 * object round-trips as an object, not a JSON string), but `occurred_at`
 * comes back as a MySQL datetime **string**, not a `Date` — see
 * `toDate()`'s docstring for why, confirmed live against this exact query
 * shape (a divergence from `normalize-row.ts`'s DATETIME(3)→Date finding,
 * which was confirmed against a schema-typed `.select()`, not a bare
 * `db.execute(sql\`...\`)` call like this one).
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
  occurred_at: string
}

/**
 * Coerce a raw mysql2 `db.execute(sql\`...\`)` `DATETIME(3)` value to a real
 * `Date`. Confirmed live: drizzle-orm's mysql2 driver installs its own
 * `typeCast` on every `execute()`/`query()` call that is not backed by a
 * schema-typed `fields` mapper (`node_modules/drizzle-orm/mysql2/session.js`
 * — `MySql2PreparedQuery`'s `rawQuery.typeCast` unconditionally calls
 * `field.string()` for `TIMESTAMP`/`DATETIME`/`DATE` columns), overriding
 * whatever the underlying mysql2 pool's own `timezone`/date-parsing options
 * would otherwise do. `this.db.execute(sql\`...\`)` — the pattern this class
 * and `storage-queries.ts`'s raw UNION ALL reads both use — always takes
 * that no-`fields` path, so every hand-written SQL read through `db.execute`
 * gets datetime columns back as `'YYYY-MM-DD HH:MM:SS.mmm'` strings, never
 * `Date` objects, regardless of pool configuration. The string carries no
 * timezone marker, but every `DATETIME(3)` column in this schema is UTC by
 * convention (the pool's `timezone: 'Z'` option — see `src/index.ts` —
 * documents that discipline even though it does not apply here), so
 * appending `Z` after normalising the separator is the correct — not an
 * assumed — interpretation.
 */
function toDate(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`)
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

    // `count(*)::int` (pg) → `CAST(COUNT(*) AS SIGNED)` (design spec §2).
    const totalResult = await this.db
      .select({ count: sql<number>`CAST(COUNT(*) AS SIGNED)` })
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
    //
    // MySQL divergences from the pg source (design spec §2, confirmed live):
    //   - `NULL::varchar` / `NULL::jsonb` casts → `CAST(NULL AS CHAR(128))` /
    //     `CAST(NULL AS JSON)`. An untyped bare `NULL` in one UNION leg while
    //     the sibling leg has a real typed column is fine for MySQL's type
    //     resolution, but an explicit CAST keeps the two legs' declared types
    //     symmetric and self-documenting, matching the pg source's intent.
    //   - `'document.' || event_type` → `CONCAT('document.', event_type)` —
    //     MySQL's `||` is logical OR by default (PIPES_AS_CONCAT is not a
    //     baseline assumption for this adapter), so string concatenation must
    //     use `CONCAT`.
    //   - `before` backtick-quoted throughout — confirmed live:
    //     `BEFORE` is a reserved word in MySQL (trigger syntax, `CREATE
    //     TRIGGER ... BEFORE INSERT`), so an unquoted `before` column alias
    //     or bare column reference is a syntax error (`ER_PARSE_ERROR`) both
    //     as an `AS before` alias declaration and as a bare `SELECT ...,
    //     before, ...` reference in the outer wrapper. `after` is NOT
    //     reserved (confirmed live) but is backtick-quoted alongside it for
    //     symmetry.
    const union = sql`
      SELECT id, document_id, collection_id, actor_id, actor_realm, action, field, \`before\`, \`after\`, occurred_at FROM (
        SELECT
          ${documentVersions.id} AS id,
          ${documentVersions.document_id} AS document_id,
          ${documentVersions.collection_id} AS collection_id,
          ${documentVersions.created_by} AS actor_id,
          CASE WHEN ${documentVersions.created_by} IS NULL THEN 'system' ELSE 'admin' END AS actor_realm,
          CASE ${documentVersions.event_type}
            WHEN 'create' THEN 'document.created'
            WHEN 'update' THEN 'document.updated'
            ELSE CONCAT('document.', ${documentVersions.event_type})
          END AS action,
          CAST(NULL AS CHAR(128)) AS field,
          CAST(NULL AS JSON) AS \`before\`,
          CAST(NULL AS JSON) AS \`after\`,
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
          ${auditLog.before} AS \`before\`,
          ${auditLog.after} AS \`after\`,
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

    // `db.execute()` on the mysql2 driver returns a `[rows, fields]` tuple
    // (unlike pg's `{ rows }` result object) — see `storage-queries.ts` for
    // the established pattern this mirrors.
    const totalResult = (await this.db.execute(
      sql`SELECT CAST(COUNT(*) AS SIGNED) AS count FROM (${union}${whereClause}) AS filtered`
    )) as unknown as [Array<{ count: number }>, unknown]
    const total = Number(totalResult[0][0]?.count) || 0
    const totalPages = Math.ceil(total / pageSize)

    const result = (await this.db.execute(
      sql`${union}${whereClause} ORDER BY occurred_at DESC, id DESC LIMIT ${pageSize} OFFSET ${offset}`
    )) as unknown as [ActivityRow[], unknown]

    return {
      entries: result[0].map((row) => toEntryFromActivityRow(row)),
      meta: { total, page, pageSize, totalPages },
    }
  }
}

/** Like `toEntry`, but for a raw `ActivityRow` off the UNION — see `toDate`. */
function toEntryFromActivityRow(row: ActivityRow): AuditLogEntry {
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
    occurredAt: toDate(row.occurred_at),
  }
}

export function createAuditQueries(db: DatabaseConnection): AuditQueries {
  return new AuditQueries(db)
}
