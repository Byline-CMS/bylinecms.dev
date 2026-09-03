/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { DbErrorCodes, ERR_CONFLICT, ERR_VALIDATION } from '../../lib/errors.js'
import { runCommittedDocumentHook } from '../document-lifecycle/committed-hook.js'
import { extractDocumentId, extractVersionId } from '../document-lifecycle/internals.js'
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

/**
 * Coordinate one singleton version write under the registered-slot lock.
 * `prepare` runs after the mapping and current version have been read while
 * locked. The before hook and write remain inside the outer transaction; the
 * after hook cannot run until that transaction has committed.
 */
export async function commitSingletonSave(params: {
  ctx: DocumentLifecycleContext
  definition: SingletonDefinition
  operation: SingletonSaveOperation
  prepare: (slot: LockedSingletonSlot) => Promise<PreparedSingletonSave>
}): Promise<SingletonSaveResult> {
  const { ctx, definition, operation } = params
  const hooks = await resolveHooks(definition)
  const requestContext = ctx.requestContext
  if (requestContext == null) {
    throw new Error('singleton authorization completed without a request context')
  }

  const committed = await ctx.db.withTransaction<CommittedSingletonSave>(async () => {
    await ctx.db.commands.singletons.lockSlot(ctx.collectionId)
    const mappedDocumentId = await resolveSingletonDocumentId(ctx)
    const currentVersion =
      mappedDocumentId == null
        ? null
        : await ctx.db.queries.documents.getCurrentVersionMetadata({
            collection_id: ctx.collectionId,
            document_id: mappedDocumentId,
          })

    if (mappedDocumentId != null && currentVersion == null) {
      throw ERR_CONFLICT({
        message:
          `singleton '${ctx.collectionPath}' is mapped to a deleted or unavailable document; ` +
          'clear the mapping deliberately before rematerialising the slot',
        details: { singletonPath: ctx.collectionPath, documentId: mappedDocumentId },
      }).log(ctx.logger)
    }

    const slot = { documentId: mappedDocumentId, currentVersion }
    const prepared = await params.prepare(slot)
    const isInitialSave = mappedDocumentId == null
    const beforeSaveContext: BeforeSingletonSaveContext = {
      data: prepared.data,
      originalData: prepared.originalData,
      singletonPath: ctx.collectionPath,
      locale: prepared.locale,
      requestContext,
      isInitialSave,
      operation,
      documentId: mappedDocumentId,
    }
    await invokeSingletonHook(hooks?.beforeSave, beforeSaveContext)

    const writeResult = await prepared.write()
    const documentId = extractDocumentId(writeResult.document) || mappedDocumentId || ''
    const documentVersionId = extractVersionId(writeResult.document)
    if (documentId === '' || documentVersionId === '') {
      throw new Error('singleton persistence did not return document and version ids')
    }

    if (isInitialSave) {
      try {
        await ctx.db.commands.singletons.setMapping(ctx.collectionId, documentId)
      } catch (error) {
        if (ctx.db.classifyError?.(error)?.code === DbErrorCodes.UNIQUE_VIOLATION) {
          throw ERR_CONFLICT({
            message: `singleton '${ctx.collectionPath}' was materialised concurrently`,
            details: { singletonPath: ctx.collectionPath },
          }).log(ctx.logger)
        }
        throw error
      }
    }

    return {
      documentId,
      documentVersionId,
      afterSaveContext: {
        ...beforeSaveContext,
        documentId,
        documentVersionId,
      },
    }
  })

  await runCommittedDocumentHook(
    ctx,
    {
      phase: 'afterSave',
      documentId: committed.documentId,
      documentVersionId: committed.documentVersionId,
    },
    () => invokeSingletonHook(hooks?.afterSave, committed.afterSaveContext)
  )
  return {
    documentId: committed.documentId,
    documentVersionId: committed.documentVersionId,
  }
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
