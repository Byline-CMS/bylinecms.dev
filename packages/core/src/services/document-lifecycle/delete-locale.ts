/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { ERR_NOT_FOUND, ERR_VALIDATION } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { getDefaultStatus } from '../../workflow/workflow.js'
import { actorId, invokeHook } from './internals.js'
import type { DocumentLifecycleContext } from './context.js'

export interface DeleteLocaleResult {
  documentId: string
  /** The newly-created version that omits the deleted locale's content. */
  documentVersionId: string
  /** The content locale that was removed. */
  locale: string
}

/**
 * Remove one content locale's data from a document, in place on the same
 * document, by writing a new immutable version that omits that locale's
 * store rows (every other locale and all non-localized `'all'` rows are
 * carried forward by the storage primitive).
 *
 * The default content locale is the document's anchor (path + source_locale)
 * and can never be removed — rejected up front. The new version lands as the
 * workflow's default status (a fresh draft), exactly like `copyToLocale`: the
 * previously-published version keeps serving — including the locale being
 * removed — until the new version is reviewed and published. The deletion is
 * recoverable: the prior version still holds the locale, so restoring it
 * brings the content back.
 *
 * Flow:
 *   1. `assertActorCanPerform('update')` — removing a translation is an edit.
 *   2. Reject `locale === defaultLocale`.
 *   3. Read the document in the target locale (validates existence; supplies
 *      `originalData` for hooks and the availability set for the presence
 *      check).
 *   4. Reject when the locale has no content to delete.
 *   5. `hooks.beforeUpdate({ …, deleteLocale: { locale } })`.
 *   6. `db.commands.documents.deleteDocumentLocale({ …, status: default })`.
 *   7. `hooks.afterUpdate({ …, deleteLocale: { locale } })`.
 */
export async function deleteLocale(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    locale: string
  }
): Promise<DeleteLocaleResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'deleteLocale' },
    async () => {
      const { db, definition, collectionId, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'update')

      // The default locale anchors the document's path and source_locale —
      // it cannot be deleted (the other locales fall back to it).
      if (params.locale === defaultLocale) {
        throw ERR_VALIDATION({
          message: `cannot delete the default content locale ('${defaultLocale}')`,
          details: { documentId: params.documentId, locale: params.locale, collectionPath },
        }).log(ctx.logger)
      }

      // Read the document in the locale being removed — validates existence,
      // supplies originalData for hooks, and the availability set for the
      // content-presence check below.
      const target = await db.queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: params.documentId,
        locale: params.locale,
        reconstruct: true,
        lenient: true,
        requestContext: ctx.requestContext,
      })

      if (target == null) {
        throw ERR_NOT_FOUND({
          message: 'document not found',
          details: { documentId: params.documentId, collectionPath },
        }).log(ctx.logger)
      }

      const targetRecord = target as Record<string, any>
      // `_availableVersionLocales` is the derived (path-coverage) set; it is
      // the same source the editor's Delete-Locale picker is built from, so a
      // locale offered in the UI resolves here. A partially-translated locale
      // that never reached full coverage is not deletable through this path.
      const available: string[] = targetRecord._availableVersionLocales ?? []
      if (!available.includes(params.locale)) {
        throw ERR_NOT_FOUND({
          message: `locale '${params.locale}' has no content to delete`,
          details: { documentId: params.documentId, locale: params.locale, collectionPath },
        }).log(ctx.logger)
      }

      const hooks = await resolveHooks(definition)
      const deleteLocaleMarker = { locale: params.locale }
      const originalData: Record<string, any> = targetRecord.fields ?? {}

      await invokeHook(hooks?.beforeUpdate, {
        data: originalData,
        originalData,
        collectionPath,
        deleteLocale: deleteLocaleMarker,
      })

      const result = await db.commands.documents.deleteDocumentLocale({
        documentId: params.documentId,
        locale: params.locale,
        status: getDefaultStatus(definition),
        createdBy: actorId(ctx),
      })

      if (result == null) {
        throw ERR_NOT_FOUND({
          message: 'document not found',
          details: { documentId: params.documentId, collectionPath },
        }).log(ctx.logger)
      }

      await invokeHook(hooks?.afterUpdate, {
        data: originalData,
        originalData,
        collectionPath,
        documentId: params.documentId,
        documentVersionId: result.newVersionId,
        // Path is sticky and source-locale-anchored; deleting a translation
        // never touches it. Read it off the target envelope.
        path: (targetRecord.path as string) ?? '',
        deleteLocale: deleteLocaleMarker,
      })

      return {
        documentId: params.documentId,
        documentVersionId: result.newVersionId,
        locale: params.locale,
      }
    }
  )
}
