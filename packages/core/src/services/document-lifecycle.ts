/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Document lifecycle service.
 *
 * Orchestrates CRUD operations and workflow transitions, invoking collection
 * hooks at the appropriate points. Sits between the API route layer and the
 * storage adapter (`IDbAdapter`) so that every operation path — POST, PUT,
 * PATCH, status change, unpublish — goes through a single set of hooks.
 *
 * Hook invocations run **outside** the storage transaction. They are suitable
 * for logging, cache invalidation, webhooks, and similar side-effects.
 *
 * This module depends only on `@byline/core` types and utilities — it has no
 * dependency on any specific database adapter.
 */

import {
  type CollectionDefinition,
  type CollectionHookSlot,
  type CollectionHooks,
  type IDbAdapter,
  type IStorageProvider,
  normalizeCollectionHook,
} from '../@types/index.js'
import { applyPatches } from '../patches/index.js'
import { normaliseDateFields } from '../utils/normalise-dates.js'
import { deriveVariantStoragePaths } from '../utils/storage-utils.js'
import { getDefaultStatus, getWorkflow, validateStatusTransition } from '../workflow/workflow.js'
import type { DocumentPatch, PatchError as PatchErrorInfo } from '../patches/index.js'

// ---------------------------------------------------------------------------
// Context shared by all lifecycle functions
// ---------------------------------------------------------------------------

/**
 * The shared context every lifecycle function requires. Built once per
 * request by the API route layer and passed through.
 */
export interface DocumentLifecycleContext {
  /** The database adapter returned by `getServerConfig().db`. */
  db: IDbAdapter
  /** The resolved `CollectionDefinition` (includes `hooks`). */
  definition: CollectionDefinition
  /** The database-level collection row ID. */
  collectionId: string
  /** The collection `path` string (e.g. `'docs'`, `'news'`). */
  collectionPath: string
  /**
   * Storage provider for this collection. Required for upload-enabled
   * collections so that file cleanup can be performed on document deletion.
   *
   * Resolved by the route layer as:
   *   `definition.upload?.storage ?? serverConfig.storage`
   *
   * Optional — existing callers that do not need file cleanup are unaffected.
   */
  storage?: IStorageProvider
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface CreateDocumentResult {
  documentId: string
  documentVersionId: string
}

export interface UpdateDocumentResult {
  documentId: string
  documentVersionId: string
}

export interface UpdateDocumentWithPatchesResult {
  documentId: string
  documentVersionId: string
}

export interface ChangeStatusResult {
  previousStatus: string
  newStatus: string
}

export interface UnpublishResult {
  archivedCount: number
}

export interface DeleteDocumentResult {
  deletedVersionCount: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Safely invoke an optional hook slot, awaiting the result if it returns a
 * Promise. When the slot is an array of functions they are executed
 * sequentially in order.
 */
async function invokeHook<Ctx>(hook: CollectionHookSlot<Ctx> | undefined, ctx: Ctx): Promise<void> {
  const fns = normalizeCollectionHook(hook)
  for (const fn of fns) {
    await fn(ctx)
  }
}

/** Extract `id` from the document object returned by `createDocumentVersion`. */
function extractVersionId(document: any): string {
  return document?.id ?? document?.document_version_id ?? ''
}

/** Extract the logical document id from the document object returned by `createDocumentVersion`. */
function extractDocumentId(document: any): string {
  return document?.document_id ?? ''
}

// ---------------------------------------------------------------------------
// Lifecycle functions
// ---------------------------------------------------------------------------

/**
 * Create a new document.
 *
 * Flow:
 *   1. `normaliseDateFields(data)`
 *   2. `hooks.beforeCreate({ data, collectionPath })`
 *   3. Auto-generate `path` from title (if missing)
 *   4. `db.commands.documents.createDocumentVersion(...)` (action = 'create')
 *   5. `hooks.afterCreate({ data, collectionPath, documentId, documentVersionId })`
 */
export async function createDocument(
  ctx: DocumentLifecycleContext,
  params: {
    data: Record<string, any>
    locale?: string
    status?: string
  }
): Promise<CreateDocumentResult> {
  const { db, definition, collectionId, collectionPath } = ctx
  const hooks: CollectionHooks | undefined = definition.hooks
  const data = params.data

  normaliseDateFields(data)

  await invokeHook(hooks?.beforeCreate, { data, collectionPath })

  // Ensure path is present. If not, generate one from title or random UUID.
  if (!data.path) {
    if (data.title) {
      data.path = data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '')
    } else {
      data.path = crypto.randomUUID()
    }
  }

  const result = await db.commands.documents.createDocumentVersion({
    collectionId,
    collectionConfig: definition,
    action: 'create',
    documentData: data,
    path: data.path,
    status: params.status ?? data.status,
    locale: params.locale ?? 'en',
  })

  const documentId = extractDocumentId(result.document)
  const documentVersionId = extractVersionId(result.document)

  await invokeHook(hooks?.afterCreate, {
    data,
    collectionPath,
    documentId,
    documentVersionId,
  })

  return { documentId, documentVersionId }
}

/**
 * Update a document via full replacement (PUT semantics).
 *
 * Unlike the previous implementation, this now fetches the current version
 * from storage to provide a real `originalData` to hooks.
 *
 * Flow:
 *   1. Fetch current document via `getDocumentById({ reconstruct: true })`
 *   2. `normaliseDateFields(data)`
 *   3. `hooks.beforeUpdate({ data, originalData, collectionPath })`
 *   4. `db.commands.documents.createDocumentVersion(...)` (action = 'update')
 *   5. `hooks.afterUpdate({ data, originalData, collectionPath, documentId, documentVersionId })`
 */
export async function updateDocument(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    data: Record<string, any>
    locale?: string
  }
): Promise<UpdateDocumentResult> {
  const { db, definition, collectionId, collectionPath } = ctx
  const hooks: CollectionHooks | undefined = definition.hooks
  const data = params.data

  // Fetch the real original so hooks get accurate originalData (fixes the
  // PUT handler bug where originalData === data).
  const latest = await db.queries.documents.getDocumentById({
    collection_id: collectionId,
    document_id: params.documentId,
    locale: params.locale ?? 'en',
    reconstruct: true,
  })

  const originalData: Record<string, any> = (latest as Record<string, any>) ?? {}

  normaliseDateFields(data)

  await invokeHook(hooks?.beforeUpdate, { data, originalData, collectionPath })

  const defaultStatus = getDefaultStatus(definition)

  const result = await db.commands.documents.createDocumentVersion({
    documentId: params.documentId,
    collectionId,
    collectionConfig: definition,
    action: 'update',
    documentData: data,
    path: data.path ?? originalData.path ?? '/',
    status: defaultStatus,
    locale: params.locale ?? 'en',
  })

  const documentId = extractDocumentId(result.document) || params.documentId
  const documentVersionId = extractVersionId(result.document)

  await invokeHook(hooks?.afterUpdate, {
    data,
    originalData,
    collectionPath,
    documentId,
    documentVersionId,
  })

  return { documentId, documentVersionId }
}

/**
 * Update a document via patch application.
 *
 * Flow:
 *   1. Fetch current document via `getDocumentById({ reconstruct: true })`
 *   2. Optimistic concurrency check on `documentVersionId`
 *   3. `applyPatches(definition, originalData, patches)` → `nextData`
 *   4. `normaliseDateFields(nextData)`
 *   5. `hooks.beforeUpdate({ data: nextData, originalData, collectionPath })`
 *   6. `db.commands.documents.createDocumentVersion(...)` (action = 'update')
 *   7. `hooks.afterUpdate({ data: nextData, originalData, collectionPath, documentId, documentVersionId })`
 *
 * @throws {ConflictError} if the supplied `documentVersionId` does not match the current version.
 * @throws {PatchError} if `applyPatches` fails.
 */
export async function updateDocumentWithPatches(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    patches: DocumentPatch[]
    /** Client-supplied version ID for optimistic concurrency. */
    documentVersionId?: string
    locale?: string
  }
): Promise<UpdateDocumentWithPatchesResult> {
  const { db, definition, collectionId, collectionPath } = ctx
  const hooks: CollectionHooks | undefined = definition.hooks

  // 1. Fetch current document.
  const latest = await db.queries.documents.getDocumentById({
    collection_id: collectionId,
    document_id: params.documentId,
    locale: params.locale ?? 'en',
    reconstruct: true,
  })

  if (latest == null) {
    throw new DocumentNotFoundError(params.documentId)
  }

  const originalData = latest as Record<string, any>

  // 2. Optimistic concurrency check.
  if (params.documentVersionId && params.documentVersionId !== originalData.document_version_id) {
    throw new ConflictError(originalData.document_version_id, params.documentVersionId)
  }

  // 3. Apply patches.
  const { doc: patchedDocument, errors } = applyPatches(definition, originalData, params.patches)

  if (errors.length > 0) {
    throw new PatchApplicationError(errors)
  }

  const nextData = patchedDocument as Record<string, any>

  // 4. Normalise dates.
  normaliseDateFields(nextData)

  // 5. beforeUpdate hook.
  await invokeHook(hooks?.beforeUpdate, { data: nextData, originalData, collectionPath })

  // 6. Persist.
  const defaultStatus = getDefaultStatus(definition)

  const result = await db.commands.documents.createDocumentVersion({
    documentId: params.documentId,
    collectionId,
    collectionConfig: definition,
    action: 'update',
    documentData: nextData,
    path: nextData.path ?? originalData.path ?? '/',
    status: defaultStatus,
    locale: params.locale ?? 'en',
  })

  const documentId = extractDocumentId(result.document) || params.documentId
  const documentVersionId = extractVersionId(result.document)

  // 7. afterUpdate hook.
  await invokeHook(hooks?.afterUpdate, {
    data: nextData,
    originalData,
    collectionPath,
    documentId,
    documentVersionId,
  })

  return { documentId, documentVersionId }
}

/**
 * Change a document's workflow status.
 *
 * Flow:
 *   1. Fetch current document metadata
 *   2. Validate transition via `validateStatusTransition()`
 *   3. `hooks.beforeStatusChange({ documentId, documentVersionId, collectionPath, previousStatus, nextStatus })`
 *   4. `db.commands.documents.setDocumentStatus(...)` — in-place mutation
 *   5. Auto-archive: if transitioning to `'published'`, archive other published versions
 *   6. `hooks.afterStatusChange({ documentId, documentVersionId, collectionPath, previousStatus, nextStatus })`
 */
export async function changeDocumentStatus(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    nextStatus: string
    locale?: string
  }
): Promise<ChangeStatusResult> {
  const { db, definition, collectionId, collectionPath } = ctx
  const hooks: CollectionHooks | undefined = definition.hooks

  // 1. Fetch current document to read its status.
  const latest = await db.queries.documents.getDocumentById({
    collection_id: collectionId,
    document_id: params.documentId,
    locale: params.locale ?? 'en',
    reconstruct: false,
  })

  if (latest == null) {
    throw new DocumentNotFoundError(params.documentId)
  }

  const currentStatus: string = (latest as any).status ?? 'draft'
  const documentVersionId: string = (latest as any).document_version_id ?? ''

  // 2. Validate transition.
  const workflow = getWorkflow(definition)
  const result = validateStatusTransition(workflow, currentStatus, params.nextStatus)

  if (!result.valid) {
    throw new InvalidTransitionError(currentStatus, params.nextStatus, result.reason)
  }

  const hookCtx = {
    documentId: params.documentId,
    documentVersionId,
    collectionPath,
    previousStatus: currentStatus,
    nextStatus: params.nextStatus,
  }

  // 3. beforeStatusChange hook.
  await invokeHook(hooks?.beforeStatusChange, hookCtx)

  // 4. Mutate status in-place.
  await db.commands.documents.setDocumentStatus({
    document_version_id: documentVersionId,
    status: params.nextStatus,
  })

  // 5. Auto-archive previous published versions.
  if (params.nextStatus === 'published') {
    await db.commands.documents.archivePublishedVersions({
      document_id: params.documentId,
      excludeVersionId: documentVersionId,
    })
  }

  // 6. afterStatusChange hook.
  await invokeHook(hooks?.afterStatusChange, hookCtx)

  return { previousStatus: currentStatus, newStatus: params.nextStatus }
}

/**
 * Unpublish a document by archiving its published version(s).
 *
 * Flow:
 *   1. `hooks.beforeUnpublish({ documentId, collectionPath })`
 *   2. `db.commands.documents.archivePublishedVersions(...)`
 *   3. `hooks.afterUnpublish({ documentId, collectionPath, archivedCount })`
 */
export async function unpublishDocument(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
  }
): Promise<UnpublishResult> {
  const { db, collectionPath } = ctx
  const hooks: CollectionHooks | undefined = ctx.definition.hooks

  await invokeHook(hooks?.beforeUnpublish, {
    documentId: params.documentId,
    collectionPath,
  })

  const archivedCount = await db.commands.documents.archivePublishedVersions({
    document_id: params.documentId,
  })

  await invokeHook(hooks?.afterUnpublish, {
    documentId: params.documentId,
    collectionPath,
    archivedCount,
  })

  return { archivedCount }
}

/**
 * Soft-delete a document.
 *
 * Marks all versions of the document as deleted (`is_deleted = true`). The
 * `current_documents` view automatically filters deleted rows, so the
 * document disappears from all list / page queries without physically
 * removing data.
 *
 * For upload-enabled collections, when `ctx.storage` is provided, the
 * original uploaded file and all Sharp-generated variants are also removed
 * from storage after the DB soft-delete succeeds. File cleanup failures are
 * logged but are non-fatal — they do not cause the delete to fail.
 *
 * Flow:
 *   1. Fetch current document (reconstruct for upload collections to read field values)
 *   2. `hooks.beforeDelete({ documentId, collectionPath })`
 *   3. `db.commands.documents.softDeleteDocument({ document_id })`
 *   4. Storage file + variant cleanup (upload collections only, non-fatal)
 *   5. `hooks.afterDelete({ documentId, collectionPath })`
 */
export async function deleteDocument(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
  }
): Promise<DeleteDocumentResult> {
  const { db, collectionPath, definition } = ctx
  const hooks: CollectionHooks | undefined = definition.hooks

  // 1. Verify the document exists.
  //    For upload-enabled collections with storage, fetch with reconstruct: true
  //    so we can read the stored file path from the primary image/file field
  //    before the DB rows are deleted.
  const isUploadCollection = !!definition.upload && !!ctx.storage
  const latest = await db.queries.documents.getDocumentById({
    collection_id: ctx.collectionId,
    document_id: params.documentId,
    reconstruct: isUploadCollection,
  })

  if (latest == null) {
    throw new DocumentNotFoundError(params.documentId)
  }

  // Extract the primary file's storage_path before deletion.
  let primaryStoragePath: string | null = null
  if (isUploadCollection) {
    const primaryField = definition.fields.find((f) => f.type === 'image' || f.type === 'file')
    if (primaryField) {
      const fieldValue = (latest as Record<string, any>)[primaryField.name]
      if (
        fieldValue &&
        typeof fieldValue === 'object' &&
        typeof fieldValue.storage_path === 'string'
      ) {
        primaryStoragePath = fieldValue.storage_path
      }
    }
  }

  const hookCtx = {
    documentId: params.documentId,
    collectionPath,
  }

  // 2. beforeDelete hook.
  await invokeHook(hooks?.beforeDelete, hookCtx)

  // 3. Soft-delete all versions.
  const deletedVersionCount = await db.commands.documents.softDeleteDocument({
    document_id: params.documentId,
  })

  // 4. Clean up storage files. Runs only for upload-enabled collections when
  //    ctx.storage is provided. Non-fatal: logs errors but does not throw.
  if (primaryStoragePath && ctx.storage && definition.upload) {
    const allPaths = [
      primaryStoragePath,
      ...deriveVariantStoragePaths(primaryStoragePath, definition.upload.sizes ?? []),
    ]
    for (const storagePath of allPaths) {
      try {
        await ctx.storage.delete(storagePath)
      } catch (err: unknown) {
        console.error(`[deleteDocument] Failed to delete storage file '${storagePath}':`, err)
      }
    }
  }

  // 5. afterDelete hook.
  await invokeHook(hooks?.afterDelete, hookCtx)

  return { deletedVersionCount }
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when a document cannot be found by ID.
 */
export class DocumentNotFoundError extends Error {
  public readonly documentId: string
  constructor(documentId: string) {
    super(`Document not found: ${documentId}`)
    this.name = 'DocumentNotFoundError'
    this.documentId = documentId
  }
}

/**
 * Thrown when an optimistic concurrency check fails.
 */
export class ConflictError extends Error {
  public readonly currentVersionId: string
  public readonly yourVersionId: string
  constructor(currentVersionId: string, yourVersionId: string) {
    super('The document has been modified since you loaded it. Please refresh and try again.')
    this.name = 'ConflictError'
    this.currentVersionId = currentVersionId
    this.yourVersionId = yourVersionId
  }
}

/**
 * Thrown when `applyPatches` returns errors.
 */
export class PatchApplicationError extends Error {
  public readonly errors: PatchErrorInfo[]
  constructor(errors: PatchErrorInfo[]) {
    super(`Failed to apply patches: ${errors.map((e) => e.message).join('; ')}`)
    this.name = 'PatchApplicationError'
    this.errors = errors
  }
}

/**
 * Thrown when a workflow status transition is invalid.
 */
export class InvalidTransitionError extends Error {
  public readonly currentStatus: string
  public readonly nextStatus: string
  constructor(currentStatus: string, nextStatus: string, reason?: string) {
    super(reason ?? `Invalid status transition from '${currentStatus}' to '${nextStatus}'.`)
    this.name = 'InvalidTransitionError'
    this.currentStatus = currentStatus
    this.nextStatus = nextStatus
  }
}
