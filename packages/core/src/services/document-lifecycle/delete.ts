/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { ERR_NOT_FOUND, ErrorCodes } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { hasUploadField, isUploadField } from '../../utils/storage-utils.js'
import { walkFieldTree } from '../walk-field-tree.js'
import {
  AUDIT_ACTIONS,
  auditActor,
  requireAuditCapability,
  requireTreeAuditCapability,
} from './audit.js'
import { invokeHook } from './internals.js'
import { firePromoteTreeChange, reconcileTreeOnDeleteInTransaction } from './tree.js'
import type { TreeDeleteMutationResult } from '../../@types/index.js'
import type { DocumentLifecycleContext } from './context.js'

export type DeleteDocumentOutcome = 'committed' | 'committed-with-side-effect-failures'

export type DeleteDocumentSideEffectPhase = 'storageCleanup' | 'afterTreeChange' | 'afterDelete'

export interface DeleteDocumentSideEffectFailure {
  phase: DeleteDocumentSideEffectPhase
  message: string
  code: string
}

export interface DeleteDocumentCommittedResult {
  deletedVersionCount: number
  outcome: 'committed'
  sideEffectFailures: []
}

export interface DeleteDocumentCommittedWithSideEffectFailuresResult {
  deletedVersionCount: number
  outcome: 'committed-with-side-effect-failures'
  sideEffectFailures: [DeleteDocumentSideEffectFailure, ...DeleteDocumentSideEffectFailure[]]
}

export type DeleteDocumentResult =
  | DeleteDocumentCommittedResult
  | DeleteDocumentCommittedWithSideEffectFailuresResult

function readErrorString(error: unknown, property: 'message' | 'code'): string | undefined {
  try {
    if ((typeof error !== 'object' || error === null) && typeof error !== 'function') {
      return undefined
    }
    const value = Reflect.get(error, property)
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

function serializeSideEffectFailure(
  phase: DeleteDocumentSideEffectPhase,
  error: unknown
): DeleteDocumentSideEffectFailure {
  try {
    return {
      phase,
      message:
        typeof error === 'string'
          ? error
          : (readErrorString(error, 'message') ?? 'Unknown side-effect failure'),
      code: readErrorString(error, 'code') ?? ErrorCodes.UNHANDLED,
    }
  } catch {
    return {
      phase,
      message: 'Unknown side-effect failure',
      code: ErrorCodes.UNHANDLED,
    }
  }
}

/**
 * Soft-delete a document.
 *
 * Marks all versions of the document as deleted (`is_deleted = true`). The
 * `current_documents` view automatically filters deleted rows, so the
 * document disappears from all list / page queries without physically
 * removing data.
 *
 * When the collection has any upload-capable image/file field and
 * `ctx.storage` is provided, every original file and persisted variant
 * across those fields is also removed from storage after the DB
 * soft-delete succeeds. Variant paths are read from the field value's
 * `variants` array (no re-derivation from `upload.sizes`), so cleanup
 * stays correct even if the size set changed between upload and delete.
 * File cleanup failures are logged but are non-fatal.
 *
 * Flow:
 *   1. Fetch current document (reconstruct when upload-capable fields exist)
 *   2. `hooks.beforeDelete({ documentId, collectionPath })`
 *   3. `db.commands.documents.softDeleteDocument({ document_id })`
 *   4. Storage file + variant cleanup (skipped when no upload fields, non-fatal)
 *   5. `hooks.afterDelete({ documentId, collectionPath })`
 */
export async function deleteDocument(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
  }
): Promise<DeleteDocumentResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'deleteDocument' },
    async () => {
      const { db, collectionPath, definition, logger } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'delete')
      const hooks = await resolveHooks(definition)

      // 1. Verify the document exists.
      //    For collections that have any upload-capable image/file field
      //    AND a storage provider, fetch with reconstruct: true so we
      //    can read the stored file paths (and persisted variant paths)
      //    from the field values before the DB rows are deleted.
      const storage = ctx.storage
      const isUploadCollection = hasUploadField(definition) && storage != null
      const latest = await db.queries.documents.getDocumentById({
        collection_id: ctx.collectionId,
        document_id: params.documentId,
        reconstruct: isUploadCollection,
      })

      if (latest == null) {
        throw ERR_NOT_FOUND({
          message: 'document not found',
          details: { documentId: params.documentId },
        }).log(ctx.logger)
      }

      // Collect storage paths for every upload-capable field on the doc:
      // the original file plus every persisted variant. The schema/data
      // walk descends into `group` / `array` / `blocks`, so upload fields
      // nested in repeating structures are cleaned up too. Reading the
      // variants from the field value (rather than re-deriving from
      // `upload.sizes`) keeps cleanup correct even when the size set
      // changes between upload and delete.
      const storagePathsToDelete: string[] = []
      if (isUploadCollection) {
        const data = (latest as Record<string, any>)?.fields
        for (const leaf of walkFieldTree(definition.fields, data)) {
          if (!isUploadField(leaf.field)) continue
          const fieldValue = leaf.value
          if (!fieldValue || typeof fieldValue !== 'object') continue
          const stored = fieldValue as Record<string, any>
          if (typeof stored.storagePath === 'string') {
            storagePathsToDelete.push(stored.storagePath)
          }
          if (Array.isArray(stored.variants)) {
            for (const variant of stored.variants) {
              if (variant && typeof variant.storagePath === 'string') {
                storagePathsToDelete.push(variant.storagePath)
              }
            }
          }
        }
      }

      const hookCtx = {
        documentId: params.documentId,
        collectionPath,
        // The current document was fetched above (reconstructed only for
        // upload collections, but the envelope carries the locale-resolved
        // `path` projection either way). Surface it so delete hooks can purge
        // the specific document/URL.
        path: (latest as Record<string, any>).path ?? '',
      }

      // 2. beforeDelete hook.
      await invokeHook(hooks?.beforeDelete, hookCtx)

      // 3. Soft-delete all versions atomically with the document audit and,
      //    for tree collections, locked child promotion/removal plus every
      //    parent/child tree audit row. Any failure rolls the entire delete
      //    back, so soft-deleted documents cannot leak live edges.
      //    whole-document delete mints no new version, so the version stream
      //    never records it — the audit log is the only place a deletion is
      //    accountable (docs/06-auth-and-security/02-auditability.md). Storage-file cleanup (step 4) is a
      //    DB↔external side-effect and stays OUTSIDE the transaction — it is
      //    post-commit, best-effort compensation (docs/03-architecture/03-transactions.md).
      const treeAudit = definition.tree === true ? requireTreeAuditCapability(db) : undefined
      const audit = treeAudit ?? requireAuditCapability(db)
      const actor = auditActor(ctx)
      let deletedVersionCount = 0
      let treeResult: TreeDeleteMutationResult | undefined
      await audit.withTransaction(async () => {
        deletedVersionCount = await db.commands.documents.softDeleteDocument({
          document_id: params.documentId,
        })
        await audit.append({
          documentId: params.documentId,
          collectionId: ctx.collectionId,
          actorId: actor.actorId,
          actorRealm: actor.actorRealm,
          action: AUDIT_ACTIONS.deleted,
        })
        if (treeAudit != null) {
          treeResult = await reconcileTreeOnDeleteInTransaction(ctx, params.documentId, treeAudit)
        }
      })

      // Everything below is post-commit. Each operation and the logger get an
      // independent attempt; none can turn the committed delete into a rejection.
      const sideEffectFailures: DeleteDocumentSideEffectFailure[] = []

      // 4. Clean up every storage file. Returned failures omit paths, while
      // internal logs retain the target needed for operational reconciliation.
      if (storage && storagePathsToDelete.length > 0) {
        for (const storagePath of storagePathsToDelete) {
          try {
            await storage.delete(storagePath)
          } catch (error: unknown) {
            sideEffectFailures.push(serializeSideEffectFailure('storageCleanup', error))
            try {
              logger.error(
                { err: error, documentId: params.documentId, storagePath },
                'failed to delete storage file'
              )
            } catch {
              // Diagnostic logging must not interrupt the remaining cleanup attempts.
            }
          }
        }
      }

      // 5-6. Both post-commit hook families get an independent attempt. A tree
      // invalidation failure must not prevent afterDelete consumers (search,
      // cache removal) from running, or vice versa.
      try {
        if (treeResult != null) {
          await firePromoteTreeChange(ctx, params.documentId, treeResult)
        }
      } catch (error: unknown) {
        sideEffectFailures.push(serializeSideEffectFailure('afterTreeChange', error))
        try {
          logger.error(
            { err: error, documentId: params.documentId },
            'afterTreeChange hook failed after document delete'
          )
        } catch {
          // Diagnostic logging must not affect the committed result.
        }
      }
      try {
        await invokeHook(hooks?.afterDelete, hookCtx)
      } catch (error: unknown) {
        sideEffectFailures.push(serializeSideEffectFailure('afterDelete', error))
        try {
          logger.error(
            { err: error, documentId: params.documentId },
            'afterDelete hook failed after document delete'
          )
        } catch {
          // Diagnostic logging must not affect the committed result.
        }
      }

      const [firstFailure, ...remainingFailures] = sideEffectFailures
      if (firstFailure != null) {
        try {
          logger.error(
            {
              documentId: params.documentId,
              sideEffectFailures: [firstFailure, ...remainingFailures],
            },
            'post-commit delete side effects failed'
          )
        } catch {
          // A reporting failure cannot change the already-committed outcome.
        }
        return {
          deletedVersionCount,
          outcome: 'committed-with-side-effect-failures',
          sideEffectFailures: [firstFailure, ...remainingFailures],
        }
      }

      return { deletedVersionCount, outcome: 'committed', sideEffectFailures: [] }
    }
  )
}
