/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { documentAbilityKey } from '../../auth/register-collection-abilities.js'
import { ERR_DOCUMENT_STALE, ERR_NOT_FOUND, ERR_VALIDATION } from '../../lib/errors.js'
import {
  documentRevisionFromDatabase,
  parseDocumentRevision,
} from '../../storage/document-revision.js'
import { requireAuditCapability } from './audit.js'
import { suspendPublishScheduleForEdit } from './publish-schedule-consistency.js'
import type { DocumentRevisionTarget, LockedDocumentRevision } from '../../@types/index.js'
import type { DocumentLifecycleContext } from './context.js'

/** Public lifecycle services own their commit boundary, including post-commit hooks. */
export function assertLifecycleTransactionOwnership(ctx: DocumentLifecycleContext): void {
  if (ctx.db.revisions.isInTransaction()) {
    throw ERR_VALIDATION({
      message:
        'Public document lifecycle operations cannot run inside an externally owned transaction',
      details: { reason: 'external_lifecycle_transaction' },
    })
  }
}

/** Authorized preflight: reject known staleness before hooks or external preparation. */
export async function readDocumentForMutation(
  ctx: DocumentLifecycleContext,
  params: { documentId: string; expectedRevision: number; locale?: string; lenient?: boolean }
): Promise<Record<string, any>> {
  assertLifecycleTransactionOwnership(ctx)
  const expectedRevision = parseDocumentRevision(params.expectedRevision)
  return ctx.db.withReadSnapshot(async (queries) => {
    const source = await queries.documents.getDocumentById({
      collection_id: ctx.collectionId,
      document_id: params.documentId,
      locale: params.locale ?? ctx.defaultLocale,
      reconstruct: true,
      readMode: 'any',
      lenient: params.lenient,
      requestContext: ctx.requestContext,
    })
    if (source == null)
      throw ERR_NOT_FOUND({
        message: 'document not found',
        details: { documentId: params.documentId },
      })
    const currentRevision = documentRevisionFromDatabase(
      await queries.documents.getDocumentRevision({
        collection_id: ctx.collectionId,
        document_id: params.documentId,
      })
    )
    if (currentRevision !== expectedRevision)
      throw ERR_DOCUMENT_STALE({
        message: 'This document has changed. Reload it before making changes.',
        details: {
          reason: 'revision_mismatch',
          documentId: params.documentId,
          expectedRevision,
          currentRevision,
        },
      })
    return source
  })
}

/** Internal final boundary. The callback contains storage work only, never user hooks. */
export async function commitGuardedDocumentMutation<T>(
  ctx: DocumentLifecycleContext,
  target: Omit<DocumentRevisionTarget, 'collectionId'>,
  write: (locked: LockedDocumentRevision) => Promise<{ value: T; changed: boolean }>,
  options: { collectionLock?: 'exclusive'; structuralScope?: 'collection' } = {}
): Promise<{
  value: T
  revision: number
  affectedDocuments: { documentId: string; revision: number }[]
  scheduledPublicationsNeedReconfirmation: boolean
}> {
  assertLifecycleTransactionOwnership(ctx)
  target = { ...target, expectedRevision: parseDocumentRevision(target.expectedRevision) }
  const audit = requireAuditCapability(ctx.db)
  return audit.withTransaction(async () => {
    // Acquire the collection lock before any document lock, including FK locks
    // from version/path/audit inserts. Ordinary writers share it; exclusive
    // operations select their mode up front, never upgrading after locking a document.
    const mode =
      options.structuralScope === 'collection' ||
      options.collectionLock === 'exclusive' ||
      ctx.definition.singleton === true ||
      ctx.definition.tree === true
        ? 'exclusive'
        : 'shared'
    await ctx.db.commands.collections.lockCollectionRegistration(ctx.collectionId, mode)
    if (ctx.definition.singleton === true) {
      const mapped = await ctx.db.queries.singletons.getMappedDocumentId(ctx.collectionId)
      if (mapped !== target.documentId)
        throw ERR_NOT_FOUND({ message: 'Singleton target is unavailable; reload before saving' })
    }
    const structural = ctx.definition.tree === true || options.structuralScope === 'collection'
    const before = structural
      ? await ctx.db.revisions.readStructure({
          collectionId: ctx.collectionId,
          ...(options.structuralScope === 'collection'
            ? {}
            : { documentIds: [target.documentId], parentDocumentId: target.documentId }),
        })
      : []
    const targets = before
      .filter((row) => row.live && row.documentId !== target.documentId)
      .map((row) => ({
        documentId: row.documentId,
        collectionId: ctx.collectionId,
        expectedRevision: row.revision,
      }))
    const lockedDocuments = await ctx.db.revisions.lock([
      ...targets,
      { ...target, collectionId: ctx.collectionId },
    ])
    const locked = lockedDocuments.find((row) => row.documentId === target.documentId)
    if (!locked) throw new Error('Revision guard returned no locked observation')
    if (structural)
      await ctx.db.commands.documents.publishSchedules.lockDocuments(
        lockedDocuments.map((row) => row.documentId)
      )
    const outcome = await write(locked)
    const after = structural
      ? await ctx.db.revisions.readStructure({
          collectionId: ctx.collectionId,
          documentIds: before.map((row) => row.documentId),
        })
      : []
    const structuralChanges = new Set<string>()
    for (const previous of before) {
      const current = after.find((row) => row.documentId === previous.documentId)
      if (
        current &&
        (current.orderKey !== previous.orderKey ||
          current.placed !== previous.placed ||
          current.parentDocumentId !== previous.parentDocumentId ||
          current.treeOrderKey !== previous.treeOrderKey)
      )
        structuralChanges.add(previous.documentId)
    }
    // Legacy/internal writes can leave edges attached to unavailable documents.
    // Never commit a derived structural write that was not revision-locked.
    if ([...structuralChanges].some((id) => !lockedDocuments.some((row) => row.documentId === id)))
      throw ERR_NOT_FOUND({
        message: 'A structural target is unavailable; reload before changing this tree.',
      })
    let suspended = false
    const affectedDocuments = []
    let revision = locked.revision
    for (const document of lockedDocuments) {
      const changedStructure = structuralChanges.has(document.documentId)
      if (changedStructure)
        suspended =
          (await suspendPublishScheduleForEdit(
            ctx,
            audit,
            document.documentId,
            'document_metadata_changed'
          )) || suspended
      if ((document.documentId === target.documentId && outcome.changed) || changedStructure) {
        const receipt = await ctx.db.revisions.advance(document)
        affectedDocuments.push(receipt)
        if (document.documentId === target.documentId) revision = receipt.revision
      }
    }
    const actor = ctx.requestContext?.actor
    const canSeeSchedules =
      actor?.hasAbility(documentAbilityKey(ctx.definition, 'publish')) === true &&
      actor.hasAbility(documentAbilityKey(ctx.definition, 'changeStatus'))
    return {
      value: outcome.value,
      revision,
      affectedDocuments: actor?.hasAbility(documentAbilityKey(ctx.definition, 'read'))
        ? affectedDocuments
        : affectedDocuments.filter((row) => row.documentId === target.documentId),
      scheduledPublicationsNeedReconfirmation: canSeeSchedules && suspended,
    }
  })
}
