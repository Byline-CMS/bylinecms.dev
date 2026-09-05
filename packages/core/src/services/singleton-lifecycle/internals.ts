/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { ERR_DOCUMENT_STALE, ERR_NOT_FOUND, ERR_VALIDATION } from '../../lib/errors.js'
import {
  documentRevisionFromDatabase,
  parseDocumentRevision,
} from '../../storage/document-revision.js'
import { runCommittedDocumentHook } from '../document-lifecycle/committed-hook.js'
import { extractDocumentId, extractVersionId } from '../document-lifecycle/internals.js'
import {
  assertLifecycleTransactionOwnership,
  commitGuardedDocumentMutation,
  readDocumentForMutation,
} from '../document-lifecycle/revision-guard.js'
import { sameDocumentData } from '../document-lifecycle/same-document-data.js'
import type {
  AfterSingletonSaveContext,
  BeforeSingletonSaveContext,
  IDocumentCommands,
  IDocumentQueries,
  SingletonDefinition,
  SingletonHookSlot,
  SingletonSaveOperation,
} from '../../@types/index.js'
import type { DocumentLifecycleContext } from '../document-lifecycle/context.js'

type VersionWriteResult = Awaited<ReturnType<IDocumentCommands['createDocumentVersion']>>
type CurrentVersionMetadata = NonNullable<
  Awaited<ReturnType<IDocumentQueries['getCurrentVersionMetadata']>>
>

export interface SingletonSaveResult {
  revision: number
  documentId: string
  documentVersionId: string
}

export interface LockedSingletonSlot {
  documentId: string | null
  currentVersion: CurrentVersionMetadata | null
}

interface PreparedSingletonSave {
  data: Record<string, any>
  originalData: Record<string, any> | null
  locale: string
  prepareWrite: () => Promise<void>
  write: () => Promise<VersionWriteResult>
}

interface CommittedSingletonSave extends SingletonSaveResult {
  afterSaveContext: AfterSingletonSaveContext
}

/**
 * Assert the kind-aware singleton update ability without touching storage.
 * The runtime kind guard keeps this internal service from becoming an
 * alternate write path for an ordinary collection.
 */
export function authorizeSingletonUpdate(ctx: DocumentLifecycleContext): SingletonDefinition {
  if (ctx.definition.singleton !== true) {
    throw ERR_VALIDATION({
      message: `singleton lifecycle requires a singleton definition; '${ctx.collectionPath}' is a collection`,
      details: { path: ctx.collectionPath, expectedKind: 'singleton' },
    }).log(ctx.logger)
  }
  assertActorCanPerform(ctx.requestContext, ctx.definition, 'update')
  return ctx.definition
}

/**
 * Resolve the mapped logical document id without running read authorization
 * or hooks. Client-facing callers must authorize before invoking this resolver.
 */
export function resolveSingletonDocumentId(ctx: DocumentLifecycleContext): Promise<string | null> {
  return ctx.db.queries.singletons.getMappedDocumentId(ctx.collectionId)
}

/** Prepare singleton restore/copy outside locks, then commit under S → D → P. */
export async function commitSingletonSave(params: {
  ctx: DocumentLifecycleContext
  definition: SingletonDefinition
  expectedRevision: number
  operation: SingletonSaveOperation
  prepare: (slot: LockedSingletonSlot) => Promise<PreparedSingletonSave>
}): Promise<SingletonSaveResult> {
  const { ctx, definition, operation } = params
  assertLifecycleTransactionOwnership(ctx)
  const expectedRevision = parseDocumentRevision(params.expectedRevision)
  const slot = await ctx.db.withReadSnapshot(async (queries) => {
    const documentId = await queries.singletons.getMappedDocumentId(ctx.collectionId)
    if (documentId === null) throw ERR_NOT_FOUND({ message: 'Singleton document is unavailable' })
    const currentVersion = await queries.documents.getCurrentVersionMetadata({
      collection_id: ctx.collectionId,
      document_id: documentId,
    })
    if (currentVersion === null)
      throw ERR_NOT_FOUND({ message: 'Singleton document is unavailable' })
    const currentRevision = documentRevisionFromDatabase(
      await queries.documents.getDocumentRevision({
        collection_id: ctx.collectionId,
        document_id: documentId,
      })
    )
    if (currentRevision !== expectedRevision)
      throw ERR_DOCUMENT_STALE({
        message: 'This singleton has changed. Reload before saving.',
        details: { reason: 'revision_mismatch', documentId, expectedRevision, currentRevision },
      })
    return { documentId, currentVersion }
  })
  const prepared = await params.prepare(slot)
  // The operation-specific locale/history reads must still belong to this observation.
  await readDocumentForMutation(ctx, {
    documentId: slot.documentId,
    expectedRevision,
    locale: prepared.locale,
    lenient: true,
  })
  const baseline = structuredClone(prepared.originalData)
  const hooks = await resolveHooks(definition)
  if (!ctx.requestContext)
    throw new Error('Singleton authorization completed without a request context')
  const beforeSaveContext: BeforeSingletonSaveContext = {
    data: prepared.data,
    originalData: prepared.originalData,
    singletonPath: ctx.collectionPath,
    locale: prepared.locale,
    requestContext: ctx.requestContext,
    isInitialSave: false,
    operation,
    documentId: slot.documentId,
  }
  await invokeSingletonHook(hooks?.beforeSave, beforeSaveContext)
  await prepared.prepareWrite()
  const committed = await commitGuardedDocumentMutation(
    ctx,
    {
      documentId: slot.documentId,
      expectedRevision,
      previousVersionId: slot.currentVersion.document_version_id,
      locale: prepared.locale,
    },
    async () => {
      if (
        operation.type === 'copyToLocale' &&
        baseline !== null &&
        sameDocumentData(prepared.data, baseline)
      ) {
        return {
          value: {
            documentId: slot.documentId,
            documentVersionId: slot.currentVersion.document_version_id,
          },
          changed: false,
        }
      }
      const writeResult = await prepared.write()
      const documentId = extractDocumentId(writeResult.document),
        documentVersionId = extractVersionId(writeResult.document)
      if (!documentId || !documentVersionId)
        throw new Error('Singleton persistence returned no document/version identity')
      return { value: { documentId, documentVersionId }, changed: true }
    }
  )
  const receipt = { ...committed.value, revision: committed.revision }
  await runCommittedDocumentHook(ctx, { phase: 'afterSave', ...receipt }, () =>
    invokeSingletonHook(hooks?.afterSave, { ...beforeSaveContext, ...committed.value })
  )
  return receipt
}

async function invokeSingletonHook<Ctx>(
  hook: SingletonHookSlot<Ctx> | undefined,
  context: Ctx
): Promise<void> {
  const hooks = hook == null ? [] : Array.isArray(hook) ? hook : [hook]
  for (const invoke of hooks) {
    await invoke(context)
  }
}
