/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RequestContext } from '@byline/auth'

import type { ReadContext } from './db-types.js'
import type { FieldSetData, FieldSetDataAllLocales, StoredFileValue } from './field-data-types.js'
import type { Block, DefaultValue, Field, FileField, ImageField } from './field-types.js'
import type { QueryPredicate } from './query-predicate.js'
import type { IStorageProvider } from './storage-types.js'
import type { Prettify } from './type-utils.js'

// ---------------------------------------------------------------------------
// Upload / media
// ---------------------------------------------------------------------------

/** Output format for Sharp-generated image variants. */
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif'

/**
 * Resize fit strategy passed to Sharp.
 * Mirrors Sharp's `fit` option.
 */
export type ImageFit = 'cover' | 'contain' | 'fill' | 'inside' | 'outside'

/**
 * A named image size variant to generate after upload via Sharp.
 *
 * @example
 * ```ts
 * { name: 'thumbnail', width: 200, height: 200, fit: 'cover' }
 * { name: 'desktop',   width: 1920, fit: 'inside', format: 'webp', quality: 85 }
 * ```
 */
export interface ImageSize {
  /** A unique name for this variant (e.g. `'thumbnail'`, `'desktop'`). */
  name: string
  /** Target width in pixels. Omit to scale proportionally from height. */
  width?: number
  /** Target height in pixels. Omit to scale proportionally from width. */
  height?: number
  /** Resize fit strategy. Defaults to `'cover'`. */
  fit?: ImageFit
  /** Output format override. Defaults to the original image format. */
  format?: ImageFormat
  /** Quality (1–100). Relevant for jpeg, webp, and avif output. */
  quality?: number
}

/**
 * Configuration block declared on an `image` or `file` field. Hangs the
 * upload contract — accepted MIME types, size limit, generated variants,
 * storage routing, and server-side hooks — directly off the field that
 * receives the file. A collection with at least one image/file field
 * carrying an `upload` block is upload-capable; the auto-mounted route at
 * `POST /admin/api/<collection-path>/upload` accepts a `field` selector
 * to pick the target field.
 *
 * @example
 * ```ts
 * export const Media: CollectionDefinition = {
 *   path: 'media',
 *   fields: [
 *     {
 *       name: 'image',
 *       label: 'Image',
 *       type: 'image',
 *       upload: {
 *         mimeTypes: ['image/*'],
 *         maxFileSize: 10 * 1024 * 1024, // 10 MB
 *         sizes: [
 *           { name: 'thumbnail', width: 300, height: 300, fit: 'cover' },
 *           { name: 'mobile',    width: 768,  fit: 'inside' },
 *           { name: 'desktop',   width: 1920, fit: 'inside', format: 'webp', quality: 85 },
 *         ],
 *       },
 *     },
 *     // ...
 *   ],
 * }
 * ```
 */
export interface UploadConfig {
  /**
   * Allowed MIME types. Supports wildcards (e.g. `'image/*'`).
   * Omit to allow all types.
   */
  mimeTypes?: string[]
  /** Maximum file size in bytes. Omit for no limit. */
  maxFileSize?: number
  /**
   * Named image variants to generate via Sharp after the original is
   * stored. Only applied to MIME types that match `image/*`.
   * Omit to skip image processing (e.g. for a video or PDF field).
   */
  sizes?: ImageSize[]
  /**
   * Storage provider for this field.
   *
   * When set, this takes precedence over the site-wide `ServerConfig.storage`
   * default. Use this to route different fields to different backends —
   * for example, keep avatars on local disk while sending editorial
   * images to S3, or target separate S3 buckets per field.
   *
   * Falls back to `ServerConfig.storage` when omitted.
   *
   * @example
   * ```ts
   * // Dedicated S3 bucket just for this field:
   * upload: {
   *   mimeTypes: ['image/*'],
   *   storage: s3StorageProvider({ bucket: 'my-photos', region: 'eu-west-1', ... }),
   * }
   * ```
   */
  storage?: IStorageProvider
  /**
   * Server-side lifecycle hooks for this field's upload pipeline.
   *
   * `beforeStore` fires after MIME / size validation passes and before
   * the storage provider is asked to write the file — the bytes have
   * already crossed the network and live on the server (an in-memory
   * Buffer or /tmp file, depending on the storage adapter), but
   * permanent storage hasn't been touched yet. It can rename or reject
   * the upload.
   *
   * `afterStore` fires after the original file *and* all image variants
   * have been written to the storage provider, before the document
   * version is created.
   *
   * @see UploadHooks
   */
  hooks?: UploadHooks
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * The three status names that every workflow must contain.
 *
 * Storage, versioning, and API logic depend on these statuses being present.
 * `defineWorkflow()` enforces their existence and ordering automatically:
 *
 *   `[draft, ...customStatuses, published, archived]`
 */
export const WORKFLOW_STATUS_DRAFT = 'draft' as const
export const WORKFLOW_STATUS_PUBLISHED = 'published' as const
export const WORKFLOW_STATUS_ARCHIVED = 'archived' as const
export const REQUIRED_WORKFLOW_STATUSES = [
  WORKFLOW_STATUS_DRAFT,
  WORKFLOW_STATUS_PUBLISHED,
  WORKFLOW_STATUS_ARCHIVED,
] as const
export type RequiredWorkflowStatusName = (typeof REQUIRED_WORKFLOW_STATUSES)[number]

/**
 * A single status in a sequential workflow.
 *
 * `name` is the value stored in the database (e.g. `'draft'`, `'needs_review'`).
 * `label` is an optional human-readable display label for the status indicator (defaults to `name`).
 * `verb` is an optional action label shown on the transition button (e.g. "Publish"). Defaults to `label` then `name`.
 */
export interface WorkflowStatus {
  name: string
  label?: string
  verb?: string
}

/**
 * Configurable sequential workflow for a collection.
 *
 * The `statuses` array defines the ordered progression. The first entry is
 * used as the default status for new documents unless `defaultStatus` is
 * explicitly set.
 *
 * @example
 * ```ts
 * defineWorkflow({
 *   draft:     { label: 'Draft',     verb: 'Revert to Draft' },
 *   published: { label: 'Published', verb: 'Publish' },
 *   archived:  { label: 'Archived',  verb: 'Archive' },
 *   customStatuses: [
 *     { name: 'needs_review', label: 'Needs Review', verb: 'Request Review' },
 *   ],
 * })
 * ```
 */
export interface WorkflowConfig {
  statuses: WorkflowStatus[]
  /** Override the default status for new documents (defaults to the first entry). */
  defaultStatus?: string
}

/**
 * Optional label/verb overrides for one of the three required workflow statuses.
 *
 * The `name` is fixed (`'draft'`, `'published'`, or `'archived'`) and injected
 * automatically by `defineWorkflow()`.
 */
export interface RequiredStatusConfig {
  label?: string
  verb?: string
}

/**
 * Input accepted by `defineWorkflow()`.
 *
 * The three required statuses — `draft`, `published`, `archived` — are always
 * present in the resulting workflow. Their position is enforced:
 *
 *   `[draft, ...customStatuses, published, archived]`
 *
 * Each required status accepts an optional `{ label, verb }` override.
 * Any additional statuses are placed between `draft` and `published` via
 * `customStatuses`, in the order specified.
 */
export interface DefineWorkflowInput {
  /** Customize the `draft` status (always first). Defaults to `{ label: 'Draft' }`. */
  draft?: RequiredStatusConfig
  /** Customize the `published` status (always second-to-last). Defaults to `{ label: 'Published' }`. */
  published?: RequiredStatusConfig
  /** Customize the `archived` status (always last). Defaults to `{ label: 'Archived' }`. */
  archived?: RequiredStatusConfig
  /** Additional statuses placed between `draft` and `published`, in order. */
  customStatuses?: WorkflowStatus[]
  /**
   * Override the default status for new documents (defaults to `'draft'`).
   *
   * Setting this to `'published'` is the supported "publish-on-save" pattern:
   * the full draft → published → archived lifecycle stays available, but new
   * versions land directly as `published` so trusted editors can skip the
   * draft step. For collections that have no editorial lifecycle at all
   * (categories, tags, taxonomies), use `SINGLE_STATUS_WORKFLOW` instead —
   * that also strips the workflow controls from the admin UI.
   */
  defaultStatus?: string
}

/**
 * The built-in default workflow used when a collection does not define its own.
 */
export const DEFAULT_WORKFLOW: WorkflowConfig = {
  statuses: [
    { name: 'draft', label: 'Draft' },
    { name: 'published', label: 'Published' },
    { name: 'archived', label: 'Archived' },
  ],
}

/**
 * Single-status workflow for collections that have no editorial lifecycle —
 * typically lookup or reference data such as categories, tags, taxonomies,
 * and facets where a draft → review → publish flow adds friction without
 * value.
 *
 * Effects of using this workflow:
 *   - Every save lands as `'published'` immediately, so public clients
 *     reading via `readMode: 'published'` see new rows right away.
 *   - The form renderer hides workflow controls and shows only Save / Close.
 *   - The list view's status filter is hidden.
 *   - `changeDocumentStatus()` and `unpublishDocument()` reject server-side
 *     because there is no other status to transition to.
 *
 * For editorial collections that should keep the draft/published/archived
 * lifecycle but skip the draft step on save, prefer
 * `defineWorkflow({ ..., defaultStatus: 'published' })` instead.
 *
 * @example
 * ```ts
 * import { SINGLE_STATUS_WORKFLOW } from '@byline/core'
 *
 * export const DocsCategories: CollectionDefinition = {
 *   path: 'docs-categories',
 *   workflow: SINGLE_STATUS_WORKFLOW,
 *   // ...
 * }
 * ```
 */
export const SINGLE_STATUS_WORKFLOW: WorkflowConfig = {
  statuses: [{ name: 'published', label: 'Published' }],
  defaultStatus: 'published',
}

/**
 * Type-safe factory for creating a `WorkflowConfig`.
 *
 * Guarantees that the three required statuses (`draft`, `published`, `archived`)
 * are always present and correctly ordered:
 *
 *   `[draft, ...customStatuses, published, archived]`
 *
 * Custom statuses are inserted between `draft` and `published`. If a custom
 * status uses a reserved name (`draft`, `published`, or `archived`) this
 * function throws at initialization time.
 *
 * @example
 * ```ts
 * // Minimal — uses default labels for all three required statuses:
 * defineWorkflow({})
 *
 * // With custom labels/verbs on the required statuses:
 * defineWorkflow({
 *   draft:     { label: 'Draft',     verb: 'Revert to Draft' },
 *   published: { label: 'Published', verb: 'Publish' },
 *   archived:  { label: 'Archived',  verb: 'Archive' },
 * })
 *
 * // With additional statuses between draft and published:
 * defineWorkflow({
 *   draft:     { label: 'Draft',     verb: 'Revert to Draft' },
 *   published: { label: 'Published', verb: 'Publish' },
 *   archived:  { label: 'Archived',  verb: 'Archive' },
 *   customStatuses: [
 *     { name: 'needs_review', label: 'Needs Review', verb: 'Request Review' },
 *   ],
 * })
 *
 * // Publish-on-save: keep the full lifecycle, but new versions land
 * // directly as `published` instead of `draft`.
 * defineWorkflow({
 *   defaultStatus: 'published',
 * })
 * ```
 *
 * For collections that have no editorial lifecycle at all (categories,
 * tags, taxonomies), use `SINGLE_STATUS_WORKFLOW` instead.
 */
export function defineWorkflow(input: DefineWorkflowInput = {}): WorkflowConfig {
  const reserved = new Set<string>(REQUIRED_WORKFLOW_STATUSES)

  // Validate that no custom status uses a reserved name.
  if (input.customStatuses) {
    for (const s of input.customStatuses) {
      if (reserved.has(s.name)) {
        throw new Error(
          `defineWorkflow: custom status '${s.name}' conflicts with a required status name. ` +
            `Use the top-level '${s.name}' property to customize its label/verb instead.`
        )
      }
    }
  }

  const draft: WorkflowStatus = {
    name: WORKFLOW_STATUS_DRAFT,
    label: 'Draft',
    ...input.draft,
  }
  const published: WorkflowStatus = {
    name: WORKFLOW_STATUS_PUBLISHED,
    label: 'Published',
    ...input.published,
  }
  const archived: WorkflowStatus = {
    name: WORKFLOW_STATUS_ARCHIVED,
    label: 'Archived',
    ...input.archived,
  }

  const statuses: WorkflowStatus[] = [draft, ...(input.customStatuses ?? []), published, archived]

  return {
    statuses,
    ...(input.defaultStatus ? { defaultStatus: input.defaultStatus } : {}),
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

// -- Hook context types -----------------------------------------------------

/**
 * Context passed to `beforeCreate` hooks.
 *
 * The hook can mutate `data` before it is persisted.
 */
export interface BeforeCreateContext {
  data: Record<string, any>
  collectionPath: string
}

/**
 * Context passed to `afterCreate` hooks.
 *
 * Includes the `documentId` and `documentVersionId` returned by storage
 * so the hook can reference the persisted document.
 */
export interface AfterCreateContext {
  data: Record<string, any>
  collectionPath: string
  documentId: string
  documentVersionId: string
}

/**
 * Context passed to `beforeUpdate` hooks — both PUT and patch flows.
 *
 * `data` is the next version (mutable). `originalData` is the previous
 * version as reconstructed from storage.
 */
export interface BeforeUpdateContext {
  data: Record<string, any>
  originalData: Record<string, any>
  collectionPath: string
}

/**
 * Context passed to `afterUpdate` hooks.
 *
 * Includes the `documentId` and `documentVersionId` of the newly created
 * version so the hook can reference the persisted document.
 */
export interface AfterUpdateContext {
  data: Record<string, any>
  originalData: Record<string, any>
  collectionPath: string
  documentId: string
  documentVersionId: string
}

/**
 * Context passed to `beforeStatusChange` / `afterStatusChange` hooks.
 */
export interface StatusChangeContext {
  documentId: string
  documentVersionId: string
  collectionPath: string
  previousStatus: string
  nextStatus: string
}

/**
 * Context passed to `beforeUnpublish` hooks.
 */
export interface BeforeUnpublishContext {
  documentId: string
  collectionPath: string
}

/**
 * Context passed to `afterUnpublish` hooks.
 *
 * `archivedCount` indicates how many published versions were archived.
 */
export interface AfterUnpublishContext {
  documentId: string
  collectionPath: string
  archivedCount: number
}

/**
 * Context passed to `beforeDelete` / `afterDelete` hooks (future).
 */
export interface DeleteContext {
  documentId: string
  collectionPath: string
}

/**
 * Context passed to `beforeStore` hooks (configured on
 * `field.upload.hooks`).
 *
 * Fires after MIME-type and file-size validation succeed and before
 * the storage provider is asked to write the file. By the time this
 * hook runs the bytes have already crossed the network and live on
 * the server — an in-memory `Buffer` in our current adapters, or a
 * /tmp file with a future streaming adapter — but permanent storage
 * has not yet been touched.
 *
 * The hook can:
 *
 *   - Rename the file by returning a string or `{ filename }`. The
 *     override is threaded into `storage.upload(...)`, so generated
 *     image variants automatically inherit the new prefix.
 *   - Reject the upload by returning `{ error }`. Surfaces as
 *     `ERR_VALIDATION` with the supplied message; no file is written,
 *     no variants are generated, no document is created, no later
 *     hook in the chain runs.
 *   - Keep defaults by returning `void` / `undefined`.
 *
 * When configured as an array, hooks fold: each function receives the
 * filename returned by the previous function (or the original sanitised
 * filename if the previous returned `void`).
 */
export interface BeforeStoreContext {
  /** Name of the image/file field receiving this upload. */
  fieldName: string
  /** The full field definition. Carries `field.upload` for hooks that want to introspect their own config. */
  field: ImageField | FileField
  /** Sanitised default filename. Hooks may override. */
  filename: string
  mimeType: string
  fileSize: number
  /**
   * Other form values posted alongside the file. Use these to derive
   * filenames from document context (e.g. `fields.publicationId`,
   * `fields.serialNumber`). Always strings — multipart form values
   * arrive untyped.
   */
  fields: Record<string, string>
  collectionPath: string
  /** Authenticated request context. `actor.id`, `actor.tenantId`, etc. for prefixing. */
  requestContext: RequestContext
}

/**
 * Result returned by a `beforeStore` hook.
 *
 *   - `string`            → override filename (shorthand).
 *   - `{ filename }`      → override filename (object form).
 *   - `{ error }`         → reject the upload; surfaces as
 *                           `ERR_VALIDATION`. Short-circuits the chain.
 *   - `void` / undefined  → keep current defaults.
 */
export type BeforeStoreResult =
  | string
  | { filename?: string; error?: undefined }
  | { error: string; filename?: undefined }
  | void

/**
 * A `beforeStore` hook function. Async-capable.
 */
export type BeforeStoreHookFn = (
  ctx: BeforeStoreContext
) => BeforeStoreResult | Promise<BeforeStoreResult>

/**
 * Context passed to `afterStore` hooks (configured on
 * `field.upload.hooks`).
 *
 * Fires after the original file and every generated image variant
 * have been written to the storage provider, and before the document
 * version is created. Suitable for CDN cache warmup, audit logging,
 * or async post-processing kicks. Failures are logged but do not
 * roll back the storage write — consistent with `afterCreate` etc.,
 * which run outside the storage transaction.
 */
export interface AfterStoreContext {
  /** Name of the image/file field that received this upload. */
  fieldName: string
  field: ImageField | FileField
  /**
   * The persisted file value, including the `variants` array with
   * `storagePath`, `storageUrl`, `width`, `height`, and `format` for
   * each generated derivative.
   */
  storedFile: StoredFileValue
  fields: Record<string, string>
  collectionPath: string
  requestContext: RequestContext
}

/** An `afterStore` hook function. Async-capable. */
export type AfterStoreHookFn = (ctx: AfterStoreContext) => void | Promise<void>

/**
 * Server-side hooks declared on an upload-capable field's `upload`
 * block. Each hook accepts a single function or an ordered array;
 * `beforeStore` chains fold filename overrides through the array,
 * `afterStore` chains run sequentially with errors logged.
 */
export interface UploadHooks {
  beforeStore?: BeforeStoreHookFn | BeforeStoreHookFn[]
  afterStore?: AfterStoreHookFn | AfterStoreHookFn[]
}

/**
 * Context passed to `afterRead` hooks.
 *
 * Fires once per materialised document on every read path that runs through
 * `@byline/client` or `populateDocuments`:
 *   - `find`, `findOne`, `findById`, `findByPath` on `CollectionHandle`
 *     (once per returned source document)
 *   - Each populated relation target across every depth level
 *
 * The hook receives the **raw storage shape** (`{document_version_id,
 * document_id, path, status, created_at, updated_at, fields, …}`), not
 * the camelCase `ClientDocument` — afterRead runs *before* the client's
 * response shaping pass so mutations to `fields` propagate cleanly.
 * Mutations persist in place; there is no return value.
 *
 * Fires **after** populate on the source document, so hooks can observe
 * (and mutate) the fully populated tree.
 *
 * Recursion safety: `readContext` is the same request-scoped context used
 * by populate. A hook that performs its own reads should thread this
 * context back in via `client.collection(...).findById(id, { _readContext:
 * readContext })` so the visited set and read budget are preserved —
 * essential to foreclose the A→B→A loop (see
 * `docs/analysis/RELATIONSHIPS-ANALYSIS.md` § "Special consideration:
 * recursive-read safety").
 */
export interface AfterReadContext {
  /** The raw reconstructed document. Mutate in place — changes persist. */
  doc: Record<string, any>
  collectionPath: string
  /** Thread this into any nested reads the hook performs. */
  readContext: ReadContext
}

/**
 * Context passed to `beforeRead` hooks.
 *
 * Fires once per `IDocumentQueries.findDocuments` call (and once per populate
 * batch, per target collection) **before** any DB work. The hook returns a
 * `QueryPredicate` that the query layer compiles into the same `EXISTS` /
 * `LEFT JOIN LATERAL` SQL machinery the client's existing `where` parser
 * emits, then ANDs onto whatever the caller passed in `where`.
 *
 * Returning `undefined` (or simply `void`) means "no scoping" — typically
 * the superuser / unconditional-read branch. Use a sentinel predicate that
 * yields no rows (e.g. `{ id: '__none__' }`) when the actor cannot read
 * anything; do not throw, because callers expect empty list results rather
 * than collapsed endpoints.
 *
 * The hook receives:
 *   - `requestContext` — the authenticated request, including `actor`. The
 *     actor is the primary input to most predicates.
 *   - `readContext`    — the same per-request context threaded through
 *     populate and `afterRead`. Carries a hook-result cache so async
 *     predicates don't re-run across populate fanout.
 *   - `collectionPath` — the collection being queried (useful when the
 *     same hook function is reused across collections).
 *
 * See `docs/analysis/AUTHN-AUTHZ-ANALYSIS.md` (Phase 7) for the strategic
 * rationale and `docs/analysis/ACCESS-CONTROL-RECIPES.md` for worked
 * examples.
 */
export interface BeforeReadContext {
  collectionPath: string
  requestContext: RequestContext
  readContext: ReadContext
}

/**
 * A `beforeRead` hook function. Returns a `QueryPredicate` to scope the
 * query, or `void`/`undefined` to apply no scoping. May be async — actors
 * needing tenant lookups or role-metadata fetches commonly are.
 */
export type BeforeReadHookFn = (
  ctx: BeforeReadContext
) => QueryPredicate | void | Promise<QueryPredicate | void>

/**
 * Slot type for `beforeRead`.
 *
 * Distinct from the generic `CollectionHookSlot` because `beforeRead`
 * returns a value (a predicate). When multiple hook functions are
 * configured, their predicates are combined with implicit AND in
 * declaration order; functions that return `void` are skipped.
 */
export type BeforeReadHookSlot = BeforeReadHookFn | BeforeReadHookFn[]

// -- CollectionHooks interface ----------------------------------------------

/**
 * A single collection-hook function signature, parameterised by context type.
 */
export type CollectionHookFn<Ctx> = (ctx: Ctx) => void | Promise<void>

/**
 * A hook slot: accepts a single function **or** an array of functions.
 *
 * When an array is provided the functions are executed sequentially in order.
 */
export type CollectionHookSlot<Ctx> = CollectionHookFn<Ctx> | CollectionHookFn<Ctx>[]

/** Normalise a collection-hook slot (single function or array) into a flat array. */
export function normalizeCollectionHook<Ctx>(
  hook: CollectionHookSlot<Ctx> | undefined
): CollectionHookFn<Ctx>[] {
  if (!hook) return []
  return Array.isArray(hook) ? hook : [hook]
}

/**
 * Lifecycle hooks for a collection.
 *
 * Each hook receives a typed context object. `before*` hooks can mutate the
 * data before it is persisted; `after*` hooks receive the final data after
 * persistence together with identifiers of what was created/updated.
 *
 * Hooks run **outside** the storage transaction — they cannot participate in
 * the atomic write. They are suitable for logging, cache invalidation,
 * webhooks, and similar side-effects.
 *
 * Each hook accepts a single function or an **array** of functions that are
 * executed sequentially in order. Hooks are optional — if omitted, the
 * framework skips the step.
 */
export interface CollectionHooks {
  // -- Document create ------------------------------------------------------
  /** Runs before a new document is created. Can mutate `data`. */
  beforeCreate?: CollectionHookSlot<BeforeCreateContext>
  /** Runs after a new document is created. */
  afterCreate?: CollectionHookSlot<AfterCreateContext>

  // -- Document update (PUT or patches) -------------------------------------
  /** Runs before an existing document is updated (PUT or patch). Can mutate `data`. */
  beforeUpdate?: CollectionHookSlot<BeforeUpdateContext>
  /** Runs after an existing document is updated. */
  afterUpdate?: CollectionHookSlot<AfterUpdateContext>

  // -- Workflow status change -----------------------------------------------
  /** Runs before a document's workflow status is changed. */
  beforeStatusChange?: CollectionHookSlot<StatusChangeContext>
  /** Runs after a document's workflow status has been changed. */
  afterStatusChange?: CollectionHookSlot<StatusChangeContext>

  // -- Unpublish (cross-version archive) ------------------------------------
  /** Runs before a published document is unpublished (archived). */
  beforeUnpublish?: CollectionHookSlot<BeforeUnpublishContext>
  /** Runs after a published document has been unpublished.  */
  afterUnpublish?: CollectionHookSlot<AfterUnpublishContext>

  // -- Document delete ------------------------------------------------------
  /** Runs before a document is deleted. */
  beforeDelete?: CollectionHookSlot<DeleteContext>
  /** Runs after a document is deleted. */
  afterDelete?: CollectionHookSlot<DeleteContext>

  // -- Document read --------------------------------------------------------
  /**
   * Runs once per `findDocuments` call (and once per populate batch, per
   * target collection), **before** any DB work. Returns a `QueryPredicate`
   * that the query layer ANDs onto the caller's `where` to enforce
   * read-side row scoping (multi-tenant, owner-only-drafts, soft-delete
   * hide, etc). Returning `void` applies no scoping. Multiple functions
   * combine with implicit AND. See
   * `docs/analysis/ACCESS-CONTROL-RECIPES.md`.
   */
  beforeRead?: BeforeReadHookSlot
  /**
   * Runs once per materialised document on every read path that flows
   * through `@byline/client` or `populateDocuments`. Can mutate
   * `ctx.doc.fields` in place — mutations propagate back through the
   * response. Fires after populate on the source document, so hooks see
   * the fully populated tree. Hooks that perform their own reads should
   * thread `ctx.readContext` through to preserve the visited set and
   * read budget (A→B→A safety).
   */
  afterRead?: CollectionHookSlot<AfterReadContext>

  // Note: server-side upload hooks (`beforeStore` / `afterStore`) live on
  // the field's `upload` block — see `UploadHooks`. They are field-scoped
  // and field-aware by design; a collection with multiple image/file
  // fields runs each field's pipeline independently.
}

export interface CollectionDefinition {
  labels: {
    singular: string
    plural: string
  }
  path: string
  fields: Field[]
  /** Sequential workflow configuration. Falls back to DEFAULT_WORKFLOW if omitted. */
  workflow?: WorkflowConfig
  /** Lifecycle hooks for server-side document operations. */
  hooks?: CollectionHooks
  /**
   * Configures which text fields are searched when the admin list view's
   * search box is used. Only `store_text` fields are supported for now.
   * Falls back to `{ fields: ['title'] }` when omitted.
   */
  search?: { fields: string[] }
  /**
   * The field that represents this document's identity — used anywhere a
   * single-line label for the document is needed: form headings, relation
   * widget summaries, populate's default projection, future `afterRead`
   * hooks, logs, etc.
   *
   * Lives on the schema (not admin config) so server-side consumers like
   * `populateDocuments` and the client API can read it without taking a
   * dependency on UI concerns. Analogous to Django's `Model.__str__`.
   */
  useAsTitle?: string
  /**
   * Names the field whose value initialises this collection's
   * `documentVersions.path` column. The value is slugified (in the
   * default content locale) using the installation slugifier and stored
   * as system metadata — `path` itself is a reserved name and cannot be
   * declared as a field.
   *
   * `path` is sticky after creation: subsequent updates do not
   * re-derive. Users edit it via the system path widget; collections
   * without `useAsPath` receive a UUID `path` instead.
   */
  useAsPath?: string

  /***
   * When `true`, the rich text editor's link plugin surfaces relation targets
   * from this collection as linkable options. Requires the collection to have
   * a `useAsTitle` field, which is used to label the options in the editor.
   */
  linksInEditor?: boolean

  /**
   * When `true`, the admin landing page displays a per-status document count
   * inside the collection card. Requires a database round-trip per collection
   * on every landing-page load, so opt in deliberately.
   */
  showStats?: boolean
  /**
   * Optional explicit version pin. When omitted, the startup bootstrap
   * auto-increments the collection's stored version any time the schema
   * fingerprint changes. When set, the value is used verbatim as long as it
   * is >= the currently-stored version; pinning backwards throws at startup.
   *
   * The stamped version is written onto every `documentVersions` row so that
   * a document can later be resolved against the schema shape it was
   * authored under.
   */
  version?: number
}

/**
 * Type-safe factory for creating a CollectionDefinition.
 * Returns the definition as-is but provides type checking.
 */
export function defineCollection<const C extends CollectionDefinition>(
  definition: C & CollectionDefinition
): C {
  return definition
}

export type CollectionFieldData<C extends CollectionDefinition> = FieldSetData<C['fields']>
export type CollectionFieldDataAllLocales<C extends CollectionDefinition> = FieldSetDataAllLocales<
  C['fields']
>

export type CollectionData<C extends CollectionDefinition> = Prettify<
  {
    document_id: string
    document_version_id: string
    status: string
    created_at: Date
    updated_at: Date
  } & CollectionFieldData<C>
>
export type CollectionDataAllLocales<C extends CollectionDefinition> = Prettify<
  {
    document_id: string
    document_version_id: string
    status: string
    created_at: Date
    updated_at: Date
  } & CollectionFieldDataAllLocales<C>
>

// ---------------------------------------------------------------------------
// Serializable types — safe for JSON wire transfer (SSR loaders, RSC, APIs)
// ---------------------------------------------------------------------------

/**
 * A field definition with all function-valued properties stripped.
 *
 * Safe for JSON serialization — use for API responses, SSR loader return
 * values, RSC props, mobile clients, and CLI introspection. The following
 * are omitted:
 * - `validate` — client UI concern, cannot cross a network boundary
 * - `hooks`    — field-level hooks are always functions
 * - `defaultValue` — only literal (non-function) defaults are preserved
 *
 * Nested `fields` (composite / array / blocks) are recursively serialized.
 */
export type SerializableField = Omit<
  Field,
  'validate' | 'hooks' | 'defaultValue' | 'fields' | 'blocks'
> & {
  /** Only literal defaults are serializable; function defaults are dropped. */
  defaultValue?: Exclude<DefaultValue, (...args: any[]) => any>
  /** Recursively serializable child fields (group / array). */
  fields?: SerializableField[]
  /** Recursively serializable blocks (blocks field). */
  blocks?: SerializableBlock[]
}

/**
 * A block definition with all function-valued properties stripped.
 */
export type SerializableBlock = Omit<Block, 'validate' | 'hooks' | 'fields'> & {
  fields: SerializableField[]
}

/**
 * A collection definition with all function-valued properties stripped.
 *
 * Safe for JSON serialization — use for API schema endpoints, SSR loaders,
 * RSC components, mobile clients, and any context where the full definition
 * (with live functions) cannot be transmitted.
 *
 * - Collection-level `hooks` are entirely omitted (all entries are functions).
 * - Field `validate`, `hooks`, and function `defaultValue` are stripped.
 *
 * On the receiving end, resolve the full `CollectionDefinition` from the
 * local config store via `getCollectionDefinition(path)` to regain access
 * to validators, hooks, and computed defaults.
 */
export type SerializableCollectionDefinition = Omit<CollectionDefinition, 'hooks' | 'fields'> & {
  fields: SerializableField[]
}

/**
 * Strips all function-valued properties from a `CollectionDefinition`,
 * producing a version safe for JSON serialization.
 *
 * @example
 * ```ts
 * // In an API route:
 * return Response.json(toSerializableCollection(collectionDef))
 *
 * // In an SSR loader:
 * return { schema: toSerializableCollection(collectionDef), document: data }
 * ```
 */
export function toSerializableCollection(
  def: CollectionDefinition
): SerializableCollectionDefinition {
  function serializeField(field: Field): SerializableField {
    // biome-ignore lint/suspicious/noExplicitAny: intentional structural spread
    const { validate: _v, hooks: _h, defaultValue, fields, blocks, ...rest } = field as any
    const serialized: SerializableField = { ...rest }

    // Keep defaultValue only when it is a literal (not a factory function)
    if (defaultValue !== undefined && typeof defaultValue !== 'function') {
      serialized.defaultValue = defaultValue
    }

    // Recurse into nested child fields (group / array)
    if (Array.isArray(fields)) {
      serialized.fields = fields.map(serializeField)
    }

    // Recurse into blocks (blocks field)
    if (Array.isArray(blocks)) {
      serialized.blocks = blocks.map(serializeBlock)
    }

    return serialized
  }

  function serializeBlock(block: Block): SerializableBlock {
    const { validate: _v, hooks: _h, fields, ...rest } = block
    return {
      ...rest,
      fields: fields.map(serializeField),
    }
  }

  const { hooks: _hooks, fields, ...rest } = def
  return {
    ...rest,
    fields: fields.map(serializeField),
  }
}
