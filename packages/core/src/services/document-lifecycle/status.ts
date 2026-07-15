/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { ERR_INVALID_TRANSITION, ERR_NOT_FOUND } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { getWorkflow, validateStatusTransition } from '../../workflow/workflow.js'
import { AUDIT_ACTIONS, auditActor, requireAuditCapability } from './audit.js'
import { invokeHook } from './internals.js'
import type { DocumentLifecycleContext } from './context.js'

export interface ChangeStatusResult {
  previousStatus: string
  newStatus: string
}

export interface UnpublishResult {
  archivedCount: number
}

/**
 * Change a document's workflow status.
 *
 * Flow:
 *   1. Fetch current document metadata
 *   2. Validate transition via `validateStatusTransition()`
 *   3. `hooks.beforeStatusChange({ documentId, documentVersionId, collectionPath, previousStatus, nextStatus })`
 *   4. `db.commands.documents.setDocumentStatus(...)` — in-place mutation
 *   5. Auto-archive: if transitioning to `'published'`, archive other published versions
 *   6. `hooks.afterStatusChange({ documentId, documentVersionId, collectionPath, previousStatus, nextStatus })`
 */
export async function changeDocumentStatus(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    nextStatus: string
  }
): Promise<ChangeStatusResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'changeDocumentStatus' },
    async () => {
      const { db, definition, collectionId, collectionPath } = ctx
      // Every transition requires the general changeStatus ability.
      // Transitions that target the `published` status additionally
      // require the narrower `publish` ability — so installations can
      // grant "move things through the workflow" without also granting
      // "flip the final publish switch".
      assertActorCanPerform(ctx.requestContext, collectionPath, 'changeStatus')
      if (params.nextStatus === 'published') {
        assertActorCanPerform(ctx.requestContext, collectionPath, 'publish')
      }
      // Single-status workflows (e.g. SINGLE_STATUS_WORKFLOW for lookups)
      // have no transitions to perform. Reject early with a clear message
      // rather than relying on the generic ±1-step validator.
      const workflow = getWorkflow(definition)
      if (workflow.statuses.length <= 1) {
        throw ERR_INVALID_TRANSITION({
          message: `collection '${collectionPath}' has a single-status workflow; status transitions are not supported`,
          details: { collectionPath, nextStatus: params.nextStatus },
        }).log(ctx.logger)
      }
      const hooks = await resolveHooks(definition)

      // 1. Fetch current version metadata. No field reconstruction needed —
      //    status transitions only touch the document_versions.status column.
      const latest = await db.queries.documents.getCurrentVersionMetadata({
        collection_id: collectionId,
        document_id: params.documentId,
      })

      if (latest == null) {
        throw ERR_NOT_FOUND({
          message: 'document not found',
          details: { documentId: params.documentId },
        }).log(ctx.logger)
      }

      const currentStatus = latest.status ?? 'draft'
      const documentVersionId = latest.document_version_id

      // 2. Validate transition.
      const result = validateStatusTransition(workflow, currentStatus, params.nextStatus)

      if (!result.valid) {
        throw ERR_INVALID_TRANSITION({
          message:
            result.reason ??
            `invalid status transition from '${currentStatus}' to '${params.nextStatus}'`,
          details: { currentStatus, nextStatus: params.nextStatus },
        }).log(ctx.logger)
      }

      // Resolve the document's canonical path so the hooks can act on the
      // specific document/URL (CDN purge, cache-key drop). Narrow lookup —
      // getCurrentVersionMetadata deliberately omits the path subquery.
      const path =
        (await ctx.db.queries.documents.getCurrentPath({
          collection_id: collectionId,
          document_id: params.documentId,
        })) ?? ''

      const hookCtx = {
        documentId: params.documentId,
        documentVersionId,
        collectionPath,
        path,
        previousStatus: currentStatus,
        nextStatus: params.nextStatus,
      }

      // 3. beforeStatusChange hook.
      await invokeHook(hooks?.beforeStatusChange, hookCtx)

      // 4–5. Mutate status in-place + auto-archive, atomically with the audit
      //      record. Status mutates the version row rather than minting a new
      //      version, so the version stream never captures *who* changed it —
      //      the audit log is its only accountability home (docs/06-auth-and-security/02-auditability.md).
      const audit = requireAuditCapability(db)
      const actor = auditActor(ctx)
      await audit.withTransaction(async () => {
        await db.commands.documents.setDocumentStatus({
          document_version_id: documentVersionId,
          status: params.nextStatus,
        })
        if (params.nextStatus === 'published') {
          await db.commands.documents.archivePublishedVersions({
            document_id: params.documentId,
            excludeVersionId: documentVersionId,
          })
        }
        await audit.append({
          documentId: params.documentId,
          collectionId,
          actorId: actor.actorId,
          actorRealm: actor.actorRealm,
          action: AUDIT_ACTIONS.statusChanged,
          field: 'status',
          before: currentStatus,
          after: params.nextStatus,
        })
      })

      // 6. afterStatusChange hook.
      await invokeHook(hooks?.afterStatusChange, hookCtx)

      return { previousStatus: currentStatus, newStatus: params.nextStatus }
    }
  )
}

/**
 * Unpublish a document by archiving its published version(s).
 *
 * Flow:
 *   1. `hooks.beforeUnpublish({ documentId, collectionPath })`
 *   2. Archive published versions and append the status audit atomically
 *   3. `hooks.afterUnpublish({ documentId, collectionPath, archivedCount })`
 */
export async function unpublishDocument(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
  }
): Promise<UnpublishResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'unpublishDocument' },
    async () => {
      const { db, collectionId, collectionPath, definition } = ctx
      // Unpublish is a workflow transition out of `published` — reuse the
      // changeStatus gate rather than a separate ability.
      assertActorCanPerform(ctx.requestContext, collectionPath, 'changeStatus')
      // Single-status workflows have nothing to unpublish to.
      const workflow = getWorkflow(definition)
      if (workflow.statuses.length <= 1) {
        throw ERR_INVALID_TRANSITION({
          message: `collection '${collectionPath}' has a single-status workflow; unpublish is not supported`,
          details: { collectionPath },
        }).log(ctx.logger)
      }
      const hooks = await resolveHooks(definition)

      // Resolve the document's canonical path so the hooks can target the
      // specific document/URL (CDN purge, cache-key drop).
      const path =
        (await db.queries.documents.getCurrentPath({
          collection_id: collectionId,
          document_id: params.documentId,
        })) ?? ''

      await invokeHook(hooks?.beforeUnpublish, {
        documentId: params.documentId,
        collectionPath,
        path,
      })

      const audit = requireAuditCapability(db)
      const actor = auditActor(ctx)
      const archivedCount = await audit.withTransaction(async () => {
        const count = await db.commands.documents.archivePublishedVersions({
          document_id: params.documentId,
        })
        if (count > 0) {
          await audit.append({
            documentId: params.documentId,
            collectionId,
            actorId: actor.actorId,
            actorRealm: actor.actorRealm,
            action: AUDIT_ACTIONS.statusChanged,
            field: 'status',
            before: 'published',
            after: 'archived',
          })
        }
        return count
      })

      await invokeHook(hooks?.afterUnpublish, {
        documentId: params.documentId,
        collectionPath,
        path,
        archivedCount,
      })

      return { archivedCount }
    }
  )
}
