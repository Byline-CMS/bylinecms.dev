/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_NOT_FOUND, ERR_VALIDATION } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { getDefaultStatus } from '../../workflow/workflow.js'
import { applyRichTextEmbed } from '../document-lifecycle/internals.js'
import { mergeLocaleData } from '../document-lifecycle/merge-locale-data.js'
import { persistExistingDocumentVersion } from '../document-lifecycle/persistence.js'
import { authorizeSingletonUpdate, commitSingletonSave } from './internals.js'
import type { DocumentLifecycleContext } from '../document-lifecycle/context.js'
import type { SingletonSaveResult } from './internals.js'

export interface CopySingletonToLocaleParams {
  sourceLocale: string
  targetLocale: string
  overwrite: boolean
}

/** Copy localized singleton fields to another locale on the mapped document. */
export async function copySingletonToLocale(
  ctx: DocumentLifecycleContext,
  params: CopySingletonToLocaleParams
): Promise<SingletonSaveResult> {
  return withLogContext(
    { domain: 'services', module: 'singleton-lifecycle', function: 'copySingletonToLocale' },
    async () => {
      const definition = authorizeSingletonUpdate(ctx)
      if (params.sourceLocale === params.targetLocale) {
        throw ERR_VALIDATION({
          message: 'sourceLocale and targetLocale must differ',
          details: { sourceLocale: params.sourceLocale, targetLocale: params.targetLocale },
        }).log(ctx.logger)
      }
      return commitSingletonSave({
        ctx,
        definition,
        operation: { type: 'copyToLocale', ...params },
        prepare: async (slot) => {
          if (slot.documentId == null || slot.currentVersion == null) {
            throw ERR_NOT_FOUND({
              message: `singleton '${ctx.collectionPath}' has not been saved`,
              details: { singletonPath: ctx.collectionPath },
            }).log(ctx.logger)
          }
          const source = await ctx.db.queries.documents.getDocumentById({
            collection_id: ctx.collectionId,
            document_id: slot.documentId,
            locale: params.sourceLocale,
            reconstruct: true,
            lenient: true,
            onMissingLocale: 'omit',
            requestContext: ctx.requestContext,
          })
          if (source == null) {
            throw ERR_NOT_FOUND({
              message: 'singleton not found in source locale',
              details: { singletonPath: ctx.collectionPath, sourceLocale: params.sourceLocale },
            }).log(ctx.logger)
          }
          const existingTarget = await ctx.db.queries.documents.getDocumentById({
            collection_id: ctx.collectionId,
            document_id: slot.documentId,
            locale: params.targetLocale,
            reconstruct: true,
            lenient: true,
            onMissingLocale: 'omit',
            requestContext: ctx.requestContext,
          })
          const target =
            existingTarget ??
            (await ctx.db.queries.documents.getDocumentById({
              collection_id: ctx.collectionId,
              document_id: slot.documentId,
              locale: params.targetLocale,
              reconstruct: true,
              lenient: true,
              requestContext: ctx.requestContext,
            }))
          if (target == null) {
            throw ERR_NOT_FOUND({
              message: 'mapped singleton document not found',
              details: { singletonPath: ctx.collectionPath, documentId: slot.documentId },
            }).log(ctx.logger)
          }
          const sourceFields =
            ((source as Record<string, any>).fields as Record<string, any> | undefined) ?? {}
          const targetFields =
            ((target as Record<string, any>).fields as Record<string, any> | undefined) ?? {}
          const originalData =
            existingTarget == null
              ? null
              : (((existingTarget as Record<string, any>).fields as
                  | Record<string, any>
                  | undefined) ?? {})
          const merged = mergeLocaleData(
            definition.fields,
            sourceFields,
            targetFields,
            params.overwrite
          )

          return {
            data: merged.data,
            originalData,
            locale: params.targetLocale,
            write: async () => {
              await applyRichTextEmbed(ctx, merged.data)
              return persistExistingDocumentVersion(ctx, {
                documentId: slot.documentId as string,
                action: 'copy_to_locale',
                documentData: merged.data,
                status: getDefaultStatus(definition),
                locale: params.targetLocale,
                previousVersionId: slot.currentVersion?.document_version_id,
              })
            },
          }
        },
      })
    }
  )
}
