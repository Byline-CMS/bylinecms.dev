/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { ERR_INVALID_TRANSITION, ERR_NOT_FOUND, ERR_VALIDATION } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { getDefaultStatus } from '../../workflow/workflow.js'
import {
  actorId,
  applyRichTextEmbed,
  extractDocumentId,
  extractVersionId,
  invokeHook,
} from './internals.js'
import type { DocumentLifecycleContext } from './context.js'

export interface RestoreVersionResult {
  documentId: string
  documentVersionId: string
  sourceVersionId: string
}

/**
 * Restore a historical document version as the new current version.
 *
 * Reads the source version with `locale: 'all'` so the entire multi-locale
 * field tree (with `_id` / `_type` meta inlined onto blocks and array items
 * by `reconstructFromUnifiedRows`) is captured. That tree is then re-emitted
 * through `createDocumentVersion` with `locale: 'all'`, which produces a
 * fresh version row with a new UUIDv7 id and the latest `created_at`. The
 * `current_documents` view (`ROW_NUMBER() OVER PARTITION BY document_id
 * ORDER BY created_at DESC`) automatically promotes the new row to current.
 *
 * Status is hard-defaulted to the workflow's first status — restoring an
 * old `published` version must never silently re-publish content. The user
 * runs the restored draft through the normal workflow.
 *
 * `path` is sticky from the previous current version (not from the source),
 * matching the semantics of `updateDocument`. A path change made between
 * the source and now should not be undone by the restore.
 *
 * Auth reuses the `update` ability — restore is conceptually an edit
 * against an existing document.
 *
 * Hooks: fires `beforeUpdate` / `afterUpdate` with a `restore: { sourceVersionId }`
 * field on the context. Userland hooks that need to react differently
 * (e.g. tag the audit entry, skip search re-index) can branch on its
 * presence.
 *
 * Flow:
 *   1. Auth: `update` ability.
 *   2. Read source version with `locale: 'all'`.
 *   3. Validate source belongs to `documentId` (defence against forged
 *      cross-document version ids).
 *   4. Read current version metadata; reject if the source IS already the
 *      current version (nothing to restore).
 *   5. Read current document with reconstruction for hook `originalData`.
 *   6. `hooks.beforeUpdate({ data, originalData, collectionPath, restore })`
 *   7. `db.commands.documents.createDocumentVersion(...)` with
 *      `action: 'restore'`, `locale: 'all'`, sticky path, default status.
 *   8. `hooks.afterUpdate({ ..., restore })`
 */
export async function restoreDocumentVersion(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    sourceVersionId: string
  }
): Promise<RestoreVersionResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'restoreDocumentVersion' },
    async () => {
      const { db, definition, collectionId, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'update')
      const hooks = await resolveHooks(definition)

      // 1. Read source version (full multi-locale tree).
      const source = await db.queries.documents.getDocumentByVersion({
        document_version_id: params.sourceVersionId,
        locale: 'all',
      })

      if (source == null) {
        throw ERR_NOT_FOUND({
          message: 'source version not found',
          details: { sourceVersionId: params.sourceVersionId },
        }).log(ctx.logger)
      }

      // 2. Cross-document forgery check.
      if ((source as Record<string, any>).document_id !== params.documentId) {
        throw ERR_VALIDATION({
          message: 'source version does not belong to the target document',
          details: {
            documentId: params.documentId,
            sourceVersionId: params.sourceVersionId,
            sourceDocumentId: (source as Record<string, any>).document_id,
          },
        }).log(ctx.logger)
      }

      // 3. Current version metadata — used both for the already-current
      //    guard and for the sticky path resolution.
      const currentMeta = await db.queries.documents.getCurrentVersionMetadata({
        collection_id: collectionId,
        document_id: params.documentId,
      })

      if (currentMeta == null) {
        throw ERR_NOT_FOUND({
          message: 'document not found',
          details: { documentId: params.documentId },
        }).log(ctx.logger)
      }

      if (currentMeta.document_version_id === params.sourceVersionId) {
        throw ERR_INVALID_TRANSITION({
          message: 'source version is already the current version of this document',
          details: {
            documentId: params.documentId,
            sourceVersionId: params.sourceVersionId,
          },
        }).log(ctx.logger)
      }

      // 4. originalData for hooks: full reconstruction of the current
      //    version (locale-scoped, matching updateDocument's semantics).
      const latest = await db.queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: params.documentId,
        locale: defaultLocale,
        reconstruct: true,
      })
      const originalData: Record<string, any> = (latest as Record<string, any>) ?? {}

      const sourceFields = (source as Record<string, any>).fields ?? {}
      const restoreContext = { sourceVersionId: params.sourceVersionId }

      // 5. beforeUpdate.
      await invokeHook(hooks?.beforeUpdate, {
        data: sourceFields,
        originalData,
        collectionPath,
        restore: restoreContext,
      })

      // Embed walker is a no-op here for localized richtext leaves
      // (multi-locale `{ locale: lexJson }` shape — see
      // richtext-embed.ts header). Non-localized richtext leaves still
      // get refreshed, so leave the call in for that branch.
      await applyRichTextEmbed(ctx, sourceFields)

      // 6. Persist new version. locale: 'all' carries every locale row in
      //    the source tree forward in a single flatten pass — the
      //    cross-locale carry-forward branch in createDocumentVersion does
      //    not fire when locale === 'all'.
      //
      // No `path` is passed: restore does not change the document's path
      // (the existing byline_document_paths row stays as-is — sticky).
      const result = await db.commands.documents.createDocumentVersion({
        documentId: params.documentId,
        collectionId,
        collectionVersion: ctx.collectionVersion,
        collectionConfig: definition,
        action: 'restore',
        documentData: sourceFields,
        status: getDefaultStatus(definition),
        locale: 'all',
        previousVersionId: currentMeta.document_version_id,
        createdBy: actorId(ctx),
      })

      const documentId = extractDocumentId(result.document) || params.documentId
      const documentVersionId = extractVersionId(result.document)

      // 7. afterUpdate. Restore is path-sticky: the canonical path comes
      //    from the current version's envelope (originalData), not the source.
      await invokeHook(hooks?.afterUpdate, {
        data: sourceFields,
        originalData,
        collectionPath,
        documentId,
        documentVersionId,
        path: (originalData.path as string) ?? '',
        restore: restoreContext,
      })

      return {
        documentId,
        documentVersionId,
        sourceVersionId: params.sourceVersionId,
      }
    }
  )
}
