/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { AUDIT_ACTIONS, auditActor, requireAuditCapability } from './audit.js'
import type { DocumentPublishSchedule } from '../../@types/index.js'
import type { AuditCapability } from './audit.js'
import type { DocumentLifecycleContext } from './context.js'

export type PublishScheduleInvalidationReason =
  | 'content_edited'
  | 'status_changed'
  | 'unpublished'
  | 'soft_deleted'

/** Bounded, JSON-safe audit projection; execution errors never enter audit. */
export function publishScheduleAuditValue(
  schedule: DocumentPublishSchedule
): Record<string, unknown> {
  return {
    state: schedule.state,
    publishAt: schedule.publishAt.toISOString(),
    targetVersionId: schedule.targetVersionId,
    authorizedRevision: schedule.authorizedRevision,
    lastAuthorizedBy: schedule.lastAuthorizedBy,
  }
}

/**
 * Lock and remove a schedule inside an already-open lifecycle transaction.
 * The caller appends the audit after its primary mutation audit so ordering is
 * deterministic. This helper deliberately never opens a transaction.
 */
export function cancelPublishScheduleInTransaction(
  ctx: DocumentLifecycleContext,
  documentId: string
): Promise<DocumentPublishSchedule | null> {
  return ctx.db.commands.documents.publishSchedules.cancel({
    documentId,
    collectionId: ctx.collectionId,
  })
}

/** Append the audit for a cancellation already performed in this transaction. */
export async function appendPublishScheduleCancellationAudit(params: {
  ctx: DocumentLifecycleContext
  audit: AuditCapability
  schedule: DocumentPublishSchedule | null
  reason: Exclude<PublishScheduleInvalidationReason, 'content_edited'>
}): Promise<void> {
  if (params.schedule === null) return
  const actor = auditActor(params.ctx)
  await params.audit.append({
    documentId: params.schedule.documentId,
    collectionId: params.schedule.collectionId,
    actorId: actor.actorId,
    actorRealm: actor.actorRealm,
    action: AUDIT_ACTIONS.publishScheduleCancelled,
    field: 'scheduled_publish',
    before: publishScheduleAuditValue(params.schedule),
    after: { reason: params.reason },
  })
}

/**
 * Commit a new content version and schedule suspension in one ambient
 * transaction. `write` may use the adapter's nested transaction/savepoint,
 * but every rejection propagates to this outer boundary.
 */
export async function commitContentVersionWithScheduleSuspension<T>(params: {
  ctx: DocumentLifecycleContext
  documentId: string
  write: () => Promise<T>
}): Promise<T> {
  const audit = requireAuditCapability(params.ctx.db)
  return audit.withTransaction(async () => {
    const result = await params.write()
    await suspendPublishScheduleForEdit(params.ctx, audit, params.documentId, 'content_edited')
    return result
  })
}

/** Called after the primary writes, under their document lock and transaction. */
export async function suspendPublishScheduleForEdit(
  ctx: DocumentLifecycleContext,
  audit: AuditCapability,
  documentId: string,
  reason: 'content_edited' | 'document_metadata_changed'
): Promise<boolean> {
  const actor = auditActor(ctx)
  const suspension = await ctx.db.commands.documents.publishSchedules.suspendForContentEdit({
    documentId,
    collectionId: ctx.collectionId,
    reason,
  })
  if (suspension.status !== 'suspended') return false
  await audit.append({
    documentId,
    collectionId: ctx.collectionId,
    actorId: actor.actorId,
    actorRealm: actor.actorRealm,
    action: AUDIT_ACTIONS.publishScheduleSuspended,
    field: 'scheduled_publish',
    before: {
      state: 'armed',
      targetVersionId: suspension.schedule.targetVersionId,
      publishAt: suspension.schedule.publishAt.toISOString(),
    },
    after: { state: 'needs_reconfirm', reason },
  })
  return true
}
