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

import type { RequestContext } from '@byline/auth'

import {
  type CollectionDefinition,
  type CollectionHookSlot,
  type CollectionHooks,
  type IDbAdapter,
  type IStorageProvider,
  normalizeCollectionHook,
} from '../@types/index.js'
import { assertActorCanPerform } from '../auth/assert-actor-can-perform.js'
import {
  ERR_CONFLICT,
  ERR_INVALID_TRANSITION,
  ERR_NOT_FOUND,
  ERR_PATCH_FAILED,
  ERR_VALIDATION,
} from '../lib/errors.js'
import { withLogContext } from '../lib/logger.js'
import { applyPatches } from '../patches/index.js'
import { normaliseDateFields } from '../utils/normalise-dates.js'
import { type SlugifierFn, slugify } from '../utils/slugify.js'
import { deriveVariantStoragePaths } from '../utils/storage-utils.js'
import { getDefaultStatus, getWorkflow, validateStatusTransition } from '../workflow/workflow.js'
import type { BylineLogger } from '../lib/logger.js'
import type { DocumentPatch } from '../patches/index.js'

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
  /**
   * The collection's current schema version. Stamped onto every
   * `documentVersions` row written during the lifecycle call so that
   * Phase-2 in-memory migration can later resolve each document against
   * the shape it was authored under. Callers resolve this from the core
   * registry (`core.getCollectionRecord(path).version`).
   */
  collectionVersion: number
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
  /** Structured logger instance. Provided via the DI registry. */
  logger: BylineLogger
  /**
   * The default content locale (e.g. `'en'`). Used to anchor `path`
   * derivation: the slugifier always runs against the default-locale
   * source value, and creating a brand-new document in any other locale
   * is rejected.
   *
   * Sourced by callers from `ServerConfig.i18n.content.defaultLocale`.
   */
  defaultLocale: string
  /**
   * Installation slugifier. When omitted, the lifecycle falls back to
   * the default `slugify` exported from `@byline/core`.
   */
  slugifier?: SlugifierFn
  /**
   * Request-scoped context carrying the authenticated actor, request id,
   * and related per-request metadata.
   *
   * Plumbing only in Phase 0 of the auth roadmap — present on the context
   * so every lifecycle service can accept and forward it, but no ability
   * assertions are performed yet. Phase 4 turns enforcement on: lifecycle
   * entry points will call `context.requestContext?.actor?.assertAbility(...)`
   * before any storage mutation.
   *
   * Optional in Phase 0 so that existing callers (admin server fns, seed
   * scripts, tests) continue to compile. Phase 4 tightens the type.
   *
   * See docs/analysis/AUTHN-AUTHZ-ANALYSIS.md.
   */
  requestContext?: RequestContext
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

/**
 * Derive a `documentVersions.path` value at create time.
 *
 *   1. `definition.useAsPath` set → slugify the named source field's value
 *      in the default content locale.
 *   2. Source field absent / empty → fall back to `crypto.randomUUID()`.
 *
 * Caller passes explicit overrides separately; this helper only handles
 * the auto-derivation cascade.
 */
function derivePath(
  definition: CollectionDefinition,
  data: Record<string, any>,
  defaultLocale: string,
  slugifier: SlugifierFn
): string {
  if (definition.useAsPath != null) {
    const sourceValue = data[definition.useAsPath]
    if (sourceValue != null) {
      const asString = sourceValue instanceof Date ? sourceValue.toISOString() : String(sourceValue)
      if (asString.length > 0) {
        const slug = slugifier(asString, {
          locale: defaultLocale,
          collectionPath: definition.path,
        })
        if (slug.length > 0) return slug
      }
    }
  }
  return crypto.randomUUID()
}

// ---------------------------------------------------------------------------
// Lifecycle functions
// ---------------------------------------------------------------------------

/**
 * Create a new document.
 *
 * Flow:
 *   1. Default-locale enforcement: reject if `params.locale` is anything
 *      other than the configured default content locale (a brand-new
 *      document's canonical `path` lives in the default locale).
 *   2. `normaliseDateFields(data)`
 *   3. `hooks.beforeCreate({ data, collectionPath })`
 *   4. Resolve `path` — explicit `params.path` → derive via `useAsPath`
 *      → UUID fallback.
 *   5. `db.commands.documents.createDocumentVersion(...)` (action = 'create')
 *   6. `hooks.afterCreate({ data, collectionPath, documentId, documentVersionId })`
 */
export async function createDocument(
  ctx: DocumentLifecycleContext,
  params: {
    data: Record<string, any>
    locale?: string
    status?: string
    /**
     * Explicit, user-supplied path (e.g. from the admin sidebar widget
     * or an SDK caller importing legacy content). When omitted, the
     * lifecycle derives the value from `definition.useAsPath`.
     */
    path?: string
  }
): Promise<CreateDocumentResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'createDocument' },
    async () => {
      const { db, definition, collectionId, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'create')
      const slugifier = ctx.slugifier ?? slugify
      const hooks: CollectionHooks | undefined = definition.hooks
      const data = params.data

      if (params.locale != null && params.locale !== defaultLocale) {
        throw ERR_VALIDATION({
          message: `documents must be created in the default content locale ('${defaultLocale}'); received '${params.locale}'. Create the default-locale version first, then add localised versions via update.`,
          details: { defaultLocale, providedLocale: params.locale, collectionPath },
        }).log(ctx.logger)
      }

      normaliseDateFields(data)

      await invokeHook(hooks?.beforeCreate, { data, collectionPath })

      const explicitPath =
        typeof params.path === 'string' && params.path.length > 0 ? params.path : null
      const resolvedPath = explicitPath ?? derivePath(definition, data, defaultLocale, slugifier)

      const result = await db.commands.documents.createDocumentVersion({
        collectionId,
        collectionVersion: ctx.collectionVersion,
        collectionConfig: definition,
        action: 'create',
        documentData: data,
        path: resolvedPath,
        status: params.status ?? data.status,
        locale: params.locale ?? defaultLocale,
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
  )
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
    /**
     * Explicit path override. When omitted, the previous version's path
     * carries forward unchanged (sticky). The lifecycle never re-derives
     * `path` from the source field on update — that is an explicit user
     * action driven by the admin path widget.
     */
    path?: string
  }
): Promise<UpdateDocumentResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'updateDocument' },
    async () => {
      const { db, definition, collectionId, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'update')
      const hooks: CollectionHooks | undefined = definition.hooks
      const data = params.data

      // Fetch the real original so hooks get accurate originalData (fixes the
      // PUT handler bug where originalData === data).
      const latest = await db.queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: params.documentId,
        locale: params.locale ?? defaultLocale,
        reconstruct: true,
      })

      const originalData: Record<string, any> = (latest as Record<string, any>) ?? {}

      normaliseDateFields(data)

      await invokeHook(hooks?.beforeUpdate, { data, originalData, collectionPath })

      const defaultStatus = getDefaultStatus(definition)

      const explicitPath =
        typeof params.path === 'string' && params.path.length > 0 ? params.path : null
      const resolvedPath =
        explicitPath ?? (originalData.path as string | undefined) ?? crypto.randomUUID()

      const result = await db.commands.documents.createDocumentVersion({
        documentId: params.documentId,
        collectionId,
        collectionVersion: ctx.collectionVersion,
        collectionConfig: definition,
        action: 'update',
        documentData: data,
        path: resolvedPath,
        status: defaultStatus,
        locale: params.locale ?? defaultLocale,
        previousVersionId: originalData.document_version_id as string | undefined,
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
  )
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
 * @throws {BylineError} ERR_CONFLICT if the supplied `documentVersionId` does not match the current version.
 * @throws {BylineError} ERR_PATCH_FAILED if `applyPatches` fails.
 */
export async function updateDocumentWithPatches(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    patches: DocumentPatch[]
    /** Client-supplied version ID for optimistic concurrency. */
    documentVersionId?: string
    locale?: string
    /**
     * Explicit path override (typically supplied alongside patches when
     * the admin path widget has been edited). When omitted, sticky from
     * the previous version.
     */
    path?: string
  }
): Promise<UpdateDocumentWithPatchesResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'updateDocumentWithPatches' },
    async () => {
      const { db, definition, collectionId, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'update')
      const hooks: CollectionHooks | undefined = definition.hooks

      // 1. Fetch current document.
      const latest = await db.queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: params.documentId,
        locale: params.locale ?? defaultLocale,
        reconstruct: true,
      })

      if (latest == null) {
        throw ERR_NOT_FOUND({
          message: 'document not found',
          details: { documentId: params.documentId },
        }).log(ctx.logger)
      }

      const originalData = latest as Record<string, any>

      // 2. Optimistic concurrency check.
      if (
        params.documentVersionId &&
        params.documentVersionId !== originalData.document_version_id
      ) {
        throw ERR_CONFLICT({
          message: 'document has been modified since you loaded it',
          details: {
            currentVersionId: originalData.document_version_id,
            yourVersionId: params.documentVersionId,
          },
        }).log(ctx.logger)
      }

      // 3. Apply patches (patches operate on flat field data, not the full envelope).
      const { doc: patchedDocument, errors } = applyPatches(
        definition,
        originalData.fields ?? {},
        params.patches
      )

      if (errors.length > 0) {
        throw ERR_PATCH_FAILED({
          message: `failed to apply patches: ${errors.map((e) => e.message).join('; ')}`,
          details: { errors },
        }).log(ctx.logger)
      }

      const nextData = patchedDocument as Record<string, any>

      // 4. Normalise dates.
      normaliseDateFields(nextData)

      // 5. beforeUpdate hook.
      await invokeHook(hooks?.beforeUpdate, { data: nextData, originalData, collectionPath })

      // 6. Persist.
      const defaultStatus = getDefaultStatus(definition)

      const explicitPath =
        typeof params.path === 'string' && params.path.length > 0 ? params.path : null
      const resolvedPath =
        explicitPath ?? (originalData.path as string | undefined) ?? crypto.randomUUID()

      const result = await db.commands.documents.createDocumentVersion({
        documentId: params.documentId,
        collectionId,
        collectionVersion: ctx.collectionVersion,
        collectionConfig: definition,
        action: 'update',
        documentData: nextData,
        path: resolvedPath,
        status: defaultStatus,
        locale: params.locale ?? defaultLocale,
        previousVersionId: originalData.document_version_id as string | undefined,
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
  )
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
  }
): Promise<ChangeStatusResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'changeDocumentStatus' },
    async () => {
      const { db, definition, collectionId, collectionPath } = ctx
      // Every transition requires the general changeStatus ability.
      // Transitions that target the `published` status additionally
      // require the narrower `publish` ability — so installations can
      // grant "move things through the workflow" without also granting
      // "flip the final publish switch".
      assertActorCanPerform(ctx.requestContext, collectionPath, 'changeStatus')
      if (params.nextStatus === 'published') {
        assertActorCanPerform(ctx.requestContext, collectionPath, 'publish')
      }
      const hooks: CollectionHooks | undefined = definition.hooks

      // 1. Fetch current version metadata. No field reconstruction needed —
      //    status transitions only touch the document_versions.status column.
      const latest = await db.queries.documents.getCurrentVersionMetadata({
        collection_id: collectionId,
        document_id: params.documentId,
      })

      if (latest == null) {
        throw ERR_NOT_FOUND({
          message: 'document not found',
          details: { documentId: params.documentId },
        }).log(ctx.logger)
      }

      const currentStatus = latest.status ?? 'draft'
      const documentVersionId = latest.document_version_id

      // 2. Validate transition.
      const workflow = getWorkflow(definition)
      const result = validateStatusTransition(workflow, currentStatus, params.nextStatus)

      if (!result.valid) {
        throw ERR_INVALID_TRANSITION({
          message:
            result.reason ??
            `invalid status transition from '${currentStatus}' to '${params.nextStatus}'`,
          details: { currentStatus, nextStatus: params.nextStatus },
        }).log(ctx.logger)
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
  )
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
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'unpublishDocument' },
    async () => {
      const { db, collectionPath } = ctx
      // Unpublish is a workflow transition out of `published` — reuse the
      // changeStatus gate rather than a separate ability.
      assertActorCanPerform(ctx.requestContext, collectionPath, 'changeStatus')
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
  )
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
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'deleteDocument' },
    async () => {
      const { db, collectionPath, definition, logger } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'delete')
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
        throw ERR_NOT_FOUND({
          message: 'document not found',
          details: { documentId: params.documentId },
        }).log(ctx.logger)
      }

      // Extract the primary file's storage_path before deletion.
      let primaryStoragePath: string | null = null
      if (isUploadCollection) {
        const primaryField = definition.fields.find((f) => f.type === 'image' || f.type === 'file')
        if (primaryField) {
          const fieldValue = (latest as Record<string, any>)?.fields?.[primaryField.name]
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
            logger.error({ err, storagePath }, 'failed to delete storage file')
          }
        }
      }

      // 5. afterDelete hook.
      await invokeHook(hooks?.afterDelete, hookCtx)

      return { deletedVersionCount }
    }
  )
}
