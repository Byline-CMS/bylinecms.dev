/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Helpers shared by the per-operation lifecycle modules. Internal to the
 * `document-lifecycle/` directory — nothing here is re-exported through
 * the barrel (`index.ts`), so the package's public surface is unchanged
 * by the per-operation split.
 */

import {
  type CollectionDefinition,
  type CollectionHookSlot,
  type IDbAdapter,
  normalizeCollectionHook,
  type RichTextEmbedFn,
  type RichTextPopulateFn,
} from '../../@types/index.js'
import { getCollectionDefinition, getServerConfig } from '../../config/config.js'
import { DbErrorCodes, ERR_PATH_CONFLICT, ErrorCodes } from '../../lib/errors.js'
import { generateKeyBetween } from '../../lib/fractional-index.js'
import { createReadContext } from '../populate.js'
import { embedRichTextFields } from '../richtext-embed.js'
import { createRichTextDocumentReader } from '../richtext-populate.js'
import type { BylineLogger } from '../../lib/logger.js'
import type { SlugifierFn } from '../../utils/slugify.js'
import type { DocumentLifecycleContext } from './context.js'

/**
 * Matches a canonical UUID (any version). Real admin / end-user actors carry
 * UUID ids (`uuidv7`); synthetic actors do not.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The acting user's id for the version audit trail (`created_by` on
 * `byline_document_versions`).
 *
 * Returns the id only when it is a real **persisted user id** — i.e. a UUID.
 * Synthetic actors used by scripts, seeds, and tests (e.g.
 * `createSuperAdminContext({ id: 'import-docs-script' })`, or the default
 * `'super-admin'`) are **not** users: their non-UUID ids would be rejected by
 * the `uuid` column outright, and the correct audit value for a system/tooling
 * write is NULL regardless. So a non-UUID id — and a missing `requestContext`
 * (the seeds/migrations escape hatch) — both yield `undefined` → NULL
 * `created_by`, which the history strip renders as "unknown". Real
 * `AdminAuth` / `UserAuth` actors always carry UUID ids, so their attribution
 * is unaffected. See docs/07-auth-and-security/02-auditability.md — Workstream 1.
 */
export function actorId(ctx: DocumentLifecycleContext): string | undefined {
  const id = ctx.requestContext?.actor?.id
  return id != null && UUID_RE.test(id) ? id : undefined
}

/**
 * Safely invoke an optional hook slot, awaiting the result if it returns a
 * Promise. When the slot is an array of functions they are executed
 * sequentially in order.
 */
export async function invokeHook<Ctx>(
  hook: CollectionHookSlot<Ctx> | undefined,
  ctx: Ctx
): Promise<void> {
  const fns = normalizeCollectionHook(hook)
  for (const fn of fns) {
    await fn(ctx)
  }
}

/**
 * Run the registered richtext embed adapter across every rich-text leaf
 * in the outgoing document data. Mirror of the read-side
 * `populateRichTextFields` — fires once per write, mutates `data` in
 * place. Per-leaf errors are logged and swallowed by `embedRichTextFields`
 * itself (branch C); document-level errors propagate.
 *
 * No-op when no embed adapter is registered. The bootstrap validator
 * (step 7 of the link-refactor strategy) will eventually fail-fast for
 * collections that declare `embedRelationsOnSave: true` without a
 * registered adapter; until then a missing adapter is silent and writes
 * proceed unmodified.
 */
export async function applyRichTextEmbed(
  ctx: DocumentLifecycleContext,
  data: Record<string, any>
): Promise<void> {
  // Tolerate environments that drive the lifecycle without
  // `initBylineCore()` (unit tests, isolated tooling) — they have no
  // adapter to invoke, so this is a soft no-op.
  let embed: RichTextEmbedFn | undefined
  let richTextPopulate: RichTextPopulateFn | undefined
  let collections: readonly CollectionDefinition[]
  try {
    const config = getServerConfig()
    embed = config.fields?.richText?.embed
    richTextPopulate = config.fields?.richText?.populate
    collections = config.collections
  } catch {
    return
  }
  if (embed == null || ctx.requestContext == null) return
  const readContext = createReadContext()
  const requestContext = { ...ctx.requestContext, readMode: 'published' as const }
  await embedRichTextFields({
    fields: ctx.definition.fields,
    collectionPath: ctx.collectionPath,
    data,
    embed,
    readContext,
    requestContext,
    readMode: 'published',
    readDocuments: createRichTextDocumentReader({
      db: ctx.db,
      collections,
      requestContext,
      readContext,
      readMode: 'published',
      locale: ctx.defaultLocale,
      richTextPopulate,
    }),
    logger: ctx.logger,
  })
}

/**
 * For collections with `orderable: true` on their schema definition, compute
 * an append-at-end fractional-index key for a newly-inserted document.
 * Returns `undefined` when the collection hasn't opted in (or has no
 * definition registered, e.g. in unit-test environments), so the storage row
 * gets `order_key = NULL` and the existing "no ordering" behavior holds.
 */
export async function maybeAppendOrderKey(
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
export function extractVersionId(document: any): string {
  return document?.id ?? document?.document_version_id ?? ''
}

/** Extract the logical document id from the document object returned by `createDocumentVersion`. */
export function extractDocumentId(document: any): string {
  return document?.document_id ?? ''
}

/**
 * Detect a unique-constraint violation on
 * `byline_document_paths(collection_id, locale, path)` and translate it
 * to `ERR_PATH_CONFLICT`. Any other error is rethrown unchanged.
 *
 * Driver anatomy (SQLSTATE codes, `cause`-chain walking, constraint-name
 * carriage) is delegated to `db.classifyError` — the adapter seam that
 * canonicalises a raw driver error into a `DbErrorClassification`. This
 * function only knows the classification codes and the path constraint's
 * name substring; it stays targeted to the path constraint so unrelated
 * unique violations aren't spuriously rebranded as path conflicts.
 */
export function rethrowPathConflict(
  db: IDbAdapter,
  err: unknown,
  path: string,
  locale: string,
  operation: 'create' | 'update' | 'duplicate'
): never {
  const classification = db.classifyError?.(err)
  if (
    classification?.code === DbErrorCodes.UNIQUE_VIOLATION &&
    classification.constraint?.includes('document_paths_collection_locale_path')
  ) {
    const message =
      operation === 'create'
        ? `cannot create a document at path "${path}" because a live document already uses it in this collection (locale: ${locale})`
        : operation === 'update'
          ? `cannot update this document to path "${path}" because a live document already uses it in this collection (locale: ${locale})`
          : `cannot duplicate this document to path "${path}" because a live document already uses it in this collection (locale: ${locale})`
    throw ERR_PATH_CONFLICT({
      message,
      details: { path, locale, constraint: classification.constraint },
    })
  }
  throw err as Error
}

/**
 * Detect whether an error is the `ERR_PATH_CONFLICT` raised by
 * `rethrowPathConflict`. Used by `duplicateDocument`'s retry logic to
 * keep the conflict-handling path separate from genuine errors.
 */
export function isPathConflictError(err: unknown): boolean {
  return (
    err != null &&
    typeof err === 'object' &&
    (err as { code?: string }).code === ErrorCodes.PATH_CONFLICT
  )
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
export function resolvePathForUpdate(args: {
  explicitPath: string | null
  currentPath: string | undefined
  requestLocale: string
  sourceLocale: string
  documentId: string
  logger?: BylineLogger
}): string | undefined {
  const { explicitPath, currentPath, requestLocale, sourceLocale, documentId, logger } = args
  if (requestLocale === sourceLocale) {
    // Source-locale write: pass path through when supplied; otherwise
    // skip the write (existing path row stays as-is — sticky). The path row
    // lives under the document's source_locale (its anchor), not the mutable
    // global default — so this stays correct after the global default is
    // switched. See docs/08-internationalization/index.md.
    return explicitPath ?? undefined
  }
  // Non-source-locale (translation) write: reject any path change with a warn
  // so the operation succeeds but the editor / API caller is informed.
  if (explicitPath !== null && explicitPath !== currentPath) {
    logger?.warn(
      {
        documentId,
        requestedLocale: requestLocale,
        sourceLocale,
        suppliedPath: explicitPath,
        currentPath,
      },
      'path changes apply only on source-locale writes; ignored on translation save'
    )
  }
  return undefined
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
export function derivePath(
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
export function stripMetaIdsInPlace(value: unknown): void {
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
