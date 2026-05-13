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
  type Field,
  type FieldSet,
  type IDbAdapter,
  type IStorageProvider,
  isArrayField,
  isBlocksField,
  isGroupField,
  normalizeCollectionHook,
} from '../@types/index.js'
import { assertActorCanPerform } from '../auth/assert-actor-can-perform.js'
import { getCollectionDefinition } from '../config/config.js'
import {
  ERR_CONFLICT,
  ERR_INVALID_TRANSITION,
  ERR_NOT_FOUND,
  ERR_PATCH_FAILED,
  ERR_PATH_CONFLICT,
  ERR_VALIDATION,
  ErrorCodes,
} from '../lib/errors.js'
import { generateKeyBetween } from '../lib/fractional-index.js'
import { withLogContext } from '../lib/logger.js'
import { applyPatches } from '../patches/index.js'
import { normaliseDateFields } from '../utils/normalise-dates.js'
import { type SlugifierFn, slugify } from '../utils/slugify.js'
import { getUploadFields } from '../utils/storage-utils.js'
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
   * Storage provider for this collection. Required when the collection
   * has any upload-capable image/file field, so that the original files
   * and their persisted variants can be cleaned up on document deletion.
   *
   * Resolved by the route layer as:
   *   `field.upload?.storage ?? serverConfig.storage`
   *
   * Optional — callers whose collections have no upload-capable fields
   * are unaffected.
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
   * Optional so that internal-tooling callers (seed scripts, migration
   * tools) continue to compile. Production write paths always supply it
   * — `assertActorCanPerform` runs at every lifecycle entry and rejects
   * a missing context.
   *
   * See docs/AUTHN-AUTHZ.md.
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

export interface RestoreVersionResult {
  documentId: string
  documentVersionId: string
  sourceVersionId: string
}

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

export interface DuplicateDocumentResult {
  /** The newly-created document's id. */
  documentId: string
  /** The newly-created version id (every duplicate starts at version 1). */
  documentVersionId: string
  /** The id of the document this duplicate was cloned from. */
  sourceDocumentId: string
  /**
   * Final `path` written into `byline_document_paths` for the new document.
   * Surfaced in the result so the UI can include it in success toasts /
   * navigate to it directly.
   */
  newPath: string
  /**
   * `true` when the candidate path collided with an existing row and the
   * lifecycle retried with a short-UUID suffix. UIs can surface a hint that
   * the auto-generated path is uglier than usual so the editor knows to
   * adjust it via the path widget.
   */
  pathRetried: boolean
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

/**
 * For collections with `orderable: true` on their schema definition, compute
 * an append-at-end fractional-index key for a newly-inserted document.
 * Returns `undefined` when the collection hasn't opted in (or has no
 * definition registered, e.g. in unit-test environments), so the storage row
 * gets `order_key = NULL` and the existing "no ordering" behavior holds.
 */
async function maybeAppendOrderKey(
  ctx: DocumentLifecycleContext,
  collectionPath: string
): Promise<string | undefined> {
  const definition = getCollectionDefinition(collectionPath)
  if (definition?.orderable !== true) return undefined
  const last = await ctx.db.queries.documents.getLastOrderKey({
    collection_id: ctx.collectionId,
  })
  return generateKeyBetween(last, null)
}

/** Extract `id` from the document object returned by `createDocumentVersion`. */
function extractVersionId(document: any): string {
  return document?.id ?? document?.document_version_id ?? ''
}

/**
 * Detect a Postgres unique-constraint violation on
 * `byline_document_paths(collection_id, locale, path)` and translate it
 * to `ERR_PATH_CONFLICT`. Any other error is rethrown unchanged.
 *
 * The Postgres SQLSTATE for unique violations is `23505`. Drivers carry
 * the constraint name on the error object (`constraint`); matching by
 * name keeps this targeted to the path constraint and avoids spuriously
 * rebranding unrelated unique violations as path conflicts.
 *
 * Drizzle wraps the underlying pg error in `DrizzleQueryError` with the
 * original attached as `cause`, so we walk a short cause chain to find
 * the carried `code` / `constraint`.
 */
function rethrowPathConflict(err: unknown, path: string, locale: string): never {
  type PgLikeError = { code?: string; constraint?: string; cause?: unknown }
  let e: PgLikeError | undefined = err as PgLikeError | undefined
  // Walk at most a few `cause` hops — DrizzleQueryError → underlying pg error.
  for (let i = 0; i < 3 && e; i++) {
    if (
      e.code === '23505' &&
      typeof e.constraint === 'string' &&
      e.constraint.includes('document_paths_collection_locale_path')
    ) {
      throw ERR_PATH_CONFLICT({
        message: `path "${path}" is already in use in this collection (locale: ${locale})`,
        details: { path, locale, constraint: e.constraint },
      })
    }
    e = e.cause as PgLikeError | undefined
  }
  throw err as Error
}

/**
 * Resolve the path argument the storage primitive should receive on an
 * update operation. Phase 1 only writes path rows under the default
 * content locale; on translation saves a supplied path is dropped with
 * a `logger.warn`, leaving the existing default-locale row untouched.
 *
 * Returns `undefined` to signal the storage primitive should skip the
 * path write entirely (no upsert).
 */
function resolvePathForUpdate(args: {
  explicitPath: string | null
  currentPath: string | undefined
  requestLocale: string
  defaultLocale: string
  documentId: string
  logger?: BylineLogger
}): string | undefined {
  const { explicitPath, currentPath, requestLocale, defaultLocale, documentId, logger } = args
  if (requestLocale === defaultLocale) {
    // Default-locale write: pass path through when supplied; otherwise
    // skip the write (existing path row stays as-is — sticky).
    return explicitPath ?? undefined
  }
  // Non-default-locale write: reject any path change with a warn so the
  // operation succeeds but the editor / API caller is informed.
  if (explicitPath !== null && explicitPath !== currentPath) {
    logger?.warn(
      {
        documentId,
        requestedLocale: requestLocale,
        defaultLocale,
        suppliedPath: explicitPath,
        currentPath,
      },
      'path changes apply only on default-locale writes; ignored on translation save'
    )
  }
  return undefined
}

/** Extract the logical document id from the document object returned by `createDocumentVersion`. */
function extractDocumentId(document: any): string {
  return document?.document_id ?? ''
}

/**
 * Derive the `path` value written into `byline_document_paths` at
 * create time.
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

      // Append-at-end order_key for `orderable: true` collections.
      // Computed before the insert so the single createDocumentVersion call
      // carries the key into the byline_documents row. No effect when the
      // admin config opts out or isn't registered.
      const orderKey = await maybeAppendOrderKey(ctx, collectionPath)

      const result = await db.commands.documents
        .createDocumentVersion({
          collectionId,
          collectionVersion: ctx.collectionVersion,
          collectionConfig: definition,
          action: 'create',
          documentData: data,
          path: resolvedPath,
          status: params.status ?? data.status,
          locale: params.locale ?? defaultLocale,
          orderKey,
        })
        .catch((err: unknown) => rethrowPathConflict(err, resolvedPath, defaultLocale))

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
      const requestLocale = params.locale ?? defaultLocale
      const pathForCommand = resolvePathForUpdate({
        explicitPath,
        currentPath: originalData.path as string | undefined,
        requestLocale,
        defaultLocale,
        documentId: params.documentId,
        logger: ctx.logger,
      })

      const result = await db.commands.documents
        .createDocumentVersion({
          documentId: params.documentId,
          collectionId,
          collectionVersion: ctx.collectionVersion,
          collectionConfig: definition,
          action: 'update',
          documentData: data,
          path: pathForCommand,
          status: defaultStatus,
          locale: requestLocale,
          previousVersionId: originalData.document_version_id as string | undefined,
        })
        .catch((err: unknown) => rethrowPathConflict(err, pathForCommand ?? '', defaultLocale))

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
      const requestLocale = params.locale ?? defaultLocale
      const pathForCommand = resolvePathForUpdate({
        explicitPath,
        currentPath: originalData.path as string | undefined,
        requestLocale,
        defaultLocale,
        documentId: params.documentId,
        logger: ctx.logger,
      })

      const result = await db.commands.documents
        .createDocumentVersion({
          documentId: params.documentId,
          collectionId,
          collectionVersion: ctx.collectionVersion,
          collectionConfig: definition,
          action: 'update',
          documentData: nextData,
          path: pathForCommand,
          status: defaultStatus,
          locale: requestLocale,
          previousVersionId: originalData.document_version_id as string | undefined,
        })
        .catch((err: unknown) => rethrowPathConflict(err, pathForCommand ?? '', defaultLocale))

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
      // Single-status workflows (e.g. SINGLE_STATUS_WORKFLOW for lookups)
      // have no transitions to perform. Reject early with a clear message
      // rather than relying on the generic ±1-step validator.
      const workflow = getWorkflow(definition)
      if (workflow.statuses.length <= 1) {
        throw ERR_INVALID_TRANSITION({
          message: `collection '${collectionPath}' has a single-status workflow; status transitions are not supported`,
          details: { collectionPath, nextStatus: params.nextStatus },
        }).log(ctx.logger)
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
      const { db, collectionPath, definition } = ctx
      // Unpublish is a workflow transition out of `published` — reuse the
      // changeStatus gate rather than a separate ability.
      assertActorCanPerform(ctx.requestContext, collectionPath, 'changeStatus')
      // Single-status workflows have nothing to unpublish to.
      const workflow = getWorkflow(definition)
      if (workflow.statuses.length <= 1) {
        throw ERR_INVALID_TRANSITION({
          message: `collection '${collectionPath}' has a single-status workflow; unpublish is not supported`,
          details: { collectionPath },
        }).log(ctx.logger)
      }
      const hooks: CollectionHooks | undefined = definition.hooks

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
 * Restore a historical document version as the new current version.
 *
 * Reads the source version with `locale: 'all'` so the entire multi-locale
 * field tree (with `_id` / `_type` meta inlined onto blocks and array items
 * by `reconstructFromUnifiedRows`) is captured. That tree is then re-emitted
 * through `createDocumentVersion` with `locale: 'all'`, which produces a
 * fresh version row with a new UUIDv7 id and the latest `created_at`. The
 * `current_documents` view (`ROW_NUMBER() OVER PARTITION BY document_id
 * ORDER BY created_at DESC`) automatically promotes the new row to current.
 *
 * Status is hard-defaulted to the workflow's first status — restoring an
 * old `published` version must never silently re-publish content. The user
 * runs the restored draft through the normal workflow.
 *
 * `path` is sticky from the previous current version (not from the source),
 * matching the semantics of `updateDocument`. A path change made between
 * the source and now should not be undone by the restore.
 *
 * Auth reuses the `update` ability — restore is conceptually an edit
 * against an existing document.
 *
 * Hooks: fires `beforeUpdate` / `afterUpdate` with a `restore: { sourceVersionId }`
 * field on the context. Userland hooks that need to react differently
 * (e.g. tag the audit entry, skip search re-index) can branch on its
 * presence.
 *
 * Flow:
 *   1. Auth: `update` ability.
 *   2. Read source version with `locale: 'all'`.
 *   3. Validate source belongs to `documentId` (defence against forged
 *      cross-document version ids).
 *   4. Read current version metadata; reject if the source IS already the
 *      current version (nothing to restore).
 *   5. Read current document with reconstruction for hook `originalData`.
 *   6. `hooks.beforeUpdate({ data, originalData, collectionPath, restore })`
 *   7. `db.commands.documents.createDocumentVersion(...)` with
 *      `action: 'restore'`, `locale: 'all'`, sticky path, default status.
 *   8. `hooks.afterUpdate({ ..., restore })`
 */
export async function restoreDocumentVersion(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    sourceVersionId: string
  }
): Promise<RestoreVersionResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'restoreDocumentVersion' },
    async () => {
      const { db, definition, collectionId, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'update')
      const hooks: CollectionHooks | undefined = definition.hooks

      // 1. Read source version (full multi-locale tree).
      const source = await db.queries.documents.getDocumentByVersion({
        document_version_id: params.sourceVersionId,
        locale: 'all',
      })

      if (source == null) {
        throw ERR_NOT_FOUND({
          message: 'source version not found',
          details: { sourceVersionId: params.sourceVersionId },
        }).log(ctx.logger)
      }

      // 2. Cross-document forgery check.
      if ((source as Record<string, any>).document_id !== params.documentId) {
        throw ERR_VALIDATION({
          message: 'source version does not belong to the target document',
          details: {
            documentId: params.documentId,
            sourceVersionId: params.sourceVersionId,
            sourceDocumentId: (source as Record<string, any>).document_id,
          },
        }).log(ctx.logger)
      }

      // 3. Current version metadata — used both for the already-current
      //    guard and for the sticky path resolution.
      const currentMeta = await db.queries.documents.getCurrentVersionMetadata({
        collection_id: collectionId,
        document_id: params.documentId,
      })

      if (currentMeta == null) {
        throw ERR_NOT_FOUND({
          message: 'document not found',
          details: { documentId: params.documentId },
        }).log(ctx.logger)
      }

      if (currentMeta.document_version_id === params.sourceVersionId) {
        throw ERR_INVALID_TRANSITION({
          message: 'source version is already the current version of this document',
          details: {
            documentId: params.documentId,
            sourceVersionId: params.sourceVersionId,
          },
        }).log(ctx.logger)
      }

      // 4. originalData for hooks: full reconstruction of the current
      //    version (locale-scoped, matching updateDocument's semantics).
      const latest = await db.queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: params.documentId,
        locale: defaultLocale,
        reconstruct: true,
      })
      const originalData: Record<string, any> = (latest as Record<string, any>) ?? {}

      const sourceFields = (source as Record<string, any>).fields ?? {}
      const restoreContext = { sourceVersionId: params.sourceVersionId }

      // 5. beforeUpdate.
      await invokeHook(hooks?.beforeUpdate, {
        data: sourceFields,
        originalData,
        collectionPath,
        restore: restoreContext,
      })

      // 6. Persist new version. locale: 'all' carries every locale row in
      //    the source tree forward in a single flatten pass — the
      //    cross-locale carry-forward branch in createDocumentVersion does
      //    not fire when locale === 'all'.
      //
      // No `path` is passed: restore does not change the document's path
      // (the existing byline_document_paths row stays as-is — sticky).
      const result = await db.commands.documents.createDocumentVersion({
        documentId: params.documentId,
        collectionId,
        collectionVersion: ctx.collectionVersion,
        collectionConfig: definition,
        action: 'restore',
        documentData: sourceFields,
        status: getDefaultStatus(definition),
        locale: 'all',
        previousVersionId: currentMeta.document_version_id,
      })

      const documentId = extractDocumentId(result.document) || params.documentId
      const documentVersionId = extractVersionId(result.document)

      // 7. afterUpdate.
      await invokeHook(hooks?.afterUpdate, {
        data: sourceFields,
        originalData,
        collectionPath,
        documentId,
        documentVersionId,
        restore: restoreContext,
      })

      return {
        documentId,
        documentVersionId,
        sourceVersionId: params.sourceVersionId,
      }
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
 * When the collection has any upload-capable image/file field and
 * `ctx.storage` is provided, every original file and persisted variant
 * across those fields is also removed from storage after the DB
 * soft-delete succeeds. Variant paths are read from the field value's
 * `variants` array (no re-derivation from `upload.sizes`), so cleanup
 * stays correct even if the size set changed between upload and delete.
 * File cleanup failures are logged but are non-fatal.
 *
 * Flow:
 *   1. Fetch current document (reconstruct when upload-capable fields exist)
 *   2. `hooks.beforeDelete({ documentId, collectionPath })`
 *   3. `db.commands.documents.softDeleteDocument({ document_id })`
 *   4. Storage file + variant cleanup (skipped when no upload fields, non-fatal)
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
      //    For collections that have any upload-capable image/file field
      //    AND a storage provider, fetch with reconstruct: true so we
      //    can read the stored file paths (and persisted variant paths)
      //    from the field values before the DB rows are deleted.
      const uploadFieldNames = getUploadFields(definition).map((f) => f.name)
      const isUploadCollection = uploadFieldNames.length > 0 && ctx.storage != null
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

      // Collect storage paths for every upload-capable field on the doc:
      // the original file plus every persisted variant. Reading the
      // variants from the field value (rather than re-deriving from
      // `upload.sizes`) keeps cleanup correct even when the size set
      // changes between upload and delete.
      const storagePathsToDelete: string[] = []
      if (isUploadCollection) {
        for (const fieldName of uploadFieldNames) {
          const fieldValue = (latest as Record<string, any>)?.fields?.[fieldName]
          if (!fieldValue || typeof fieldValue !== 'object') continue
          if (typeof fieldValue.storagePath === 'string') {
            storagePathsToDelete.push(fieldValue.storagePath)
          }
          if (Array.isArray(fieldValue.variants)) {
            for (const variant of fieldValue.variants) {
              if (variant && typeof variant.storagePath === 'string') {
                storagePathsToDelete.push(variant.storagePath)
              }
            }
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

      // 4. Clean up storage files. Non-fatal: logs errors but does not throw.
      if (ctx.storage && storagePathsToDelete.length > 0) {
        for (const storagePath of storagePathsToDelete) {
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

/**
 * Strip the synthetic `_id` / `_type` meta keys from every block and
 * array-item node in a reconstructed document tree.
 *
 * Reconstructed `locale: 'all'` trees carry stable `_id` values for
 * blocks and array items (see CLAUDE.md → "Block/array items carry a
 * stable `_id`"). For a *duplicate*, the new document is conceptually a
 * fresh entity — its blocks should get fresh meta ids rather than
 * inheriting the source's. Mutates the tree in place.
 *
 * Distinct from `restoreDocumentVersion`, which deliberately preserves
 * `_id`s so block identity is stable across history.
 */
function stripMetaIdsInPlace(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      stripMetaIdsInPlace(item)
    }
    return
  }
  if (value != null && typeof value === 'object' && !(value instanceof Date)) {
    const obj = value as Record<string, unknown>
    delete obj._id
    delete obj._type
    for (const key of Object.keys(obj)) {
      stripMetaIdsInPlace(obj[key])
    }
  }
}

/**
 * Apply the `" (copy)"` suffix to the configured `useAsTitle` field on a
 * duplicate's data tree. Handles both shapes:
 *
 *   - Localized title — `fields[useAsTitle]` is `{ en: '...', fr: '...' }`,
 *     suffix is applied to every locale's value.
 *   - Non-localized title — `fields[useAsTitle]` is a plain string;
 *     suffix appended once.
 *
 * No-op when the collection has no `useAsTitle` or the title is null /
 * undefined; the duplicate proceeds with the source's title verbatim and
 * the editor can rename it. Mutates the tree in place.
 */
function applyDuplicateTitleSuffix(
  definition: CollectionDefinition,
  fields: Record<string, any>,
  suffix: string
): void {
  const titleField = definition.useAsTitle
  if (titleField == null) return
  const value = fields[titleField]
  if (value == null) return
  if (typeof value === 'string') {
    fields[titleField] = value + suffix
    return
  }
  if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    const localized = value as Record<string, unknown>
    for (const loc of Object.keys(localized)) {
      const v = localized[loc]
      if (typeof v === 'string') {
        localized[loc] = v + suffix
      }
    }
  }
}

/**
 * Compute the candidate path for a duplicate.
 *
 * Reads the default-locale value of `definition.useAsPath` (peeling the
 * localized-shape wrapper if present) and runs it through the existing
 * `derivePath` helper. Falls back to `crypto.randomUUID()` when no source
 * value is available — matches `createDocument`'s behaviour for paths
 * that can't be slugged.
 */
function deriveDuplicateCandidatePath(
  definition: CollectionDefinition,
  fields: Record<string, any>,
  defaultLocale: string,
  slugifier: SlugifierFn
): string {
  const useAsPath = definition.useAsPath
  if (useAsPath == null) {
    return crypto.randomUUID()
  }
  const raw = fields[useAsPath]
  // Peel the localized wrapper to find the default-locale value.
  let sourceValue: any = raw
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof Date)) {
    sourceValue = (raw as Record<string, unknown>)[defaultLocale]
  }
  return derivePath(definition, { [useAsPath]: sourceValue }, defaultLocale, slugifier)
}

/**
 * Duplicate a document, cloning all of its locales into a brand-new
 * document atomically.
 *
 * Flow:
 *   1. `assertActorCanPerform('create')` — duplicating is a create at the
 *      ability level. The source must be readable (any RBAC scoping the
 *      caller has applies via the storage read).
 *   2. Fetch the source with `locale: 'all'` so a single read carries the
 *      full multi-locale tree forward.
 *   3. Deep-clone the source fields; strip block / array-item `_id` meta
 *      so the new doc gets fresh identities.
 *   4. Append `" (copy)"` to the `useAsTitle` field's value(s).
 *   5. Derive a candidate path from the default-locale suffixed title.
 *   6. `hooks.beforeCreate({ data, collectionPath, duplicate })`.
 *   7. `db.commands.documents.createDocumentVersion(...)` with `locale:
 *      'all'`, `action: 'create'`, no `documentId` → fresh document_id.
 *      On `ERR_PATH_CONFLICT` retry once with the candidate path plus a
 *      4-char UUID suffix; bounded to two attempts, no existence
 *      pre-check, no TOCTOU race.
 *   8. `hooks.afterCreate({ data, collectionPath, documentId,
 *      documentVersionId, duplicate })`.
 *
 * The write is atomic at the storage layer — a partial duplicate is
 * structurally impossible. Editors are expected to rename both the
 * title and the system path after the operation; the UI surfaces a
 * confirmation modal that calls this out.
 */
export async function duplicateDocument(
  ctx: DocumentLifecycleContext,
  params: { sourceDocumentId: string }
): Promise<DuplicateDocumentResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'duplicateDocument' },
    async () => {
      const { db, definition, collectionId, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'create')
      const slugifier = ctx.slugifier ?? slugify
      const hooks: CollectionHooks | undefined = definition.hooks

      // 1. Read source with locale='all' — single read, full multi-locale tree.
      const source = await db.queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: params.sourceDocumentId,
        locale: 'all',
        reconstruct: true,
        lenient: true,
        requestContext: ctx.requestContext,
      })

      if (source == null) {
        throw ERR_NOT_FOUND({
          message: 'source document not found',
          details: { sourceDocumentId: params.sourceDocumentId, collectionPath },
        }).log(ctx.logger)
      }

      const sourceRecord = source as Record<string, any>
      const sourceFields: Record<string, any> = sourceRecord.fields ?? {}

      // 2. Deep clone — we'll mutate (suffix titles, strip meta ids).
      const clonedFields = structuredClone(sourceFields) as Record<string, any>

      // 3. Fresh block / array-item identities for the new doc.
      stripMetaIdsInPlace(clonedFields)

      // 4. Suffix titles per locale (or once if non-localized).
      const titleSuffix = ' (copy)'
      applyDuplicateTitleSuffix(definition, clonedFields, titleSuffix)

      // 5. Derive candidate path from the (now suffixed) default-locale title.
      const candidatePath = deriveDuplicateCandidatePath(
        definition,
        clonedFields,
        defaultLocale,
        slugifier
      )

      // 6. beforeCreate hook with duplicate marker.
      const duplicateMarker = { sourceDocumentId: params.sourceDocumentId }
      await invokeHook(hooks?.beforeCreate, {
        data: clonedFields,
        collectionPath,
        duplicate: duplicateMarker,
      })

      // 7. Atomic write. Try the candidate path; on ERR_PATH_CONFLICT
      //    retry once with a 4-char UUID suffix.
      const defaultStatus = getDefaultStatus(definition)
      let finalPath = candidatePath
      let pathRetried = false
      let result: { document: any; fieldCount: number }
      // Append-at-end order_key for `orderable: true` collections. Computed
      // before the insert; the source row's order is intentionally not
      // copied — duplicates land at the end of the list.
      const orderKey = await maybeAppendOrderKey(ctx, collectionPath)
      try {
        result = await db.commands.documents
          .createDocumentVersion({
            collectionId,
            collectionVersion: ctx.collectionVersion,
            collectionConfig: definition,
            action: 'create',
            documentData: clonedFields,
            path: finalPath,
            status: defaultStatus,
            locale: 'all',
            orderKey,
          })
          .catch((err: unknown) => rethrowPathConflict(err, finalPath, defaultLocale))
      } catch (err: unknown) {
        if (!isPathConflictError(err)) {
          throw err
        }
        // Single retry with a short UUID suffix. crypto.randomUUID() is
        // 36 chars; take the first 4 hex digits for a compact disambiguator.
        const shortDisambiguator = crypto.randomUUID().slice(0, 4)
        finalPath = `${candidatePath}-${shortDisambiguator}`
        pathRetried = true
        ctx.logger?.info(
          { candidatePath, retryPath: finalPath, sourceDocumentId: params.sourceDocumentId },
          'duplicateDocument: candidate path collided, retrying with short-UUID suffix'
        )
        result = await db.commands.documents
          .createDocumentVersion({
            collectionId,
            collectionVersion: ctx.collectionVersion,
            collectionConfig: definition,
            action: 'create',
            documentData: clonedFields,
            path: finalPath,
            status: defaultStatus,
            locale: 'all',
            orderKey,
          })
          .catch((retryErr: unknown) => rethrowPathConflict(retryErr, finalPath, defaultLocale))
      }

      const newDocumentId = extractDocumentId(result.document)
      const newDocumentVersionId = extractVersionId(result.document)

      // 8. afterCreate hook with duplicate marker.
      await invokeHook(hooks?.afterCreate, {
        data: clonedFields,
        collectionPath,
        documentId: newDocumentId,
        documentVersionId: newDocumentVersionId,
        duplicate: duplicateMarker,
      })

      return {
        documentId: newDocumentId,
        documentVersionId: newDocumentVersionId,
        sourceDocumentId: params.sourceDocumentId,
        newPath: finalPath,
        pathRetried,
      }
    }
  )
}

/**
 * Detect whether an error is the `ERR_PATH_CONFLICT` raised by
 * `rethrowPathConflict`. Used by `duplicateDocument`'s retry logic to
 * keep the conflict-handling path separate from genuine errors.
 */
function isPathConflictError(err: unknown): boolean {
  return (
    err != null &&
    typeof err === 'object' &&
    (err as { code?: string }).code === ErrorCodes.PATH_CONFLICT
  )
}

// ---------------------------------------------------------------------------
// Copy-to-Locale merge walker
// ---------------------------------------------------------------------------

/**
 * Treat null, undefined, and empty string as "no value" for the purpose
 * of the `overwrite: false` merge rule. We intentionally do NOT treat
 * `0`, `false`, or `[]` / `{}` as empty — they are meaningful values an
 * editor may have set deliberately.
 */
function isEmptyLeafValue(value: unknown): boolean {
  return value == null || value === ''
}

/**
 * Result of merging source-locale and target-locale data trees for
 * `copyToLocale`. `data` is the payload to hand to
 * `createDocumentVersion`; `fieldsUpdated` counts every localized leaf
 * the merge rule chose to overwrite (used for UI toasts).
 */
interface CopyToLocaleMergeResult {
  data: Record<string, any>
  fieldsUpdated: number
}

/**
 * Build the payload `copyToLocale` will write into the target locale.
 *
 * Walks `definition.fields` and the two reconstructed data trees in
 * lockstep, applying the merge rule at every leaf:
 *
 *   - **Localized leaf, `overwrite: true`** — take source's value (even
 *     when source is empty; overwriting means overwriting).
 *   - **Localized leaf, `overwrite: false`** — take source's value only
 *     when target is empty AND source is non-empty. Otherwise keep
 *     target's value. Empties under this rule are treated by
 *     `isEmptyLeafValue` — `null` / `undefined` / `''`.
 *   - **Non-localized leaf** — always keep target's value. Non-localized
 *     fields live on `locale: 'all'` rows in storage and would be wiped
 *     by the upcoming write if we did not pass them through verbatim.
 *
 * Structure (number of array items, blocks, etc.) follows the *target*
 * tree — copy-to-locale never restructures the document; it only fills
 * in localized leaves at positions the target already has.
 *
 * Pure: mutates nothing. The returned `data` is a fresh tree suitable
 * to pass to `createDocumentVersion`.
 */
function mergeLocaleData(
  fields: FieldSet,
  sourceData: Record<string, any> | null | undefined,
  targetData: Record<string, any> | null | undefined,
  overwrite: boolean
): CopyToLocaleMergeResult {
  const source = (sourceData ?? {}) as Record<string, any>
  const target = (targetData ?? {}) as Record<string, any>
  const out: Record<string, any> = {}
  let fieldsUpdated = 0

  for (const field of fields) {
    const updated = mergeFieldValue(field, source[field.name], target[field.name], overwrite)
    out[field.name] = updated.value
    fieldsUpdated += updated.fieldsUpdated
  }

  return { data: out, fieldsUpdated }
}

interface MergeFieldOutcome {
  value: any
  fieldsUpdated: number
}

function mergeFieldValue(
  field: Field,
  sourceValue: unknown,
  targetValue: unknown,
  overwrite: boolean
): MergeFieldOutcome {
  if (isGroupField(field)) {
    const childSource = isPlainObject(sourceValue) ? sourceValue : {}
    const childTarget = isPlainObject(targetValue) ? targetValue : {}
    const merged = mergeLocaleData(field.fields, childSource, childTarget, overwrite)
    return { value: merged.data, fieldsUpdated: merged.fieldsUpdated }
  }

  if (isArrayField(field)) {
    if (!Array.isArray(targetValue)) {
      // Target has no array here — keep that. Source is not authoritative
      // for structure under copy-to-locale.
      return { value: targetValue, fieldsUpdated: 0 }
    }
    const sourceItems = Array.isArray(sourceValue) ? sourceValue : []
    const mergedItems: any[] = []
    let count = 0
    for (let i = 0; i < targetValue.length; i++) {
      const tItem = targetValue[i]
      const sItem = sourceItems[i]
      if (!isPlainObject(tItem)) {
        mergedItems.push(tItem)
        continue
      }
      const itemMerge = mergeLocaleData(
        field.fields,
        isPlainObject(sItem) ? sItem : {},
        tItem,
        overwrite
      )
      // Preserve `_id` / `_type` meta on the target item — same identity
      // is carried forward across this update.
      const merged = { ...itemMerge.data } as Record<string, any>
      if (tItem._id !== undefined) merged._id = tItem._id
      if (tItem._type !== undefined) merged._type = tItem._type
      mergedItems.push(merged)
      count += itemMerge.fieldsUpdated
    }
    return { value: mergedItems, fieldsUpdated: count }
  }

  if (isBlocksField(field)) {
    if (!Array.isArray(targetValue)) {
      return { value: targetValue, fieldsUpdated: 0 }
    }
    const sourceItems = Array.isArray(sourceValue) ? sourceValue : []
    const mergedItems: any[] = []
    let count = 0
    for (let i = 0; i < targetValue.length; i++) {
      const tItem = targetValue[i] as Record<string, any> | null | undefined
      if (!isPlainObject(tItem)) {
        mergedItems.push(tItem)
        continue
      }
      const blockType = tItem._type
      const block = field.blocks.find((b) => b.blockType === blockType)
      if (block == null) {
        // Unknown block — pass through unchanged.
        mergedItems.push(tItem)
        continue
      }
      const sItem = sourceItems[i]
      const itemMerge = mergeLocaleData(
        block.fields,
        isPlainObject(sItem) && sItem._type === blockType ? sItem : {},
        tItem,
        overwrite
      )
      const merged = { ...itemMerge.data } as Record<string, any>
      if (tItem._id !== undefined) merged._id = tItem._id
      merged._type = blockType
      mergedItems.push(merged)
      count += itemMerge.fieldsUpdated
    }
    return { value: mergedItems, fieldsUpdated: count }
  }

  // Leaf field.
  const localized = (field as { localized?: boolean }).localized === true
  if (!localized) {
    // Non-localized leaves live on locale: 'all' rows. Pass the target's
    // value through verbatim so the write does not wipe them.
    return { value: targetValue, fieldsUpdated: 0 }
  }

  if (overwrite) {
    return {
      value: sourceValue,
      fieldsUpdated: sourceValue === targetValue ? 0 : 1,
    }
  }

  // overwrite: false — fill only when target is empty AND source has content.
  if (isEmptyLeafValue(targetValue) && !isEmptyLeafValue(sourceValue)) {
    return { value: sourceValue, fieldsUpdated: 1 }
  }
  return { value: targetValue, fieldsUpdated: 0 }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// copyToLocale
// ---------------------------------------------------------------------------

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
      const hooks: CollectionHooks | undefined = definition.hooks
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
