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
import type { SearchFieldDecl } from './search-types.js'
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
   * Accepts an inline object, or — because the schema is isomorphic — a
   * **loader** (`hooks: () => import('./media.hooks.js')`) that defers the
   * hooks module so server-only code (storage SDKs, `sharp`, AV scanners)
   * never enters the client bundle. See {@link UploadHooksLoader}.
   *
   * @see UploadHooks
   */
  hooks?: UploadHooks | UploadHooksLoader
  /**
   * Form-value paths the admin upload executor resolves at submit time and
   * posts alongside the file, so server-side `beforeStore` / `afterStore`
   * hooks receive document context in `ctx.fields` (always strings —
   * multipart form values arrive untyped).
   *
   * Paths use filesystem-style resolution relative to the upload field's
   * containing scope. For a field at `files[2].filesGroup.publicationFile`:
   *
   *   - `'language'` (bare / `./`) → sibling: `files[2].filesGroup.language`
   *   - `'../label'` → one level up: `files[2].label`
   *   - `'/serialNumber'` → document root: `serialNumber`
   *
   * Each resolved value is posted under the path's **leaf name** (`language`,
   * `serialNumber`); when two context paths share a leaf name the later
   * declaration wins. Serialisation: strings pass through; numbers/booleans
   * are stringified; relation envelopes post their `targetDocumentId`
   * (hasMany: comma-joined); `null`/`undefined` values are omitted; anything
   * else is JSON-stringified.
   *
   * Independent of `context`, the executor always posts `documentId` (edit
   * mode only — absent while the document is unsaved) and `fieldPath` (the
   * full form path of the upload field, e.g.
   * `files[2].filesGroup.publicationFile`).
   *
   * Hooks must treat all of these as **client-supplied claims** and re-verify
   * anything security- or integrity-relevant server-side (e.g. fetch the
   * document by `documentId` rather than trusting a posted serial).
   */
  context?: string[]
  /**
   * When `true`, the admin renders a "save this document first" notice in
   * place of the upload widget until the document has been persisted (i.e.
   * the form is in edit mode with a document id). Existing stored values
   * still render normally — only the *upload* affordance is gated.
   *
   * Use this when server-side upload hooks depend on state that exists only
   * after the first save — allocator-assigned `counter` fields, the document
   * id itself — e.g. a `beforeStore` hook that derives the storage key from
   * the document's serial number.
   *
   * Admin-side UX only: API callers can still upload without a document.
   * Enforce the invariant server-side in a `beforeStore` hook (reject with
   * `{ error }` when the required context is missing).
   */
  requireSavedDocument?: boolean
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
 *
 * `duplicate` is set only when the create originates from a
 * `duplicateDocument` call. Userland hooks that need to react differently
 * (e.g. skip outbound webhooks, tag analytics) can branch on its presence.
 * When set, `data` carries the multi-locale tree shape (localized fields
 * appear as `{ locale: value }` objects) — mirroring the multi-locale
 * `data` precedent set by `restoreDocumentVersion`'s `beforeUpdate` hook.
 */
export interface BeforeCreateContext {
  data: Record<string, any>
  collectionPath: string
  duplicate?: { sourceDocumentId: string }
}

/**
 * Context passed to `afterCreate` hooks.
 *
 * Includes the `documentId` and `documentVersionId` returned by storage
 * so the hook can reference the persisted document.
 *
 * `path` is the document's canonical (source-locale) routing path as
 * written into `byline_document_paths` — the value a consumer needs to
 * invalidate a cache key, purge a CDN URL, or fire a webhook against the
 * specific document. (Resolved *after* `beforeCreate`, since that hook may
 * mutate the source field that path derivation reads.)
 *
 * `duplicate` mirrors `BeforeCreateContext.duplicate` — present only when
 * the create was triggered by `duplicateDocument`.
 */
export interface AfterCreateContext {
  data: Record<string, any>
  collectionPath: string
  documentId: string
  documentVersionId: string
  /** The document's canonical (source-locale) routing path. */
  path: string
  duplicate?: { sourceDocumentId: string }
}

/**
 * Context passed to `beforeUpdate` hooks — PUT, patch, restore, and
 * copy-to-locale flows.
 *
 * `data` is the next version (mutable). `originalData` is the previous
 * version as reconstructed from storage.
 *
 * `restore` is set only when the update originates from a "make current"
 * action against a historical version. `copyToLocale` is set only when
 * the update originates from a Copy-to-Locale operation. The two are
 * mutually exclusive in practice. Userland hooks that need to react
 * differently (e.g. tag the audit entry, skip search re-index, suppress
 * translation webhooks during a bulk seed) can branch on their presence.
 */
export interface BeforeUpdateContext {
  data: Record<string, any>
  originalData: Record<string, any>
  collectionPath: string
  restore?: { sourceVersionId: string }
  copyToLocale?: { sourceLocale: string; targetLocale: string }
  /** Set only when the update originates from a Delete-Locale operation. */
  deleteLocale?: { locale: string }
}

/**
 * Context passed to `afterUpdate` hooks.
 *
 * Includes the `documentId` and `documentVersionId` of the newly created
 * version so the hook can reference the persisted document.
 *
 * `path` is the document's canonical (source-locale) routing path after the
 * update — surfaced explicitly so cache-invalidation / CDN-purge / webhook
 * hooks need not dig it out of `originalData`. (Previously available only
 * implicitly via `originalData.path`.)
 *
 * `restore` mirrors `BeforeUpdateContext.restore` — present only when the
 * update was triggered by restoring a historical version.
 * `copyToLocale` mirrors `BeforeUpdateContext.copyToLocale` — present only
 * when the update was triggered by `copyToLocale`.
 */
export interface AfterUpdateContext {
  data: Record<string, any>
  originalData: Record<string, any>
  collectionPath: string
  documentId: string
  documentVersionId: string
  /** The document's canonical (source-locale) routing path. */
  path: string
  restore?: { sourceVersionId: string }
  copyToLocale?: { sourceLocale: string; targetLocale: string }
  /** Mirrors `BeforeUpdateContext.deleteLocale`. */
  deleteLocale?: { locale: string }
}

/**
 * Context passed to `afterSystemFieldsChange` after a non-versioned document
 * path and/or advertised-locale change commits successfully.
 *
 * Both snapshots are included so cache and search consumers can remove stale
 * paths and reconcile locale-specific output without re-reading the old state.
 */
export interface SystemFieldsChangeContext {
  documentId: string
  collectionPath: string
  /** Fields explicitly supplied by the caller, including a no-op retry. */
  requested: {
    path: boolean
    availableLocales: boolean
  }
  changed: {
    path: boolean
    availableLocales: boolean
  }
  /** True when a no-op request deliberately re-runs post-commit reconciliation. */
  reconciliation: boolean
  previousPath?: string
  currentPath?: string
  previousAvailableLocales: string[]
  currentAvailableLocales: string[]
}

/**
 * Context passed to `beforeStatusChange` / `afterStatusChange` hooks.
 *
 * `path` is the document's canonical (source-locale) routing path — present
 * so a status-change hook (publish → purge CDN, archive → drop cache key) can
 * act on the specific document/URL rather than invalidating the whole
 * collection.
 */
export interface StatusChangeContext {
  documentId: string
  documentVersionId: string
  collectionPath: string
  /** The document's canonical (source-locale) routing path. */
  path: string
  previousStatus: string
  nextStatus: string
}

/**
 * Context passed to `beforeUnpublish` hooks.
 *
 * `path` is the document's canonical (source-locale) routing path — present
 * so an unpublish hook can target the specific document/URL.
 */
export interface BeforeUnpublishContext {
  documentId: string
  collectionPath: string
  /** The document's canonical (source-locale) routing path. */
  path: string
}

/**
 * Context passed to `afterUnpublish` hooks.
 *
 * `archivedCount` indicates how many published versions were archived.
 *
 * `path` is the document's canonical (source-locale) routing path — present
 * so an unpublish hook can target the specific document/URL.
 */
export interface AfterUnpublishContext {
  documentId: string
  collectionPath: string
  /** The document's canonical (source-locale) routing path. */
  path: string
  archivedCount: number
}

/**
 * Context passed to `beforeDelete` / `afterDelete` hooks.
 *
 * `path` is the document's canonical (source-locale) routing path — present
 * so a delete hook can purge the specific document/URL (cache key, CDN, search
 * index) rather than the entire collection.
 */
export interface DeleteContext {
  documentId: string
  collectionPath: string
  /** The document's canonical (source-locale) routing path. */
  path: string
}

/**
 * Context passed to the `afterTreeChange` hook — the structural-change
 * invalidation event for `tree: true` collections (docs/04-collections/03-document-trees.md).
 *
 * Tree mutations are document-grain and **unversioned**, so the normal
 * version-write invalidation (`afterCreate` / `afterUpdate` / `afterStatusChange`)
 * never fires for them. A single structural change ripples — the moved node, its
 * descendants (their breadcrumb trails changed), and the old/new parents and
 * sibling lists — so the hook fires **once per write** carrying the whole
 * `affectedDocumentIds` set as a batched event, rather than one event per edge.
 * Consumers (cache / ISR invalidation, markdown-export refresh, search reindex)
 * refresh exactly that set.
 */
export interface TreeChangeContext {
  collectionPath: string
  /**
   * The kind of structural change:
   *   - `'place'`  — a node was placed, reordered, or re-parented.
   *   - `'remove'` — a node was removed from the tree (back to *unplaced*).
   *   - `'promote-on-delete'` — a document was deleted, so its children were
   *     promoted to root and it left the tree.
   */
  change: 'place' | 'remove' | 'promote-on-delete'
  /** The primary node the change acted on. */
  documentId: string
  /**
   * Every document whose tree position, breadcrumb trail, or sibling context
   * changed and which downstream caches / indexes should refresh: the acted-on
   * node, its descendants, the old and new parents, and the affected sibling
   * lists. De-duplicated; order is not significant.
   */
  affectedDocumentIds: string[]
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
 *     image variants automatically inherit the new prefix. The storage
 *     provider still derives the final key (e.g. local storage prefixes
 *     `<collection>/<uuid>-` for collision avoidance).
 *   - Take **full control of the storage key** by returning
 *     `{ storagePath }` — a fully-qualified, POSIX-style path (no
 *     leading slash) that is threaded into `storage.upload(...)` as
 *     `targetStoragePath` and written **verbatim**: no UUID prefix, no
 *     collection namespace, no provider rewriting. The hook assumes
 *     responsibility for sanitisation and collision avoidance (see
 *     `UploadFileOptions.targetStoragePath`). Generated image variants
 *     derive their sibling paths from the custom original. When
 *     `storagePath` is returned without `filename`, the stored
 *     `filename` defaults to the path's basename.
 *   - Reject the upload by returning `{ error }`. Surfaces as
 *     `ERR_VALIDATION` with the supplied message; no file is written,
 *     no variants are generated, no document is created, no later
 *     hook in the chain runs.
 *   - Keep defaults by returning `void` / `undefined`.
 *
 * When configured as an array, hooks fold: each function receives the
 * filename returned by the previous function (or the original sanitised
 * filename if the previous returned `void`), and `ctx.storagePath`
 * carries the most recent explicit storage-path override (if any).
 */
export interface BeforeStoreContext {
  /** Name of the image/file field receiving this upload. */
  fieldName: string
  /** The full field definition. Carries `field.upload` for hooks that want to introspect their own config. */
  field: ImageField | FileField
  /** Sanitised default filename. Hooks may override. */
  filename: string
  /**
   * Explicit storage-path override set by an earlier hook in the chain
   * (via `{ storagePath }`), if any. `undefined` means the storage
   * provider will derive the key itself from `filename` + `collection`.
   */
  storagePath?: string
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
  /**
   * The storage provider this upload will be written to (the field's
   * `upload.storage` or the site-wide default). Lets hooks feature-detect
   * and use the optional provider capabilities — e.g. `storage.exists?.(key)`
   * to collision-check an explicit `{ storagePath }` before claiming it.
   */
  storage: IStorageProvider
}

/**
 * Result returned by a `beforeStore` hook.
 *
 *   - `string`            → override filename (shorthand).
 *   - `{ filename }`      → override filename (object form). The storage
 *                           provider still derives the final key.
 *   - `{ storagePath }`   → take full control of the storage key: written
 *                           verbatim via `UploadFileOptions.targetStoragePath`
 *                           (no UUID prefix / provider rewriting). May be
 *                           combined with `filename`; without it, the stored
 *                           filename defaults to the path's basename.
 *   - `{ error }`         → reject the upload; surfaces as
 *                           `ERR_VALIDATION`. Short-circuits the chain.
 *   - `void` / undefined  → keep current defaults.
 */
export type BeforeStoreResult =
  | string
  | { filename?: string; storagePath?: string; error?: undefined }
  | { error: string; filename?: undefined; storagePath?: undefined }
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
  /**
   * The storage provider the file was written to. See
   * {@link BeforeStoreContext.storage}.
   */
  storage: IStorageProvider
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
 * A lazy loader for a field's upload hooks — the function form of
 * `field.upload.hooks`. Returns the `UploadHooks` object, or a module
 * namespace whose `default` export is the `UploadHooks` object (so
 * `() => import('./media.hooks.js')` works directly against an
 * `export default { … } satisfies UploadHooks`).
 *
 * Same rationale as {@link CollectionHooksLoader}: upload hooks are declared
 * on a field *inside the collection schema*, which is **isomorphic** (bundled
 * into the client admin). `beforeStore` / `afterStore` bodies typically reach
 * for server-only code — storage SDKs, `sharp`, AV scanners, `node:crypto` —
 * so declaring them inline drags that graph into the client bundle. The
 * loader form defers the hooks module behind a dynamic `import()`, keeping it
 * structurally absent from the client.
 *
 * @example
 * // media.schema.ts — isomorphic, client-safe by construction
 * {
 *   name: 'image',
 *   type: 'image',
 *   upload: {
 *     mimeTypes: ['image/*'],
 *     hooks: () => import('./media.hooks.js'),
 *   },
 * }
 *
 * // media.hooks.ts — server-only; may import any server-only module freely
 * export default { afterStore: (ctx) => { … } } satisfies UploadHooks
 */
export type UploadHooksLoader = () => Promise<UploadHooks | { default: UploadHooks }>

const resolvedUploadHooksCache = new WeakMap<UploadHooksLoader, UploadHooks>()

/**
 * Resolve a field's `upload.hooks` to a concrete `UploadHooks` object.
 *
 * - The inline-object form (`hooks: { … }`) is returned as-is.
 * - The loader form (`hooks: () => import('./media.hooks.js')`) is invoked
 *   once and its result (unwrapping a module `default` export) memoized,
 *   keyed on the loader's function identity. The upload pipeline resolves
 *   through here, so a loader's dynamic `import()` runs at most once per
 *   process.
 *
 * Returns `undefined` when no upload hooks are declared. The counterpart to
 * {@link resolveHooks} for the field-upload surface.
 */
export async function resolveUploadHooks(
  hooks: UploadHooks | UploadHooksLoader | undefined
): Promise<UploadHooks | undefined> {
  if (typeof hooks !== 'function') return hooks
  const cached = resolvedUploadHooksCache.get(hooks)
  if (cached) return cached
  const loaded = await hooks()
  const resolved = 'default' in loaded ? loaded.default : loaded
  resolvedUploadHooksCache.set(hooks, resolved)
  return resolved
}

/**
 * Context passed to `afterRead` hooks.
 *
 * Fires once per materialised document on every read path that runs through
 * `@byline/client` or `populateDocuments`:
 *   - `find`, `findOne`, `findById`, `findByPath` on `CollectionHandle`
 *     (once per returned source document)
 *   - Each populated relation target across every depth level
 *   - Rich-text targets, tree/search hydration, and historical versions
 *
 * The hook receives the **raw storage shape** (`{document_version_id,
 * document_id, path, status, created_at, updated_at, fields, …}`), not
 * the camelCase `ClientDocument` — afterRead runs *before* the client's
 * response shaping pass so mutations to `fields` propagate cleanly.
 * Mutations persist in place; there is no return value.
 * `requestContext` is the immutable operation-scoped identity and effective
 * read mode, enabling actor-dependent field redaction on every path.
 *
 * Fires **after** populate on the source document, so hooks can observe
 * (and mutate) the fully populated tree.
 *
 * Recursion safety: `readContext` is the same request-scoped context used
 * by populate. A hook that performs its own reads should thread this
 * context back in via `client.collection(...).findById(id, { _readContext:
 * readContext })` so the visited set and read budget are preserved —
 * essential to foreclose the A→B→A loop (see `docs/04-collections/02-relationships.md`).
 */
export interface AfterReadContext {
  /** The raw reconstructed document. Mutate in place — changes persist. */
  doc: Record<string, any>
  collectionPath: string
  /** Authenticated identity cloned for this operation's effective read mode. */
  requestContext: RequestContext
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
 * the superuser / unconditional-read branch. Return `{ id: { $in: [] } }`
 * when the actor cannot read anything; it compiles to an always-false SQL
 * predicate without passing an invalid UUID to Postgres. Do not throw, because
 * callers expect empty list results rather than collapsed endpoints.
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
 * See `docs/06-auth-and-security/01-authn-authz.md` for the strategic rationale; the Quick
 * Reference there carries six worked recipes.
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

  // -- Non-versioned document system fields ---------------------------------
  /**
   * Runs after an actual path and/or advertised-locale change commits, or for
   * an explicit no-op reconciliation retry. A failure rejects the lifecycle
   * call but cannot roll back the already-committed system-field write/audit;
   * retry with reconciliation enabled to run post-commit side effects again.
   */
  afterSystemFieldsChange?: CollectionHookSlot<SystemFieldsChangeContext>

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

  // -- Document tree (structural change) ------------------------------------
  /**
   * Runs after a structural change to a `tree: true` collection's hierarchy —
   * a place / reorder / re-parent (`placeTreeNode`), a removal
   * (`removeFromTree`), or the promote-children-to-root that accompanies a
   * delete. Tree writes mint no document version, so this is the only
   * invalidation signal for them. Fires once per write with the full affected
   * set ({@link TreeChangeContext}). See docs/04-collections/03-document-trees.md.
   */
  afterTreeChange?: CollectionHookSlot<TreeChangeContext>

  // -- Document read --------------------------------------------------------
  /**
   * Runs once per `findDocuments` call (and once per populate batch, per
   * target collection), **before** any DB work. Returns a `QueryPredicate`
   * that the query layer ANDs onto the caller's `where` to enforce
   * read-side row scoping (multi-tenant, owner-only-drafts, soft-delete
   * hide, etc). Returning `void` applies no scoping. Multiple functions
   * combine with implicit AND. See `docs/06-auth-and-security/01-authn-authz.md` (Read-side
   * scoping + Quick Reference recipes).
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

/**
 * A lazy loader for a collection's hooks — the function form of
 * `CollectionDefinition.hooks`. Returns the `CollectionHooks` object, or a
 * module namespace whose `default` export is the `CollectionHooks` object
 * (so `() => import('./docs.hooks.js')` works directly against an
 * `export default { … } satisfies CollectionHooks`).
 *
 * Why this exists: a `CollectionDefinition` is **isomorphic** — the same
 * schema module is bundled into the *client* admin as well as the server.
 * Any module the schema *statically imports* is dragged into the client
 * bundle, so a hook body that imports server-only code (cache invalidation,
 * queue clients, Node built-ins) leaks that entire graph into the browser.
 * The loader form defers the hooks module behind a dynamic `import()`, so
 * the hooks module and its server-only graph are *structurally absent* from
 * the client — no per-call-site SSR guards required.
 *
 * @example
 * // docs.schema.ts — isomorphic, client-safe by construction
 * export const Docs = defineCollection({
 *   // …declarative field config…
 *   hooks: () => import('./docs.hooks.js'),
 * })
 *
 * // docs.hooks.ts — server-only; may import any server-only module freely
 * import { invalidateDocument } from '@/lib/cache/with-cache'
 * export default {
 *   afterCreate: ({ collectionPath, path }) => invalidateDocument(collectionPath, path),
 * } satisfies CollectionHooks
 */
export type CollectionHooksLoader = () => Promise<CollectionHooks | { default: CollectionHooks }>

const resolvedHooksCache = new WeakMap<CollectionHooksLoader, CollectionHooks>()

/**
 * Resolve a collection's `hooks` to a concrete `CollectionHooks` object.
 *
 * - The inline-object form (`hooks: { … }`) is returned as-is.
 * - The loader form (`hooks: () => import('./docs.hooks.js')`) is invoked
 *   once and its result (unwrapping a module `default` export) memoized,
 *   keyed on the loader's function identity. Every read/write path resolves
 *   through here, so a loader's dynamic `import()` runs at most once per
 *   process regardless of how many documents flow through it.
 *
 * Returns `undefined` when no hooks are declared.
 */
export async function resolveHooks(
  definition: CollectionDefinition
): Promise<CollectionHooks | undefined> {
  const hooks = definition.hooks
  if (typeof hooks !== 'function') return hooks
  const cached = resolvedHooksCache.get(hooks)
  if (cached) return cached
  const loaded = await hooks()
  const resolved = 'default' in loaded ? loaded.default : loaded
  resolvedHooksCache.set(hooks, resolved)
  return resolved
}

/**
 * Type-safe factory for authoring a collection's hooks in a separate
 * module (the loader form: `hooks: () => import('./docs.hooks.js')`).
 * Returns the object as-is — the counterpart to `defineCollection` /
 * `defineBlock` for the sibling hooks file.
 *
 * Note: hook contexts currently type `data` as `Record<string, any>`, so
 * this provides the same checking as `satisfies CollectionHooks` (a named
 * factory + a stable place to hang docs), not per-collection field-data
 * narrowing. Threading `CollectionFieldData<C>` into hook contexts is a
 * separate future enhancement; when it lands it can be added here without
 * authors changing call sites.
 *
 * @example
 * // docs.hooks.ts
 * export default defineHooks({
 *   afterCreate: ({ collectionPath, path }) => invalidateDocument(collectionPath, path),
 * })
 */
export function defineHooks(hooks: CollectionHooks): CollectionHooks {
  return hooks
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
  /**
   * Lifecycle hooks for server-side document operations.
   *
   * Two forms:
   * - **Inline** (`hooks: { afterCreate, … }`) — valid for hooks whose
   *   bodies only touch isomorphic / declarative code.
   * - **Loader** (`hooks: () => import('./docs.hooks.js')`) — defers the
   *   hooks module behind a dynamic `import()` so server-only code never
   *   enters the client bundle. See {@link CollectionHooksLoader}.
   */
  hooks?: CollectionHooks | CollectionHooksLoader
  /**
   * Search configuration for this collection — a **role-based** declaration
   * of what to index. The implementor names fields by the role they play;
   * core derives each field's type from the schema and assembles the
   * type-enriched `SearchDocument` (see the `SearchProvider` seam in
   * `docs/05-reading-and-delivery/07-search.md`). Nothing is auto-pulled, so
   * unindexed content (editorial notes, internal fields) never leaks into
   * the index.
   *
   * - `body` — fields whose text feeds the full-text searchable content.
   *   Text fields contribute their value; `richText` fields are extracted to
   *   plain text via the registered `fields.richText.toText` seam. Each entry
   *   is a field path, or `{ field, boost }` to weight it for scoring
   *   providers that support `capabilities.weighting`.
   * - `facets` — relation field paths to controlled-vocabulary collections.
   *   Core resolves each target's `counter` field (the stable aggregation id)
   *   and its `useAsTitle` (the term, folded into searchable text). `{ field,
   *   boost }` weights the indexed term.
   * - `filters` — scalar field paths projected for filtering / sorting (not
   *   scored).
   * - `zones` — the search scope(s) this collection belongs to. A collection
   *   can belong to more than one zone (e.g. both a dedicated `publications`
   *   archive search and a general `site` search). When a collection opts
   *   into search without naming zones, it gets a single implicit zone equal
   *   to its collection path, so single-collection search always works and
   *   shared `site`-style zones are opt-in.
   */
  search?: {
    body?: SearchFieldDecl[]
    facets?: SearchFieldDecl[]
    filters?: string[]
    zones?: string[]
  }
  /**
   * Admin list-view quick-search fields — the top-level text-store field
   * names (`text` / `textArea` / `select`) the list route's search box
   * matches with substring (`ILIKE`) queries against `store_text`.
   *
   * Deliberately separate from `search`, which configures provider indexing
   * for site search: the two answer different questions ("find the row I
   * mean" vs. "rank relevant published content") and need not name the same
   * fields — a collection with a six-field weighted `search.body` typically
   * wants only its identity field (plus maybe a serial/code field) here.
   * Declaring one without the other is equally valid: `listSearch` with no
   * `search` keeps the list box working on an unindexed collection.
   *
   * Falls back to the identity field (`useAsTitle`, else the first declared
   * text field) when omitted — most collections need no declaration.
   *
   * Lives on the schema (not admin config) for the same reason as
   * `useAsTitle`: the query layer (`findDocuments` in the db adapter)
   * resolves it server-side from the `CollectionDefinition`.
   */
  listSearch?: string[]
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
   * Names the field whose value initialises a document's `path` row in
   * `byline_document_paths` (the dedicated per-(document, locale) URL slug
   * table, separate from `documentVersions`). The value is slugified (in
   * the default content locale) using the installation slugifier and
   * stored as system metadata — `path` itself is a reserved name and
   * cannot be declared as a field.
   *
   * `path` is sticky after creation: subsequent updates do not
   * re-derive. Users edit it via the system path widget; collections
   * without `useAsPath` receive a UUID `path` instead.
   */
  useAsPath?: string

  /**
   * Opts this collection into the `availableLocales` editorial advertising
   * control — the deliberate "advertise these content locales" set an editor
   * curates per document, stored document-grain in
   * `byline_document_available_locales` (mirrors `byline_document_paths`) and
   * surfaced on reads as `availableLocales`. It is the editorial counterpart
   * to the derived, ledger-backed `_availableVersionLocales` (path-coverage
   * fact); the public advertised set is their intersection
   * (`availableLocales ∩ _availableVersionLocales`).
   *
   * Like `useAsPath`, the value is system metadata edited via a non-field
   * sidebar widget — `availableLocales` is a reserved name and cannot be
   * declared as a field. Advertising locales is only meaningful when the
   * collection has at least one `localized` field, so the validator rejects
   * `advertiseLocales: true` on a collection with none.
   *
   * See `docs/07-internationalization/index.md`.
   */
  advertiseLocales?: boolean

  /**
   * Optional host-defined function that composes a renderable root-relative
   * path for a document in this collection. Called server-side by the
   * richtext write-time walker (when `embedRelationsOnSave` is true on a
   * `richText` field) and the read-time populate visitor (when
   * `populateRelationsOnRead` is true). Sits next to `useAsPath` — that
   * names the field that becomes the slug; this says how the slug
   * composes into a renderable path.
   *
   * Returns a path with a leading slash, or `null` when no path can be
   * built for this document (e.g. the doc is in a state that should not
   * be linked to). Origin / host / protocol AND locale prefix are runtime
   * concerns of the renderer (`LangLink` etc.) and MUST NOT be included —
   * paths returned here are locale-agnostic; the renderer composes the
   * final URL by prepending the request-time locale.
   *
   * Receives the same minimal document shape as
   * `CollectionAdminConfig.preview.url` (`PreviewDocument`-style envelope:
   * top-level columns plus `fields`) so the two hooks can share an
   * implementation today and `preview.url` can default to
   * `buildDocumentPath` in a later pass.
   */
  buildDocumentPath?: (
    doc: { id: string; path: string; status: string; fields: Record<string, any> },
    ctx: { collectionPath: string }
  ) => string | null

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
   * When `true`, documents in this collection carry a fractional-index
   * `order_key` and the list view sorts by it ascending by default, with
   * drag-to-reorder enabled in the admin UI.
   *
   * Storage: `byline_documents.order_key` — system metadata, never per-version
   * and never EAV. Reordering writes the single column and does NOT mint a
   * new document version.
   *
   * Backfill: existing rows in newly-`orderable` collections start with
   * `order_key = NULL`. They sort to the bottom (NULLS LAST) until the
   * editor drags them into position.
   *
   * Lives on the schema (not admin config) because it has structural
   * consequences across layers — `document-lifecycle` appends a key on
   * create, the reorder server fn gates on it, and the `@byline/client`
   * SDK can default-sort on it without crossing into presentation config.
   *
   * Orthogonal to `hasMany` array order. Use this for top-level order
   * inside a collection (bios, team members, FAQ items, sections).
   */
  orderable?: boolean

  /**
   * When `true`, this collection is a **document tree** — a self-referential,
   * single-parent ordered hierarchy (the structural backbone for documentation
   * / book sites). Each node's parent and its per-parent sibling order are
   * stored document-grain and unversioned in `byline_document_relationships`
   * and mutated via the dedicated tree commands (`placeTreeNode` /
   * `removeFromTree`), which mint no document version — exactly like `path`,
   * `availableLocales`, and `order_key`.
   *
   * Lives on the schema (not `defineAdmin`) because it changes **storage
   * authority and the read path**, not just presentation: it turns on the
   * edge-table storage + commands, the recursive tree read path
   * (`getTreeSubtree` / `getTreeAncestors` / `getTreeChildren`), the authoring
   * tree widget, and the structural-change invalidation event.
   *
   * Mutually exclusive with `orderable`: the tree owns ordering (per-parent, on
   * the edge row), so `byline_documents.order_key` is inert for a tree
   * collection. Setting both throws at startup.
   *
   * The hierarchy is *meta* — it describes where a document sits in a table of
   * contents and says nothing about its content; re-parenting and reordering
   * touch no user fields. Do **not** also declare a `parent` relation field; the
   * tree owns structure (a topic that genuinely belongs in two places is a
   * cross-link relation field, never a second tree edge). See
   * docs/04-collections/03-document-trees.md.
   */
  tree?: boolean
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

/** Broad collection registry used when an application has not supplied its schema types. */
export type CollectionRegistry = Record<string, Record<string, any>>

/** Infer a path-to-fields registry from a shared readonly collection-definition tuple. */
export type InferCollectionRegistry<TCollections extends readonly CollectionDefinition[]> = {
  [TCollection in TCollections[number] as TCollection['path']]: CollectionFieldData<TCollection>
}

// ---------------------------------------------------------------------------
// Block helpers — mirrors of defineCollection / CollectionFieldData / etc.
// ---------------------------------------------------------------------------

/**
 * Type-safe factory for creating a Block. Returns the definition as-is,
 * but locks in literal types for `blockType`, field names, and select
 * option values — so `BlockFieldData<typeof MyBlock>` and the
 * `_type: B['blockType']` discriminant resolve precisely. Replaces the
 * `as const satisfies Block` pattern.
 */
export function defineBlock<const B extends Block>(definition: B & Block): B {
  return definition
}

/**
 * Field-only data shape inferred from a block schema. The counterpart
 * to `CollectionFieldData<C>` — use this when you want just the
 * editable fields (e.g. for forms or block-internal helpers).
 */
export type BlockFieldData<B extends Block> = FieldSetData<B['fields']>
export type BlockFieldDataAllLocales<B extends Block> = FieldSetDataAllLocales<B['fields']>

/**
 * Full block instance shape as it appears inside a document tree:
 * the field data plus the synthetic `_id` / `_type` discriminants
 * written by the storage layer. Use this as the prop type for block
 * renderers — `_type` lets a `switch (block._type)` exhaustively narrow
 * across a `BlocksUnion<typeof MyBlocks>`.
 */
export type BlockData<B extends Block> = Prettify<
  {
    _id: string
    _type: B['blockType']
  } & BlockFieldData<B>
>

/**
 * Discriminated union of `BlockData<B>` over a tuple of block
 * definitions. Drives exhaustive switching in `RenderBlocks`-style
 * renderers.
 *
 * @example
 * ```ts
 * const Blocks = [PhotoBlock, RichTextBlock] as const
 * type AnyBlock = BlocksUnion<typeof Blocks>
 * // → BlockData<typeof PhotoBlock> | BlockData<typeof RichTextBlock>
 * ```
 */
export type BlocksUnion<Bs extends readonly Block[]> = Bs[number] extends infer B
  ? B extends Block
    ? BlockData<B>
    : never
  : never

// ---------------------------------------------------------------------------
// Field helpers — mirror of defineCollection / defineBlock for single fields.
// ---------------------------------------------------------------------------

/**
 * Type-safe factory for creating a single `Field`. Returns the definition
 * as-is, but locks in literal types for `name`, `type`, select option
 * `value`s, etc. — so `FieldData<typeof MyField>` resolves precisely.
 *
 * Useful for fields that are shared across multiple collections (e.g. a
 * `publishedOnField` factory) or for surfacing definition-site type errors
 * on hand-authored fields without waiting for them to be placed inside a
 * `fields: [...]` array. Replaces the `as const satisfies Field` pattern.
 *
 * For factories that *generate* a field shape from input (e.g. a helper whose
 * return type is a mapped type over its options), a custom return type is
 * still the right tool — `defineField` is for identity / passthrough cases.
 *
 * The companion data-shape extractor `FieldData<F>` lives in
 * `field-data-types.ts` and is re-exported from the package root.
 *
 * @example
 * ```ts
 * // A shared "publishedOn" field used across many collections.
 * export const publishedOnField = defineField({
 *   name: 'publishedOn',
 *   label: 'Published On',
 *   type: 'datetime',
 *   mode: 'datetime',
 * })
 *
 * // FieldData<typeof publishedOnField> resolves to `Date`.
 * ```
 */
export function defineField<const F extends Field>(definition: F & Field): F {
  return definition
}

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
