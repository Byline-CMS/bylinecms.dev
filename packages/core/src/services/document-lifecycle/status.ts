/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { ERR_INVALID_TRANSITION } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { getWorkflow, validateStatusTransition } from '../../workflow/workflow.js'
import { AUDIT_ACTIONS, auditActor, requireAuditCapability } from './audit.js'
import { runCommittedDocumentHook } from './committed-hook.js'
import { invokeHook } from './internals.js'
import {
  appendPublishScheduleCancellationAudit,
  cancelPublishScheduleInTransaction,
} from './publish-schedule-consistency.js'
import { commitGuardedDocumentMutation, readDocumentForMutation } from './revision-guard.js'
import { commitDocumentStatusTransition } from './status-transition.js'
import type { DocumentRevisionReceipt } from '../../@types/index.js'
import type { DocumentLifecycleContext } from './context.js'

export interface ChangeStatusResult extends DocumentRevisionReceipt {
  previousStatus: string
  newStatus: string
}
export interface UnpublishResult extends DocumentRevisionReceipt {
  archivedCount: number
}

function validateWorkflow(ctx: DocumentLifecycleContext): void {
  if (getWorkflow(ctx.definition).statuses.length <= 1)
    throw ERR_INVALID_TRANSITION({
      message: `collection '${ctx.collectionPath}' has a single-status workflow; status transitions are not supported`,
      details: { collectionPath: ctx.collectionPath },
    })
}
function validateTransition(
  ctx: DocumentLifecycleContext,
  previousStatus: string,
  nextStatus: string
): void {
  validateWorkflow(ctx)
  const result = validateStatusTransition(getWorkflow(ctx.definition), previousStatus, nextStatus)
  if (!result.valid)
    throw ERR_INVALID_TRANSITION({
      message: result.reason ?? 'Invalid status transition',
      details: { currentStatus: previousStatus, nextStatus },
    })
}

export async function changeDocumentStatus(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    expectedRevision: number
    nextStatus: string
  }
): Promise<ChangeStatusResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'changeDocumentStatus' },
    async () => {
      params = { ...params }
      const { db, definition, collectionId, collectionPath } = ctx
      assertActorCanPerform(ctx.requestContext, definition, 'changeStatus')
      if (params.nextStatus === 'published')
        assertActorCanPerform(ctx.requestContext, definition, 'publish')
      const latest = await readDocumentForMutation(ctx, { ...params, lenient: true })
      const previousStatus = latest.status ?? 'draft'
      const documentVersionId = latest.document_version_id as string
      validateTransition(ctx, previousStatus, params.nextStatus)
      const hookCtx = {
        documentId: params.documentId,
        documentVersionId,
        collectionPath,
        path: latest.path ?? '',
        previousStatus,
        nextStatus: params.nextStatus,
      }
      const hooks = await resolveHooks(definition)
      await invokeHook(hooks?.beforeStatusChange, hookCtx)
      const audit = requireAuditCapability(db)
      const committed = await commitGuardedDocumentMutation(
        ctx,
        { ...params, previousVersionId: documentVersionId },
        async (locked) => {
          const status = locked.status ?? 'draft'
          validateTransition(ctx, status, params.nextStatus)
          const schedule = await cancelPublishScheduleInTransaction(ctx, params.documentId)
          if (status !== params.nextStatus)
            await commitDocumentStatusTransition({
              db,
              documentId: params.documentId,
              documentVersionId: locked.currentVersionId!,
              collectionId,
              previousStatus: status,
              nextStatus: params.nextStatus,
              actor: auditActor(ctx),
              contributions: {
                afterAuditAppend: () =>
                  appendPublishScheduleCancellationAudit({
                    ctx,
                    audit,
                    schedule,
                    reason: 'status_changed',
                  }),
              },
            })
          else
            await appendPublishScheduleCancellationAudit({
              ctx,
              audit,
              schedule,
              reason: 'status_changed',
            })
          return {
            value: { previousStatus: status, newStatus: params.nextStatus },
            changed: status !== params.nextStatus || schedule !== null,
          }
        }
      )
      await runCommittedDocumentHook(
        ctx,
        {
          phase: 'afterStatusChange',
          documentId: params.documentId,
          documentVersionId,
          revision: committed.revision,
        },
        () => invokeHook(hooks?.afterStatusChange, hookCtx)
      )
      return { ...committed.value, documentId: params.documentId, revision: committed.revision }
    }
  )
}

export async function unpublishDocument(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    expectedRevision: number
  }
): Promise<UnpublishResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'unpublishDocument' },
    async () => {
      params = { ...params }
      const { db, definition, collectionId, collectionPath } = ctx
      assertActorCanPerform(ctx.requestContext, definition, 'changeStatus')
      const latest = await readDocumentForMutation(ctx, { ...params, lenient: true })
      validateWorkflow(ctx)
      const documentVersionId = latest.document_version_id as string
      const hookCtx = { documentId: params.documentId, collectionPath, path: latest.path ?? '' }
      const hooks = await resolveHooks(definition)
      await invokeHook(hooks?.beforeUnpublish, hookCtx)
      const audit = requireAuditCapability(db)
      const actor = auditActor(ctx)
      const committed = await commitGuardedDocumentMutation(
        ctx,
        { ...params, previousVersionId: documentVersionId },
        async () => {
          const schedule = await cancelPublishScheduleInTransaction(ctx, params.documentId)
          const archivedCount = await db.commands.documents.archivePublishedVersions({
            document_id: params.documentId,
          })
          if (archivedCount > 0)
            await audit.append({
              documentId: params.documentId,
              collectionId,
              ...actor,
              action: AUDIT_ACTIONS.statusChanged,
              field: 'status',
              before: 'published',
              after: 'archived',
            })
          await appendPublishScheduleCancellationAudit({
            ctx,
            audit,
            schedule,
            reason: 'unpublished',
          })
          return { value: archivedCount, changed: archivedCount > 0 || schedule !== null }
        }
      )
      await runCommittedDocumentHook(
        ctx,
        {
          phase: 'afterUnpublish',
          documentId: params.documentId,
          documentVersionId,
          revision: committed.revision,
        },
        () => invokeHook(hooks?.afterUnpublish, { ...hookCtx, archivedCount: committed.value })
      )
      return {
        archivedCount: committed.value,
        documentId: params.documentId,
        revision: committed.revision,
      }
    }
  )
}
