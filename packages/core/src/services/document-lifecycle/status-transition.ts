/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { AUDIT_ACTIONS, requireAuditCapability } from './audit.js'
import type { AuditActorRealm, IDbAdapter } from '../../@types/index.js'

/**
 * Internal transaction contributions for the two status-transition callers.
 * They run on the adapter's ambient transaction and must not open or swallow
 * failures from a nested transaction. This module is deliberately absent from
 * the public lifecycle barrel: these callbacks are not collection hooks or a
 * supported extension API.
 */
interface StatusTransitionContributions {
  /** Runs before any status mutation and may abort the whole transaction. */
  beforeStatusWrite?: () => void | Promise<void>
  /** Runs after the audit append, before the whole transaction commits. */
  afterAuditAppend?: () => void | Promise<void>
}

interface CommitDocumentStatusTransitionParams {
  db: IDbAdapter
  documentId: string
  documentVersionId: string
  collectionId: string
  previousStatus: string
  nextStatus: string
  actor: {
    actorId: string | undefined
    actorRealm: AuditActorRealm
  }
  contributions?: StatusTransitionContributions
}

/**
 * Commit the shared, transaction-internal portion of a document status
 * transition. Authorization, workflow validation, and lifecycle hooks remain
 * the responsibility of the caller; status mutation, auto-archive, audit, and
 * any caller contribution commit or roll back as one ambient transaction.
 */
export async function commitDocumentStatusTransition(
  params: CommitDocumentStatusTransitionParams
): Promise<void> {
  const audit = requireAuditCapability(params.db)

  await audit.withTransaction(async () => {
    await params.contributions?.beforeStatusWrite?.()

    await params.db.commands.documents.setDocumentStatus({
      document_version_id: params.documentVersionId,
      status: params.nextStatus,
    })
    if (params.nextStatus === 'published') {
      await params.db.commands.documents.archivePublishedVersions({
        document_id: params.documentId,
        excludeVersionId: params.documentVersionId,
      })
    }
    await audit.append({
      documentId: params.documentId,
      collectionId: params.collectionId,
      actorId: params.actor.actorId,
      actorRealm: params.actor.actorRealm,
      action: AUDIT_ACTIONS.statusChanged,
      field: 'status',
      before: params.previousStatus,
      after: params.nextStatus,
    })

    await params.contributions?.afterAuditAppend?.()
  })
}
