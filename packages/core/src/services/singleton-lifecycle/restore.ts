/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_INVALID_TRANSITION, ERR_NOT_FOUND, ERR_VALIDATION } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { getDefaultStatus } from '../../workflow/workflow.js'
import { applyRichTextEmbed } from '../document-lifecycle/internals.js'
import { persistExistingDocumentVersion } from '../document-lifecycle/persistence.js'
import { authorizeSingletonUpdate, commitSingletonSave } from './internals.js'
import type { DocumentLifecycleContext } from '../document-lifecycle/context.js'
import type { SingletonSaveResult } from './internals.js'

/** Restore one historical singleton version as the new current version. */
export async function restoreSingletonVersion(
  ctx: DocumentLifecycleContext,
  params: { sourceVersionId: string; expectedRevision: number }
): Promise<SingletonSaveResult> {
  params = { ...params }
  return withLogContext(
    { domain: 'services', module: 'singleton-lifecycle', function: 'restoreSingletonVersion' },
    async () => {
      const definition = authorizeSingletonUpdate(ctx)
      return commitSingletonSave({
        ctx,
        definition,
        expectedRevision: params.expectedRevision,
        operation: { type: 'restore', sourceVersionId: params.sourceVersionId },
        prepare: async (slot) => {
          if (slot.documentId == null || slot.currentVersion == null) {
            throw ERR_NOT_FOUND({
              message: `singleton '${ctx.collectionPath}' has not been saved`,
              details: { singletonPath: ctx.collectionPath },
            }).log(ctx.logger)
          }
          const source = await ctx.db.queries.documents.getDocumentByVersion({
            document_version_id: params.sourceVersionId,
            collection_id: ctx.collectionId,
            locale: 'all',
          })
          if (source == null) {
            throw ERR_NOT_FOUND({
              message: 'source version not found',
              details: { sourceVersionId: params.sourceVersionId },
            }).log(ctx.logger)
          }
          const sourceRecord = source as Record<string, any>
          if (sourceRecord.document_id !== slot.documentId) {
            throw ERR_VALIDATION({
              message: 'source version does not belong to the singleton document',
              details: {
                singletonPath: ctx.collectionPath,
                sourceVersionId: params.sourceVersionId,
                sourceDocumentId: sourceRecord.document_id,
              },
            }).log(ctx.logger)
          }
          if (slot.currentVersion.document_version_id === params.sourceVersionId) {
            throw ERR_INVALID_TRANSITION({
              message: 'source version is already the current singleton version',
              details: {
                singletonPath: ctx.collectionPath,
                sourceVersionId: params.sourceVersionId,
              },
            }).log(ctx.logger)
          }
          const current = await ctx.db.queries.documents.getDocumentById({
            collection_id: ctx.collectionId,
            document_id: slot.documentId,
            locale: 'all',
            reconstruct: true,
          })
          if (current == null) {
            throw ERR_NOT_FOUND({
              message: 'current singleton version not found',
              details: { singletonPath: ctx.collectionPath, documentId: slot.documentId },
            }).log(ctx.logger)
          }
          const data = (sourceRecord.fields as Record<string, any> | undefined) ?? {}
          const originalData =
            ((current as Record<string, any>).fields as Record<string, any> | undefined) ?? {}

          return {
            data,
            originalData,
            locale: 'all',
            prepareWrite: () => applyRichTextEmbed(ctx, data),
            write: async () => {
              return persistExistingDocumentVersion(ctx, {
                documentId: slot.documentId as string,
                action: 'restore',
                documentData: data,
                status: getDefaultStatus(definition),
                locale: 'all',
                previousVersionId: slot.currentVersion?.document_version_id,
              })
            },
          }
        },
      })
    }
  )
}
