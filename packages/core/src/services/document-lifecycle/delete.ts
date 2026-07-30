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

export type DeleteDocumentSideEffectPhase = 'afterTreeChange' | 'afterDelete'

export type DeleteDocumentSideEffectCode = typeof ErrorCodes.STORAGE | typeof ErrorCodes.UNHANDLED

export interface DeleteDocumentSideEffectFailure {
  phase: DeleteDocumentSideEffectPhase
  code: DeleteDocumentSideEffectCode
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

function readErrorCode(error: unknown): string | undefined {
  try {
    if ((typeof error !== 'object' || error === null) && typeof error !== 'function') {
      return undefined
    }
    const value = Reflect.get(error, 'code')
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

function serializeSideEffectFailure(
  phase: DeleteDocumentSideEffectPhase,
  error: unknown
): DeleteDocumentSideEffectFailure {
  return {
    phase,
    code: readErrorCode(error) === ErrorCodes.STORAGE ? ErrorCodes.STORAGE : ErrorCodes.UNHANDLED,
  }
}

/**
 * Soft-delete a document.
 *
 * Marks every version and path row for the document as deleted. Live views
 * and path resolution exclude those tombstones, while content, retained path
 * values, uploaded sources, and persisted variants remain available for a
 * later restoration workflow.
 *
 * Flow:
 *   1. Fetch current document metadata, including its original path
 *   2. `hooks.beforeDelete({ documentId, collectionPath })`
 *   3. `db.commands.documents.softDeleteDocument({ document_id })`
 *   4. Tree-change hooks, when applicable
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

      // 1. Verify the document exists. Soft delete retains field rows and
      //    uploaded objects, so only the envelope and original path projection
      //    are needed for hooks.
      const latest = await db.queries.documents.getDocumentById({
        collection_id: ctx.collectionId,
        document_id: params.documentId,
        reconstruct: false,
      })

      if (latest == null) {
        throw ERR_NOT_FOUND({
          message: 'document not found',
          details: { documentId: params.documentId },
        }).log(ctx.logger)
      }

      const hookCtx = {
        documentId: params.documentId,
        collectionPath,
        // The non-reconstructed envelope carries the locale-resolved `path`
        // projection. Capture it before the path row becomes inactive so
        // delete hooks can purge the specific document/URL.
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
      //    accountable (docs/07-auth-and-security/02-auditability.md).
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

      // 4-5. Both post-commit hook families get an independent attempt. A tree
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
