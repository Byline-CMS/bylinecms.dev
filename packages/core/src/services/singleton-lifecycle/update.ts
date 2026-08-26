/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_CONFLICT, ERR_VALIDATION } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { normaliseDateFields } from '../../utils/normalise-dates.js'
import { getDefaultStatus } from '../../workflow/workflow.js'
import { assignCounterValues } from '../assign-counter-values.js'
import { applyRichTextEmbed } from '../document-lifecycle/internals.js'
import {
  persistExistingDocumentVersion,
  persistInitialDocumentVersion,
} from '../document-lifecycle/persistence.js'
import { normalizeNumericFields } from '../normalize-numeric-fields.js'
import { authorizeSingletonUpdate, commitSingletonSave } from './internals.js'
import type { DocumentLifecycleContext } from '../document-lifecycle/context.js'
import type { SingletonSaveResult } from './internals.js'

export interface UpdateSingletonParams {
  data: Record<string, any>
  locale?: string
  expectedVersionId?: string
}

/** Materialise or update a singleton slot as one immutable document version. */
export async function updateSingleton(
  ctx: DocumentLifecycleContext,
  params: UpdateSingletonParams
): Promise<SingletonSaveResult> {
  return withLogContext(
    { domain: 'services', module: 'singleton-lifecycle', function: 'updateSingleton' },
    async () => {
      const definition = authorizeSingletonUpdate(ctx)
      const locale = params.locale ?? ctx.defaultLocale
      const data = params.data
      return commitSingletonSave({
        ctx,
        definition,
        operation: { type: 'save' },
        prepare: async (slot) => {
          if (slot.documentId == null && locale !== ctx.defaultLocale) {
            throw ERR_VALIDATION({
              message:
                `a singleton's first save must use the default content locale ` +
                `('${ctx.defaultLocale}'); received '${locale}'`,
              details: {
                singletonPath: ctx.collectionPath,
                defaultLocale: ctx.defaultLocale,
                providedLocale: locale,
              },
            }).log(ctx.logger)
          }
          if (params.expectedVersionId != null) {
            const currentVersionId = slot.currentVersion?.document_version_id
            if (currentVersionId !== params.expectedVersionId) {
              throw ERR_CONFLICT({
                message: 'singleton version conflict',
                details: {
                  singletonPath: ctx.collectionPath,
                  expectedVersionId: params.expectedVersionId,
                  currentVersionId: currentVersionId ?? null,
                },
              }).log(ctx.logger)
            }
          }

          const current =
            slot.documentId == null
              ? null
              : await ctx.db.queries.documents.getDocumentById({
                  collection_id: ctx.collectionId,
                  document_id: slot.documentId,
                  locale,
                  reconstruct: true,
                  lenient: true,
                  requestContext: ctx.requestContext,
                })
          if (slot.documentId != null && current == null) {
            throw ERR_CONFLICT({
              message: `singleton '${ctx.collectionPath}' could not reconstruct its mapped document`,
              details: { singletonPath: ctx.collectionPath, documentId: slot.documentId },
            }).log(ctx.logger)
          }
          const currentRecord = current as Record<string, any> | null
          const originalData = (currentRecord?.fields as Record<string, any> | undefined) ?? null

          normaliseDateFields(data)
          normalizeNumericFields(definition.fields, data)

          return {
            data,
            originalData,
            locale,
            write: async () => {
              normalizeNumericFields(definition.fields, data)
              await assignCounterValues({
                fields: definition.fields,
                data,
                previousData: originalData ?? undefined,
                counters: ctx.db.commands.counters,
              })
              await applyRichTextEmbed(ctx, data)

              if (slot.documentId == null) {
                return persistInitialDocumentVersion(ctx, {
                  action: 'create',
                  documentData: data,
                  path: crypto.randomUUID(),
                  status: getDefaultStatus(definition),
                  locale,
                })
              }
              return persistExistingDocumentVersion(ctx, {
                documentId: slot.documentId,
                action: 'update',
                documentData: data,
                status: getDefaultStatus(definition),
                locale,
                previousVersionId: slot.currentVersion?.document_version_id,
              })
            },
          }
        },
      })
    }
  )
}
