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
import { applyRichTextEmbed, extractVersionId, invokeHook } from './internals.js'
import { mergeLocaleData } from './merge-locale-data.js'
import type { DocumentLifecycleContext } from './context.js'

export interface CopyToLocaleResult {
  documentId: string
  documentVersionId: string
  /** Source locale read for the copy. */
  sourceLocale: string
  /** Target locale into which the source's localized leaves were written. */
  targetLocale: string
  /**
   * Number of localized field values copied from source to target. Useful
   * for UI toasts ("Copied 4 fields from EN to FR"). A zero result means
   * the source had no localized content to copy into the target under the
   * chosen merge rule (e.g. `overwrite: false` and target was already
   * fully populated).
   */
  fieldsUpdated: number
}

/**
 * Copy a document's content from one locale into another, in place on
 * the same document.
 *
 * Reads the source and target locales separately (the storage layer
 * resolves localized fields to flat single-locale shapes when given a
 * specific `resolveLocale`). A schema-aware merge walker decides, leaf
 * by leaf, whether to take the source's value or keep the target's,
 * driven by the `overwrite` flag. The merged tree is written via
 * `createDocumentVersion({ action: 'copy_to_locale', locale: target })`
 * — the existing cross-locale carry-forward in the storage primitive
 * preserves every *other* locale's rows untouched.
 *
 * Non-localized fields are never altered by this operation: they live
 * on `locale: 'all'` rows and the merge walker passes the target's
 * value through so the write does not blank them.
 *
 * Path is sticky and lives on default-locale only; this operation never
 * touches `byline_document_paths`. Status resets to the workflow
 * default — translations land as drafts.
 *
 * Flow:
 *   1. `assertActorCanPerform('update')` — same gate as a translation save.
 *   2. Reject if `sourceLocale === targetLocale`.
 *   3. Fetch source via `getDocumentById({ locale: sourceLocale })`.
 *   4. Fetch target via `getDocumentById({ locale: targetLocale })`.
 *   5. `mergeLocaleData(definition.fields, source.fields, target.fields, overwrite)`.
 *   6. `hooks.beforeUpdate({ data, originalData, collectionPath, copyToLocale })`.
 *   7. `createDocumentVersion({ documentId, action: 'copy_to_locale',
 *      locale: targetLocale, documentData, previousVersionId, status })`.
 *   8. `hooks.afterUpdate({ ..., copyToLocale })`.
 */
export async function copyToLocale(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    sourceLocale: string
    targetLocale: string
    overwrite: boolean
  }
): Promise<CopyToLocaleResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'copyToLocale' },
    async () => {
      const { db, definition, collectionId, collectionPath } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'update')

      if (params.sourceLocale === params.targetLocale) {
        throw ERR_VALIDATION({
          message: 'sourceLocale and targetLocale must differ',
          details: {
            documentId: params.documentId,
            sourceLocale: params.sourceLocale,
            targetLocale: params.targetLocale,
          },
        }).log(ctx.logger)
      }

      // 1. Source read.
      const source = await db.queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: params.documentId,
        locale: params.sourceLocale,
        reconstruct: true,
        lenient: true,
        requestContext: ctx.requestContext,
      })

      if (source == null) {
        throw ERR_NOT_FOUND({
          message: 'document not found in source locale',
          details: {
            documentId: params.documentId,
            sourceLocale: params.sourceLocale,
            collectionPath,
          },
        }).log(ctx.logger)
      }

      // 2. Target read — needed for both originalData (hooks) and to
      //    preserve non-localized values + structural shape.
      const target = await db.queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: params.documentId,
        locale: params.targetLocale,
        reconstruct: true,
        lenient: true,
        requestContext: ctx.requestContext,
      })

      if (target == null) {
        throw ERR_NOT_FOUND({
          message: 'document not found in target locale',
          details: {
            documentId: params.documentId,
            targetLocale: params.targetLocale,
            collectionPath,
          },
        }).log(ctx.logger)
      }

      const sourceRecord = source as Record<string, any>
      const targetRecord = target as Record<string, any>
      const sourceFields: Record<string, any> = sourceRecord.fields ?? {}
      const targetFields: Record<string, any> = targetRecord.fields ?? {}

      // 3. Merge.
      const merged = mergeLocaleData(
        definition.fields,
        sourceFields,
        targetFields,
        params.overwrite
      )

      // 4. Hooks see the target-locale view as originalData (consistent
      //    with how updateDocument scopes originalData to the active
      //    locale) and the merged payload as the next `data`.
      const hooks = await resolveHooks(definition)
      const copyToLocaleMarker = {
        sourceLocale: params.sourceLocale,
        targetLocale: params.targetLocale,
      }
      await invokeHook(hooks?.beforeUpdate, {
        data: merged.data,
        originalData: targetFields,
        collectionPath,
        copyToLocale: copyToLocaleMarker,
      })

      // 5. Write. previousVersionId threads the current version id so the
      //    storage primitive's cross-locale carry-forward fires for every
      //    *other* locale (not source, not target — those rows are
      //    rewritten by this call).
      const previousVersionId =
        (targetRecord.document_version_id as string | undefined) ?? undefined

      await applyRichTextEmbed(ctx, merged.data)

      const writeResult = await db.commands.documents.createDocumentVersion({
        documentId: params.documentId,
        collectionId,
        collectionVersion: ctx.collectionVersion,
        collectionConfig: definition,
        action: 'copy_to_locale',
        documentData: merged.data,
        status: getDefaultStatus(definition),
        locale: params.targetLocale,
        previousVersionId,
      })

      const documentVersionId = extractVersionId(writeResult.document)

      await invokeHook(hooks?.afterUpdate, {
        data: merged.data,
        originalData: targetFields,
        collectionPath,
        documentId: params.documentId,
        documentVersionId,
        // Path is sticky and source-locale-anchored; copy-to-locale never
        // touches it. Read it off the target envelope.
        path: (targetRecord.path as string) ?? '',
        copyToLocale: copyToLocaleMarker,
      })

      return {
        documentId: params.documentId,
        documentVersionId,
        sourceLocale: params.sourceLocale,
        targetLocale: params.targetLocale,
        fieldsUpdated: merged.fieldsUpdated,
      }
    }
  )
}
