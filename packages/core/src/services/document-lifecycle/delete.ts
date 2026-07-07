/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { ERR_NOT_FOUND } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { getUploadFields } from '../../utils/storage-utils.js'
import { AUDIT_ACTIONS, auditActor, requireAuditCapability } from './audit.js'
import { invokeHook } from './internals.js'
import { promoteChildrenAndRemove } from './tree.js'
import type { DocumentLifecycleContext } from './context.js'

export interface DeleteDocumentResult {
  deletedVersionCount: number
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
      const uploadFieldNames = getUploadFields(definition).map((f) => f.name)
      const isUploadCollection = uploadFieldNames.length > 0 && ctx.storage != null
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
      // the original file plus every persisted variant. Reading the
      // variants from the field value (rather than re-deriving from
      // `upload.sizes`) keeps cleanup correct even when the size set
      // changes between upload and delete.
      const storagePathsToDelete: string[] = []
      if (isUploadCollection) {
        for (const fieldName of uploadFieldNames) {
          const fieldValue = (latest as Record<string, any>)?.fields?.[fieldName]
          if (!fieldValue || typeof fieldValue !== 'object') continue
          if (typeof fieldValue.storagePath === 'string') {
            storagePathsToDelete.push(fieldValue.storagePath)
          }
          if (Array.isArray(fieldValue.variants)) {
            for (const variant of fieldValue.variants) {
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

      // 3. Soft-delete all versions, atomically with the audit record. A
      //    whole-document delete mints no new version, so the version stream
      //    never records it — the audit log is the only place a deletion is
      //    accountable (docs/06-auth-and-security/02-auditability.md). Storage-file cleanup (step 4) is a
      //    DB↔external side-effect and stays OUTSIDE the transaction — it is
      //    post-commit, best-effort compensation (docs/03-architecture/03-transactions.md).
      const audit = requireAuditCapability(db)
      const actor = auditActor(ctx)
      let deletedVersionCount = 0
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
      })

      // 4. Clean up storage files. Non-fatal: logs errors but does not throw.
      if (ctx.storage && storagePathsToDelete.length > 0) {
        for (const storagePath of storagePathsToDelete) {
          try {
            await ctx.storage.delete(storagePath)
          } catch (err: unknown) {
            logger.error({ err, storagePath }, 'failed to delete storage file')
          }
        }
      }

      // 5. Reconcile the document tree for `tree: true` collections. Byline
      //    deletes are soft (the document row survives), so the table's
      //    promote/cascade foreign keys never fire — promote the node's
      //    children to root and remove its edge here instead, firing the
      //    structural-change invalidation event. Post-commit and best-effort,
      //    like file cleanup: a failure here leaves the soft-delete intact
      //    (status-at-edge already hides the deleted node's subtree from
      //    reads) and is logged rather than thrown. See docs/04-collections/03-document-trees.md.
      if (definition.tree === true) {
        try {
          await promoteChildrenAndRemove(ctx, { documentId: params.documentId })
        } catch (err: unknown) {
          logger.error(
            { err, documentId: params.documentId },
            'failed to reconcile document tree on delete'
          )
        }
      }

      // 6. afterDelete hook.
      await invokeHook(hooks?.afterDelete, hookCtx)

      return { deletedVersionCount }
    }
  )
}
