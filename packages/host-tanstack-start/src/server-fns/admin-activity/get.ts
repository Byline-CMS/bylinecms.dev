/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { assertAdminActor } from '@byline/admin'
import { ADMIN_ACTIVITY_ABILITIES } from '@byline/admin/admin-activity'
import { ERR_AUDIT_UNSUPPORTED, getLogger, getServerConfig } from '@byline/core'

import { getAdminRequestContext } from '../../auth/auth-context.js'
import { type ActorLabelMap, resolveActorLabels } from '../collections/actors.js'
import type { AuditLogEntryDto } from '../collections/audit.js'

// ---------------------------------------------------------------------------
// System-wide activity report (docs/06-auth-and-security/02-auditability.md — Workstream 4)
// ---------------------------------------------------------------------------

/** Filters for the activity feed. `from` / `to` are ISO strings over the wire. */
export interface SystemActivitySearchParams {
  actorId?: string
  /** Collection **path** (the admin works in paths; the handler resolves it to the stored collection id). */
  collection?: string
  action?: string
  from?: string
  to?: string
  page?: number
  page_size?: number
}

/** Collection display info, captured at query time (a row may name a collection that was later renamed/removed). */
export interface ActivityCollectionInfo {
  path: string
  singular: string
  plural: string
}
export type ActivityCollectionMap = Record<string, ActivityCollectionInfo>

export interface SystemActivityResponse {
  entries: AuditLogEntryDto[]
  meta: { total: number; page: number; pageSize: number; totalPages: number }
  /** Acting-user id → display label. Absent ids (system rows, deleted users) render a tombstone. */
  actors: ActorLabelMap
  /** Collection id → display info. Absent ids name a removed collection. */
  collections: ActivityCollectionMap
}

/**
 * The system-wide activity feed: the union of the version stream (content
 * saves) and the audit log (status / path / locale changes, deletions, and
 * future admin-realm events). Unlike the per-document audit fn, this is NOT
 * routed through `CollectionHandle` — it is cross-collection and includes
 * admin-realm rows with no `document_id`, so it reads the adapter's audit
 * queries directly and is gated system-wide by `admin.activity.read` rather
 * than by any document's own read gate.
 */
export const getSystemActivityLog = createServerFn({ method: 'GET' })
  .validator((input: SystemActivitySearchParams) => input ?? {})
  .handler(async ({ data }): Promise<SystemActivityResponse> => {
    const context = await getAdminRequestContext()
    // System-wide gate — independent of any collection ability. An auditor
    // role holds this without holding content read/write.
    assertAdminActor(context, ADMIN_ACTIVITY_ABILITIES.read)

    const queries = getServerConfig().db.queries
    if (queries.audit == null) {
      throw ERR_AUDIT_UNSUPPORTED({
        message: 'the configured db adapter does not support audit-log reads (queries.audit)',
      }).log(getLogger())
    }

    // The admin works in collection paths; the audit rows store the collection
    // id. Resolve path → id here. An unknown path yields no id, so the filter
    // simply matches nothing rather than erroring.
    let collectionId: string | undefined
    if (data.collection) {
      const col = await queries.collections.getCollectionByPath(data.collection)
      collectionId = col?.id
      if (collectionId == null) {
        return {
          entries: [],
          meta: { total: 0, page: 1, pageSize: 0, totalPages: 0 },
          actors: {},
          collections: {},
        }
      }
    }

    const result = await queries.audit.findAuditLog({
      actorId: data.actorId,
      collectionId,
      action: data.action,
      from: data.from ? new Date(data.from) : undefined,
      to: data.to ? new Date(data.to) : undefined,
      page: data.page,
      page_size: data.page_size,
    })

    // Acting-user labels (admin realm), resolved here from each row's raw
    // actorId — same helper the per-document audit view uses. System/tooling
    // rows (NULL actorId) and deleted users are absent from the map; the UI
    // renders the tombstone label.
    const actors: ActorLabelMap = await resolveActorLabels(result.entries.map((e) => e.actorId))

    // Collection display info, keyed by the raw collectionId carried on each
    // row. Resolved once from the current collection set; a row whose
    // collection was since removed is simply absent (the log outlives it).
    const collections: ActivityCollectionMap = {}
    const collectionIds = new Set(
      result.entries.map((e) => e.collectionId).filter((id): id is string => id != null)
    )
    if (collectionIds.size > 0) {
      const all = await queries.collections.getAllCollections()
      for (const c of all) {
        if (collectionIds.has(c.id)) {
          collections[c.id] = { path: c.path, singular: c.singular, plural: c.plural }
        }
      }
    }

    const entries: AuditLogEntryDto[] = result.entries.map((e) => ({
      id: e.id,
      documentId: e.documentId,
      collectionId: e.collectionId,
      actorId: e.actorId,
      actorRealm: e.actorRealm,
      action: e.action,
      field: e.field,
      before: e.before as string | string[] | null,
      after: e.after as string | string[] | null,
      occurredAt: e.occurredAt instanceof Date ? e.occurredAt.toISOString() : String(e.occurredAt),
    }))

    return { entries, meta: result.meta, actors, collections }
  })
