/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_UNAUTHENTICATED, type RequestContext } from '@byline/auth'

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { collectionAbilityKey } from '../../auth/register-collection-abilities.js'
import {
  ERR_CONFLICT,
  ERR_INVALID_TRANSITION,
  ERR_NOT_FOUND,
  ERR_VALIDATION,
} from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { getWorkflow, validateStatusTransition } from '../../workflow/workflow.js'
import { AUDIT_ACTIONS, auditActor, requireAuditCapability } from './audit.js'
import { actorId, invokeHook } from './internals.js'
import { publishScheduleAuditValue } from './publish-schedule-consistency.js'
import { commitDocumentStatusTransition } from './status-transition.js'
import type {
  DocumentPublishSchedule,
  DocumentPublishSchedulePage,
  DocumentPublishScheduleState,
} from '../../@types/index.js'
import type { BylineCore } from '../../core.js'
import type { DocumentLifecycleContext } from './context.js'

export type ClaimedScheduledPublicationResult =
  | { status: 'published' }
  | { status: 'claim_lost' }
  | { status: 'target_changed' }
  | {
      status: 'terminal'
      reason: 'document_not_found' | 'already_published' | 'invalid_transition'
    }

class ClaimedPublicationOutcome extends Error {
  constructor(
    readonly result: Exclude<ClaimedScheduledPublicationResult, { status: 'published' }>
  ) {
    super(`scheduled publication did not commit: ${result.status}`)
  }
}

function assertScheduleAbilities(ctx: DocumentLifecycleContext): void {
  assertActorCanPerform(ctx.requestContext, ctx.collectionPath, 'changeStatus')
  assertActorCanPerform(ctx.requestContext, ctx.collectionPath, 'publish')
}

async function assertCurrentVersionCanPublish(
  ctx: DocumentLifecycleContext,
  documentId: string,
  expectedVersionId: string
): Promise<void> {
  const current = await ctx.db.queries.documents.getCurrentVersionMetadata({
    collection_id: ctx.collectionId,
    document_id: documentId,
  })
  if (current === null) {
    throw ERR_NOT_FOUND({
      message: 'document not found',
      details: { documentId },
    }).log(ctx.logger)
  }
  if (current.document_version_id !== expectedVersionId) {
    throw ERR_CONFLICT({
      message: 'the document changed before its publication schedule could be saved',
      details: {
        documentId,
        expectedVersionId,
        currentVersionId: current.document_version_id,
      },
    }).log(ctx.logger)
  }

  const workflow = getWorkflow(ctx.definition)
  if (workflow.statuses.length <= 1 || current.status === 'published') {
    throw ERR_INVALID_TRANSITION({
      message: `document in status '${current.status}' cannot be scheduled for publication`,
      details: { documentId, currentStatus: current.status },
    }).log(ctx.logger)
  }
  const transition = validateStatusTransition(workflow, current.status, 'published')
  if (!transition.valid) {
    throw ERR_INVALID_TRANSITION({
      message:
        transition.reason ?? `invalid status transition from '${current.status}' to 'published'`,
      details: { documentId, currentStatus: current.status, nextStatus: 'published' },
    }).log(ctx.logger)
  }
}

function parsePublishAt(value: string): Date {
  const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
  const parsed = new Date(value)
  if (!isoInstant.test(value) || Number.isNaN(parsed.getTime())) {
    throw ERR_VALIDATION({
      message: 'publishAt must be a valid ISO instant',
      details: { publishAt: value },
    })
  }
  return parsed
}

function throwScheduleStorageOutcome(
  ctx: DocumentLifecycleContext,
  documentId: string,
  status:
    | 'document_not_found'
    | 'version_mismatch'
    | 'publish_at_not_future'
    | 'execution_in_progress'
): never {
  if (status === 'document_not_found') {
    throw ERR_NOT_FOUND({ message: 'document not found', details: { documentId } }).log(ctx.logger)
  }
  if (status === 'publish_at_not_future') {
    throw ERR_VALIDATION({
      message: 'scheduled publication must be in the future according to database time',
      details: { documentId },
    }).log(ctx.logger)
  }
  throw ERR_CONFLICT({
    message:
      status === 'execution_in_progress'
        ? 'scheduled publication is already being finalized; refresh before rescheduling'
        : 'the document changed before its publication schedule could be saved',
    details: { documentId, status },
  }).log(ctx.logger)
}

export async function scheduleDocumentPublish(
  ctx: DocumentLifecycleContext,
  params: { documentId: string; publishAt: string; expectedVersionId: string }
): Promise<DocumentPublishSchedule> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'scheduleDocumentPublish' },
    async () => {
      assertScheduleAbilities(ctx)
      await assertCurrentVersionCanPublish(ctx, params.documentId, params.expectedVersionId)
      const publishAt = parsePublishAt(params.publishAt)
      const audit = requireAuditCapability(ctx.db)
      const actor = auditActor(ctx)

      return audit.withTransaction(async () => {
        const result = await ctx.db.commands.documents.publishSchedules.schedule({
          documentId: params.documentId,
          collectionId: ctx.collectionId,
          expectedVersionId: params.expectedVersionId,
          publishAt,
          actorId: actorId(ctx) ?? null,
        })
        if (result.status !== 'scheduled') {
          return throwScheduleStorageOutcome(ctx, params.documentId, result.status)
        }
        await audit.append({
          documentId: params.documentId,
          collectionId: ctx.collectionId,
          actorId: actor.actorId,
          actorRealm: actor.actorRealm,
          action:
            result.previous === null
              ? AUDIT_ACTIONS.publishScheduled
              : AUDIT_ACTIONS.publishRescheduled,
          field: 'scheduled_publish',
          before: result.previous === null ? null : publishScheduleAuditValue(result.previous),
          after: publishScheduleAuditValue(result.schedule),
        })
        return result.schedule
      })
    }
  )
}

export async function confirmDocumentScheduledPublish(
  ctx: DocumentLifecycleContext,
  params: { documentId: string; expectedVersionId: string }
): Promise<DocumentPublishSchedule> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'confirmDocumentScheduledPublish' },
    async () => {
      assertScheduleAbilities(ctx)
      await assertCurrentVersionCanPublish(ctx, params.documentId, params.expectedVersionId)
      const audit = requireAuditCapability(ctx.db)
      const actor = auditActor(ctx)

      return audit.withTransaction(async () => {
        const result = await ctx.db.commands.documents.publishSchedules.confirm({
          documentId: params.documentId,
          collectionId: ctx.collectionId,
          expectedVersionId: params.expectedVersionId,
          actorId: actorId(ctx) ?? null,
        })
        if (result.status !== 'confirmed') {
          if (result.status === 'schedule_not_found') {
            throw ERR_NOT_FOUND({
              message: 'scheduled publication not found',
              details: { documentId: params.documentId },
            }).log(ctx.logger)
          }
          throw ERR_CONFLICT({
            message:
              result.status === 'not_suspended'
                ? 'scheduled publication does not require re-confirmation'
                : 'the document changed before its publication could be re-confirmed',
            details: { documentId: params.documentId, status: result.status },
          }).log(ctx.logger)
        }
        await audit.append({
          documentId: params.documentId,
          collectionId: ctx.collectionId,
          actorId: actor.actorId,
          actorRealm: actor.actorRealm,
          action: AUDIT_ACTIONS.publishReconfirmed,
          field: 'scheduled_publish',
          before: {
            state: 'needs_reconfirm',
            targetVersionId: result.previousTargetVersionId,
          },
          after: publishScheduleAuditValue(result.schedule),
        })
        return result.schedule
      })
    }
  )
}

export async function cancelDocumentScheduledPublish(
  ctx: DocumentLifecycleContext,
  params: { documentId: string }
): Promise<DocumentPublishSchedule | null> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'cancelDocumentScheduledPublish' },
    async () => {
      assertScheduleAbilities(ctx)
      const audit = requireAuditCapability(ctx.db)
      const actor = auditActor(ctx)
      return audit.withTransaction(async () => {
        const schedule = await ctx.db.commands.documents.publishSchedules.cancel({
          documentId: params.documentId,
          collectionId: ctx.collectionId,
        })
        if (schedule !== null) {
          await audit.append({
            documentId: params.documentId,
            collectionId: ctx.collectionId,
            actorId: actor.actorId,
            actorRealm: actor.actorRealm,
            action: AUDIT_ACTIONS.publishScheduleCancelled,
            field: 'scheduled_publish',
            before: publishScheduleAuditValue(schedule),
            after: { reason: 'explicit' },
          })
        }
        return schedule
      })
    }
  )
}

export async function getDocumentScheduledPublish(
  ctx: DocumentLifecycleContext,
  params: { documentId: string }
): Promise<DocumentPublishSchedule | null> {
  assertScheduleAbilities(ctx)
  return ctx.db.queries.documents.publishSchedules.get({
    documentId: params.documentId,
    collectionId: ctx.collectionId,
  })
}

export async function listDocumentPublishSchedules(
  core: BylineCore,
  requestContext: RequestContext | undefined,
  params: {
    states?: readonly DocumentPublishScheduleState[]
    lastAuthorizedBy?: string
    page: number
    pageSize: number
  }
): Promise<DocumentPublishSchedulePage> {
  const actor = requestContext?.actor
  if (actor == null) {
    throw ERR_UNAUTHENTICATED({
      message: 'listing scheduled publications requires an authenticated actor',
    })
  }
  if (!Number.isInteger(params.page) || params.page < 1) {
    throw ERR_VALIDATION({ message: 'page must be a positive integer' })
  }
  if (!Number.isInteger(params.pageSize) || params.pageSize < 1 || params.pageSize > 100) {
    throw ERR_VALIDATION({ message: 'pageSize must be an integer between 1 and 100' })
  }

  const collectionIds: string[] = []
  for (const definition of core.collections) {
    if (
      actor.hasAbility(collectionAbilityKey(definition.path, 'changeStatus')) &&
      actor.hasAbility(collectionAbilityKey(definition.path, 'publish'))
    ) {
      collectionIds.push(core.getCollectionRecord(definition.path).collectionId)
    }
  }

  return core.db.queries.documents.publishSchedules.list({
    collectionIds,
    states: params.states,
    lastAuthorizedBy: params.lastAuthorizedBy,
    page: params.page,
    pageSize: params.pageSize,
  })
}

/**
 * Execute one token-fenced publication through the normal status lifecycle.
 * Internal to the server-only sweep: authorization was captured when the row
 * was armed, so callers must construct an explicit system context.
 */
export async function publishClaimedScheduledDocument(
  ctx: DocumentLifecycleContext,
  params: { documentId: string; executionToken: string }
): Promise<ClaimedScheduledPublicationResult> {
  const workflow = getWorkflow(ctx.definition)
  const initial = await ctx.db.queries.documents.getCurrentVersionMetadata({
    collection_id: ctx.collectionId,
    document_id: params.documentId,
  })
  if (initial === null) {
    return { status: 'terminal', reason: 'document_not_found' }
  }
  const schedule = await ctx.db.queries.documents.publishSchedules.get({
    documentId: params.documentId,
    collectionId: ctx.collectionId,
  })
  if (schedule === null || schedule.executionToken !== params.executionToken) {
    return { status: 'claim_lost' }
  }
  if (initial.document_version_id !== schedule.targetVersionId) {
    return { status: 'target_changed' }
  }
  if (initial.status === 'published') {
    return { status: 'terminal', reason: 'already_published' }
  }
  const initialTransition = validateStatusTransition(workflow, initial.status, 'published')
  if (!initialTransition.valid) {
    return { status: 'terminal', reason: 'invalid_transition' }
  }

  const hooks = await resolveHooks(ctx.definition)
  const path =
    (await ctx.db.queries.documents.getCurrentPath({
      collection_id: ctx.collectionId,
      document_id: params.documentId,
    })) ?? ''
  const hookCtx = {
    documentId: params.documentId,
    documentVersionId: initial.document_version_id,
    collectionPath: ctx.collectionPath,
    path,
    previousStatus: initial.status,
    nextStatus: 'published',
  }

  await invokeHook(hooks?.beforeStatusChange, hookCtx)

  try {
    await commitDocumentStatusTransition({
      db: ctx.db,
      documentId: params.documentId,
      documentVersionId: initial.document_version_id,
      collectionId: ctx.collectionId,
      previousStatus: initial.status,
      nextStatus: 'published',
      actor: auditActor(ctx),
      contributions: {
        beforeStatusWrite: async () => {
          const locked = await ctx.db.commands.documents.publishSchedules.lockClaim({
            documentId: params.documentId,
            executionToken: params.executionToken,
          })
          if (locked === null) {
            throw new ClaimedPublicationOutcome({ status: 'claim_lost' })
          }
          const current = await ctx.db.queries.documents.getCurrentVersionMetadata({
            collection_id: ctx.collectionId,
            document_id: params.documentId,
          })
          if (current === null) {
            throw new ClaimedPublicationOutcome({
              status: 'terminal',
              reason: 'document_not_found',
            })
          }
          if (
            current.document_version_id !== locked.targetVersionId ||
            current.document_version_id !== initial.document_version_id
          ) {
            throw new ClaimedPublicationOutcome({ status: 'target_changed' })
          }
          if (current.status === 'published') {
            throw new ClaimedPublicationOutcome({
              status: 'terminal',
              reason: 'already_published',
            })
          }
          if (!validateStatusTransition(workflow, current.status, 'published').valid) {
            throw new ClaimedPublicationOutcome({
              status: 'terminal',
              reason: 'invalid_transition',
            })
          }
        },
        afterAuditAppend: async () => {
          const deleted = await ctx.db.commands.documents.publishSchedules.deleteClaim({
            documentId: params.documentId,
            executionToken: params.executionToken,
          })
          if (!deleted) throw new ClaimedPublicationOutcome({ status: 'claim_lost' })
        },
      },
    })
  } catch (error: unknown) {
    if (error instanceof ClaimedPublicationOutcome) return error.result
    throw error
  }

  try {
    await invokeHook(hooks?.afterStatusChange, hookCtx)
  } catch (error: unknown) {
    try {
      ctx.logger.error(
        { err: error, documentId: params.documentId },
        'afterStatusChange hook failed after scheduled publication committed'
      )
    } catch {
      // Diagnostic logging cannot change the committed publication outcome.
    }
  }
  return { status: 'published' }
}
