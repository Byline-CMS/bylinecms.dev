/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext } from '@byline/auth'

import { AUDIT_ACTIONS, requireAuditCapability } from '../services/document-lifecycle/audit.js'
import { publishScheduleAuditValue } from '../services/document-lifecycle/publish-schedule-consistency.js'
import { publishClaimedScheduledDocument } from '../services/document-lifecycle/scheduled-publish.js'
import { SCHEDULED_PUBLICATION_LEASE_MS } from './scheduled-publication-constants.js'
import type { ClaimedDocumentPublishSchedule, CollectionDefinition } from '../@types/index.js'
import type { BylineCore } from '../core.js'
import type { BylineLogger } from '../lib/logger.js'
import type { DocumentLifecycleContext } from '../services/document-lifecycle/context.js'

const DEFAULT_BATCH_SIZE = 25
const DEFAULT_BUDGET_MS = 45_000

export interface ScheduledPublicationSweepOptions {
  /** Abort before claiming another batch. */
  signal?: AbortSignal
  /** Stop claiming new work after this process-time budget. */
  budgetMs?: number
  /** Maximum schedules claimed per batch. */
  batchSize?: number
  /** Renew an enclosing scheduler lease between batches. */
  heartbeat?: () => Promise<void>
  logger?: BylineLogger
}

export interface ScheduledPublicationSweepResult {
  published: number
  failed: number
  workRemaining: boolean
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('scheduled publication sweep aborted', 'AbortError')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveCollection(
  core: BylineCore,
  collectionId: string
): {
  definition: CollectionDefinition
  version: number
} | null {
  for (const definition of core.collections) {
    const record = core.collectionRecords.get(definition.path)
    if (record?.collectionId === collectionId) return { definition, version: record.version }
  }
  return null
}

function buildSystemContext(
  core: BylineCore,
  claim: ClaimedDocumentPublishSchedule,
  logger: BylineLogger
): DocumentLifecycleContext | null {
  const collection = resolveCollection(core, claim.collectionId)
  if (collection === null) return null
  return {
    db: core.db,
    definition: collection.definition,
    collectionId: claim.collectionId,
    collectionVersion: collection.version,
    collectionPath: collection.definition.path,
    storage: core.storage,
    logger,
    defaultLocale: core.config.i18n.content.defaultLocale,
    slugifier: core.config.slugifier,
    requestContext: createSuperAdminContext({ id: 'scheduled-publication' }),
  }
}

async function finalizeClaim(params: {
  core: BylineCore
  claim: ClaimedDocumentPublishSchedule
  outcome: 'suspend' | 'discard'
  reason: string
}): Promise<boolean> {
  const audit = requireAuditCapability(params.core.db)
  return audit.withTransaction(async () => {
    const locked = await params.core.db.commands.documents.publishSchedules.lockClaim({
      documentId: params.claim.documentId,
      executionToken: params.claim.executionToken,
    })
    if (locked === null) return false

    const changed =
      params.outcome === 'suspend'
        ? await params.core.db.commands.documents.publishSchedules.suspendClaimForContentEdit({
            documentId: params.claim.documentId,
            executionToken: params.claim.executionToken,
          })
        : await params.core.db.commands.documents.publishSchedules.deleteClaim({
            documentId: params.claim.documentId,
            executionToken: params.claim.executionToken,
          })
    if (!changed) return false

    await audit.append({
      documentId: params.claim.documentId,
      collectionId: params.claim.collectionId,
      actorRealm: 'system',
      action:
        params.outcome === 'suspend'
          ? AUDIT_ACTIONS.publishScheduleSuspended
          : AUDIT_ACTIONS.publishScheduleDiscarded,
      field: 'scheduled_publish',
      before: publishScheduleAuditValue(locked),
      after:
        params.outcome === 'suspend'
          ? { state: 'needs_reconfirm', reason: params.reason }
          : { reason: params.reason },
    })
    return true
  })
}

async function processClaim(params: {
  core: BylineCore
  claim: ClaimedDocumentPublishSchedule
  logger: BylineLogger
}): Promise<'published' | 'failed' | 'handled'> {
  try {
    const ctx = buildSystemContext(params.core, params.claim, params.logger)
    if (ctx === null) {
      await finalizeClaim({
        core: params.core,
        claim: params.claim,
        outcome: 'discard',
        reason: 'collection_not_registered',
      })
      params.logger.warn(
        { documentId: params.claim.documentId, collectionId: params.claim.collectionId },
        'discarded scheduled publication for an unregistered collection'
      )
      return 'handled'
    }

    const result = await publishClaimedScheduledDocument(ctx, {
      documentId: params.claim.documentId,
      executionToken: params.claim.executionToken,
    })
    if (result.status === 'published') return 'published'
    if (result.status === 'claim_lost') return 'handled'
    if (result.status === 'target_changed') {
      await finalizeClaim({
        core: params.core,
        claim: params.claim,
        outcome: 'suspend',
        reason: 'content_edited',
      })
      return 'handled'
    }
    await finalizeClaim({
      core: params.core,
      claim: params.claim,
      outcome: 'discard',
      reason: result.reason,
    })
    params.logger.warn(
      { documentId: params.claim.documentId, reason: result.reason },
      'discarded terminal scheduled publication'
    )
    return 'handled'
  } catch (error: unknown) {
    try {
      params.logger.error(
        { err: error, documentId: params.claim.documentId },
        'scheduled publication attempt failed'
      )
    } catch {
      // A logger failure must not prevent release of the execution claim.
    }
    const released = await params.core.db.commands.documents.publishSchedules.releaseClaim({
      documentId: params.claim.documentId,
      executionToken: params.claim.executionToken,
      error: errorMessage(error),
    })
    return released ? 'failed' : 'handled'
  }
}

/**
 * Drain due publication schedules without depending on the in-process ticker.
 * Database claims provide the execution fence, so independent external
 * orchestrators may invoke this operation concurrently.
 */
export async function runScheduledPublicationSweep(
  core: BylineCore,
  options: ScheduledPublicationSweepOptions = {}
): Promise<ScheduledPublicationSweepResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new TypeError('scheduled publication batchSize must be a positive integer')
  }
  if (!Number.isFinite(budgetMs) || budgetMs < 0) {
    throw new TypeError('scheduled publication budgetMs must be a finite non-negative number')
  }

  const logger = options.logger ?? core.logger
  const startedAt = performance.now()
  let published = 0
  let failed = 0
  let completedBatch = false

  while (true) {
    throwIfAborted(options.signal)
    if (performance.now() - startedAt >= budgetMs) {
      return { published, failed, workRemaining: true }
    }
    if (completedBatch) await options.heartbeat?.()

    const claims = await core.db.commands.documents.publishSchedules.claimDue({
      batchSize,
      leaseMs: SCHEDULED_PUBLICATION_LEASE_MS,
    })
    if (claims.length === 0) return { published, failed, workRemaining: false }

    for (const claim of claims) {
      try {
        const result = await processClaim({ core, claim, logger })
        if (result === 'published') published++
        if (result === 'failed') failed++
      } catch (error: unknown) {
        // Claim recovery is best effort. A database outage may make both the
        // document operation and its token release fail; the claim then
        // expires naturally, but the rest of this batch must still run.
        failed++
        try {
          logger.error(
            { err: error, documentId: claim.documentId },
            'scheduled publication failure could not release its execution claim'
          )
        } catch {
          // Diagnostic logging cannot turn one item into a batch failure.
        }
      }
    }
    completedBatch = true

    if (claims.length < batchSize) {
      return { published, failed, workRemaining: false }
    }
  }
}
