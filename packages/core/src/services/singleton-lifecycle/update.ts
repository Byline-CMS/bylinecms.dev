/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { resolveHooks } from '../../@types/index.js'
import {
  DbErrorCodes,
  ERR_DOCUMENT_STALE,
  ERR_NOT_FOUND,
  ERR_VALIDATION,
} from '../../lib/errors.js'
import {
  documentRevisionFromDatabase,
  parseDocumentRevision,
} from '../../storage/document-revision.js'
import { normaliseDateFields } from '../../utils/normalise-dates.js'
import { getDefaultStatus } from '../../workflow/workflow.js'
import { assignCounterValues } from '../assign-counter-values.js'
import { runCommittedDocumentHook } from '../document-lifecycle/committed-hook.js'
import {
  applyRichTextEmbed,
  extractDocumentId,
  extractVersionId,
} from '../document-lifecycle/internals.js'
import {
  persistExistingDocumentVersion,
  persistInitialDocumentVersion,
} from '../document-lifecycle/persistence.js'
import { assertLifecycleTransactionOwnership } from '../document-lifecycle/revision-guard.js'
import { normalizeNumericFields } from '../normalize-numeric-fields.js'
import { authorizeSingletonUpdate } from './internals.js'
import type {
  BeforeSingletonSaveContext,
  DocumentRevisionReceipt,
  SingletonSavePrecondition,
} from '../../@types/index.js'
import type { DocumentLifecycleContext } from '../document-lifecycle/context.js'
import type { SingletonSaveResult } from './internals.js'

export type UpdateSingletonParams = SingletonSavePrecondition & {
  data: Record<string, any>
  locale?: string
}
export type UpdateSingletonResult = SingletonSaveResult & DocumentRevisionReceipt

/** Prepare outside locks; recheck the observed slot/document under S → D before committing. */
export async function updateSingleton(
  ctx: DocumentLifecycleContext,
  params: UpdateSingletonParams
): Promise<UpdateSingletonResult> {
  params = { ...params }
  const definition = authorizeSingletonUpdate(ctx)
  assertLifecycleTransactionOwnership(ctx)
  const expectedEmpty = params.expectedState === 'empty'
  if (expectedEmpty && params.expectedRevision !== undefined)
    throw ERR_VALIDATION({ message: 'Specify an empty slot or a document revision, not both' })
  if (params.expectedState !== undefined && !expectedEmpty)
    throw ERR_VALIDATION({ message: 'Invalid singleton slot expectation' })
  const expectedRevision = expectedEmpty
    ? undefined
    : parseDocumentRevision(params.expectedRevision)
  const locale = params.locale ?? ctx.defaultLocale
  const staleSlot = () =>
    ERR_DOCUMENT_STALE({
      message: 'This singleton has changed. Reload it before saving.',
      details: {
        reason: 'singleton_slot_changed',
        singletonPath: ctx.collectionPath,
        expectedState: 'empty',
        currentState: 'document',
      },
    })
  const observed = await ctx.db.withReadSnapshot(async (queries) => {
    const documentId = await queries.singletons.getMappedDocumentId(ctx.collectionId)
    if (expectedEmpty && documentId !== null) throw staleSlot()
    if (!expectedEmpty && documentId === null)
      throw ERR_NOT_FOUND({ message: 'Singleton document is unavailable' })
    if (documentId === null) return { documentId: null, current: null, revision: undefined }
    const current = await queries.documents.getDocumentById({
      collection_id: ctx.collectionId,
      document_id: documentId,
      locale,
      reconstruct: true,
      readMode: 'any',
      lenient: true,
    })
    if (current === null) throw ERR_NOT_FOUND({ message: 'Singleton document is unavailable' })
    const revision = documentRevisionFromDatabase(
      await queries.documents.getDocumentRevision({
        collection_id: ctx.collectionId,
        document_id: documentId,
      })
    )
    if (revision !== expectedRevision)
      throw ERR_DOCUMENT_STALE({
        message: 'This singleton has changed. Reload it before saving.',
        details: {
          reason: 'revision_mismatch',
          documentId,
          expectedRevision: expectedRevision!,
          currentRevision: revision,
        },
      })
    return { documentId, current, revision }
  })
  if (expectedEmpty && locale !== ctx.defaultLocale)
    throw ERR_VALIDATION({
      message: `A singleton's first save must use the default content locale ('${ctx.defaultLocale}')`,
    })
  const previousVersionId = observed.current?.document_version_id as string | undefined
  const data = params.data
  const originalData = observed.current?.fields ?? null
  normaliseDateFields(data)
  normalizeNumericFields(definition.fields, data)
  const hooks = await resolveHooks(definition)
  const before: BeforeSingletonSaveContext = {
    data,
    originalData,
    singletonPath: ctx.collectionPath,
    locale,
    requestContext: ctx.requestContext!,
    isInitialSave: expectedEmpty,
    operation: { type: 'save' },
    documentId: observed.documentId,
  }
  const beforeHooks =
    hooks?.beforeSave == null
      ? []
      : Array.isArray(hooks.beforeSave)
        ? hooks.beforeSave
        : [hooks.beforeSave]
  for (const hook of beforeHooks) await hook(before)
  normalizeNumericFields(definition.fields, data)
  await assignCounterValues({
    fields: definition.fields,
    data,
    previousData: originalData ?? undefined,
    counters: ctx.db.commands.counters,
  })
  await applyRichTextEmbed(ctx, data)

  const committed = await ctx.db.withTransaction(async () => {
    await ctx.db.commands.singletons.lockSlot(ctx.collectionId)
    const mappedDocumentId = await ctx.db.queries.singletons.getMappedDocumentId(ctx.collectionId)
    if (expectedEmpty && mappedDocumentId !== null) throw staleSlot()
    if (mappedDocumentId !== observed.documentId)
      throw ERR_NOT_FOUND({ message: 'Singleton document mapping changed; reload before saving' })
    const locked =
      mappedDocumentId === null
        ? null
        : (
            await ctx.db.revisions.lock([
              {
                documentId: mappedDocumentId,
                collectionId: ctx.collectionId,
                expectedRevision: expectedRevision!,
                previousVersionId,
                locale,
              },
            ])
          )[0]!
    const write = { documentData: data, status: getDefaultStatus(definition), locale }
    const result =
      mappedDocumentId === null
        ? await persistInitialDocumentVersion(ctx, {
            ...write,
            action: 'create',
            path: crypto.randomUUID(),
          })
        : await persistExistingDocumentVersion(ctx, {
            ...write,
            action: 'update',
            documentId: mappedDocumentId,
            previousVersionId,
          })
    const documentId = extractDocumentId(result.document)
    const documentVersionId = extractVersionId(result.document)
    if (!documentId || !documentVersionId)
      throw new Error('Singleton persistence returned no document/version identity')
    if (mappedDocumentId === null) {
      try {
        await ctx.db.commands.singletons.setMapping(ctx.collectionId, documentId)
      } catch (error) {
        if (ctx.db.classifyError?.(error).code === DbErrorCodes.UNIQUE_VIOLATION) throw staleSlot()
        throw error
      }
    }
    const revision = locked === null ? 1 : (await ctx.db.revisions.advance(locked)).revision
    return { documentId, documentVersionId, revision }
  })
  await runCommittedDocumentHook(ctx, { phase: 'afterSave', ...committed }, async () => {
    const afterHooks =
      hooks?.afterSave == null
        ? []
        : Array.isArray(hooks.afterSave)
          ? hooks.afterSave
          : [hooks.afterSave]
    for (const hook of afterHooks)
      await hook({
        ...before,
        documentId: committed.documentId,
        documentVersionId: committed.documentVersionId,
      })
  })
  return committed
}
