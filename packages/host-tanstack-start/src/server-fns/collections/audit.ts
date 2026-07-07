/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { ERR_NOT_FOUND, getLogger } from '@byline/core'

import { ensureCollection } from '../../integrations/api-utils.js'
import { getAdminBylineClient } from '../../integrations/byline-client.js'
import { type ActorLabelMap, resolveActorLabels } from './actors.js'

// ---------------------------------------------------------------------------
// Shared param types
// ---------------------------------------------------------------------------

export interface AuditLogSearchParams {
  page?: number
  page_size?: number
}

/**
 * Audit entry as it crosses the server-fn boundary. `occurredAt` is an ISO
 * string (Date doesn't survive serialization) and `before` / `after` are
 * narrowed from the storage layer's `unknown` jsonb to the concrete shapes the
 * shipped actions actually carry (path/status strings, the available-locales
 * array, or null for the deletion event) — `unknown` is not a serializable
 * type the TanStack server-fn validator accepts.
 */
export interface AuditLogEntryDto {
  id: string
  documentId: string | null
  collectionId: string | null
  actorId: string | null
  actorRealm: string
  action: string
  field: string | null
  before: string | string[] | null
  after: string | string[] | null
  occurredAt: string
}

// ---------------------------------------------------------------------------
// Get document-grain audit log (docs/06-auth-and-security/02-auditability.md — Workstream 3)
// ---------------------------------------------------------------------------

export const getCollectionDocumentAuditLog = createServerFn({ method: 'GET' })
  .validator((input: { collection: string; id: string; params?: AuditLogSearchParams }) => input)
  .handler(async ({ data }) => {
    const { collection: path, id, params } = data
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(getLogger())
    }

    // Routes through CollectionHandle.auditLog so the document's own read gate
    // (`beforeRead` via `findById`) is applied — identical to the history
    // server fn. An actor whose predicate excludes the document gets an empty
    // log rather than leaked change metadata.
    const result = await getAdminBylineClient().collection(path).auditLog(id, {
      page: params?.page,
      pageSize: params?.page_size,
    })

    // Acting-user labels for the audit list (docs/06-auth-and-security/02-auditability.md — W3). Resolved
    // here, in the admin realm, from each entry's raw `actorId`; the UI joins
    // by id. System/tooling rows (NULL actorId) and deleted users are absent
    // from the map — the UI renders the corresponding tombstone label.
    const actors: ActorLabelMap = await resolveActorLabels(result.entries.map((e) => e.actorId))

    // Map to the serializable DTO: ISO-string the timestamp and narrow the
    // jsonb before/after off `unknown` so the value survives the TanStack
    // server-fn boundary.
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

    return { entries, meta: result.meta, actors }
  })
