/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { ERR_PATCH_FAILED, ERR_VALIDATION } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { applyPatches } from '../../patches/index.js'
import { normaliseDateFields } from '../../utils/normalise-dates.js'
import { getDefaultStatus, getWorkflowStatuses } from '../../workflow/workflow.js'
import { assignCounterValues } from '../assign-counter-values.js'
import { normalizeNumericFields } from '../normalize-numeric-fields.js'
import { runCommittedDocumentHook } from './committed-hook.js'
import {
  applyRichTextEmbed,
  extractDocumentId,
  extractVersionId,
  invokeHook,
  resolvePathForUpdate,
  rethrowPathConflict,
} from './internals.js'
import { persistExistingDocumentVersion } from './persistence.js'
import { commitGuardedDocumentMutation, readDocumentForMutation } from './revision-guard.js'
import {
  finishSystemFieldMutation,
  updateDocumentSystemFields,
  writeSystemFieldsInTransaction,
} from './system-fields.js'
import { selfHealTreePlacement } from './tree.js'
import type { DocumentPatch } from '../../patches/index.js'
import type { DocumentLifecycleContext } from './context.js'

export interface UpdateDocumentResult {
  documentId: string
  documentVersionId: string
  revision: number
}

export interface UpdateDocumentWithPatchesResult {
  documentId: string
  documentVersionId: string
  revision: number
}

/**
 * Update a document via full replacement (PUT semantics).
 *
 * Unlike the previous implementation, this now fetches the current version
 * from storage to provide a real `originalData` to hooks.
 *
 * Flow:
 *   1. Fetch current document via `getDocumentById({ reconstruct: true })`
 *   2. Normalize date and numeric fields
 *   3. `hooks.beforeUpdate({ data, originalData, collectionPath })`, then normalize numerics again
 *   4. `db.commands.documents.createDocumentVersion(...)` (action = 'update')
 *   5. `hooks.afterUpdate({ data, originalData, collectionPath, documentId, documentVersionId })`
 */
type UpdateDocumentParams = {
  documentId: string
  expectedRevision: number
  data: Record<string, any>
  locale?: string
  /**
   * Explicit path override. When omitted, the previous version's path
   * carries forward unchanged (sticky). The lifecycle never re-derives
   * `path` from the source field on update — that is an explicit user
   * action driven by the admin path widget.
   */
  path?: string
  /**
   * The editorial advertised-locale set. `undefined` leaves the existing
   * set untouched (sticky — document-grain, like `path`); an explicit array
   * (empty included) replaces it wholesale. Driven by the admin
   * available-locales sidebar widget. See docs/08-internationalization/index.md.
   */
  availableLocales?: string[]
}

export function updateDocument(
  ctx: DocumentLifecycleContext,
  params: UpdateDocumentParams
): Promise<UpdateDocumentResult> {
  return replaceFields(ctx, params, 'editorial')
}

/** Maintenance-only replacement; status is derived from the guarded observation. */
export async function replaceDocumentFieldsPreservingStatus(
  ctx: DocumentLifecycleContext,
  params: Pick<UpdateDocumentParams, 'documentId' | 'data' | 'expectedRevision'>
): Promise<UpdateDocumentResult> {
  assertActorCanPerform(ctx.requestContext, ctx.definition, 'update')
  ctx.requestContext?.actor?.assertAbility('system.documentMaintenance')
  return replaceFields(ctx, { ...params, locale: 'all' }, 'preserve')
}

function preservedStatus(ctx: DocumentLifecycleContext, status: string | null): string {
  if (status === null || !getWorkflowStatuses(ctx.definition).some((item) => item.name === status))
    throw ERR_VALIDATION({
      message: 'The observed status is no longer declared by this collection',
      details: { status },
    })
  if (status === 'published') assertActorCanPerform(ctx.requestContext, ctx.definition, 'publish')
  return status
}

async function replaceFields(
  ctx: DocumentLifecycleContext,
  params: UpdateDocumentParams,
  policy: 'editorial' | 'preserve'
): Promise<UpdateDocumentResult> {
  params = { ...params, availableLocales: params.availableLocales?.slice() }
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'updateDocument' },
    async () => {
      const { db, definition, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, definition, 'update')
      const data = params.data

      // Fetch the real original so hooks get accurate originalData (fixes the
      // PUT handler bug where originalData === data).
      const latest = await readDocumentForMutation(ctx, params)
      if (policy === 'preserve') preservedStatus(ctx, latest.status)
      const hooks = await resolveHooks(definition)
      const previousVersionId = latest.document_version_id as string
      const observedPath = latest.path as string | undefined
      const observedSourceLocale = (latest.source_locale as string | undefined) ?? defaultLocale

      const originalData: Record<string, any> = (latest as Record<string, any>) ?? {}

      normaliseDateFields(data)
      normalizeNumericFields(definition.fields, data)

      await invokeHook(hooks?.beforeUpdate, { data, originalData, collectionPath })
      normalizeNumericFields(definition.fields, data)

      // Counter fields are immutable: carry their values forward from the
      // previous version rather than trusting whatever (or nothing) the
      // caller sent. Lazy-allocates when a counter was added to the
      // collection after this document was first created.
      // originalData is the document envelope (with `.fields`, `.path`,
      // `.document_version_id`); assignCounterValues expects field-shape.
      await assignCounterValues({
        fields: definition.fields,
        data,
        previousData: (originalData.fields as Record<string, any>) ?? originalData,
        counters: db.commands.counters,
      })

      const defaultStatus = getDefaultStatus(definition)

      const explicitPath =
        typeof params.path === 'string' && params.path.length > 0 ? params.path : null
      const requestLocale = params.locale ?? defaultLocale
      // The document's own content-locale anchor governs which save writes the
      // path row — not the mutable global default. Falls back to the global
      // default for rows predating source_locale (not yet backfilled).
      const sourceLocale = observedSourceLocale
      const pathForCommand = resolvePathForUpdate({
        explicitPath,
        currentPath: observedPath,
        requestLocale,
        sourceLocale,
        documentId: params.documentId,
        logger: ctx.logger,
      })

      await applyRichTextEmbed(ctx, data)

      const committed = await commitGuardedDocumentMutation(
        ctx,
        {
          documentId: params.documentId,
          expectedRevision: params.expectedRevision,
          previousVersionId,
          locale: requestLocale,
        },
        async (locked) => {
          const systemFields = await writeSystemFieldsInTransaction(ctx, params, locked)
          const result = await persistExistingDocumentVersion(ctx, {
            documentId: params.documentId,
            action: 'update',
            documentData: data,
            path: pathForCommand,
            status: policy === 'preserve' ? preservedStatus(ctx, locked.status) : defaultStatus,
            locale: requestLocale,
            previousVersionId,
          })
          if (policy === 'preserve' && locked.status === 'published') {
            await db.commands.documents.archivePublishedVersions({
              document_id: params.documentId,
              excludeVersionId: extractVersionId(result.document),
            })
          }
          await selfHealTreePlacement(ctx, params.documentId)
          return { value: { result, systemFields }, changed: true }
        },
        policy === 'preserve' ? { collectionLock: 'exclusive' } : {}
      ).catch((err: unknown) =>
        rethrowPathConflict(db, err, pathForCommand ?? '', sourceLocale, 'update')
      )
      const { result, systemFields } = committed.value
      const revision = committed.revision

      const documentId = extractDocumentId(result.document) || params.documentId
      const documentVersionId = extractVersionId(result.document)

      await finishSystemFieldMutation(ctx, params, { ...systemFields, documentVersionId }, revision)
      await runCommittedDocumentHook(
        ctx,
        { phase: 'afterUpdate', documentId, documentVersionId, revision },
        () =>
          invokeHook(hooks?.afterUpdate, {
            data,
            originalData,
            collectionPath,
            documentId,
            documentVersionId,
            path: pathForCommand ?? (originalData.path as string),
          })
      )

      return { documentId, documentVersionId, revision }
    }
  )
}

/**
 * Update a document via patch application.
 *
 * Flow:
 *   1. Fetch current document via `getDocumentById({ reconstruct: true })`
 *   2. Validate the observed document revision before preparation
 *   3. `applyPatches(definition, originalData, patches)` → `nextData`
 *   4. Normalize date and numeric fields
 *   5. `hooks.beforeUpdate({ data: nextData, originalData, collectionPath })`, then normalize numerics again
 *   6. `db.commands.documents.createDocumentVersion(...)` (action = 'update')
 *   7. `hooks.afterUpdate({ data: nextData, originalData, collectionPath, documentId, documentVersionId })`
 *
 * @throws {BylineError} ERR_DOCUMENT_STALE if the observed revision is stale.
 * @throws {BylineError} ERR_PATCH_FAILED if `applyPatches` fails.
 */
export async function updateDocumentWithPatches(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    expectedRevision: number
    patches: DocumentPatch[]
    locale?: string
    /**
     * Explicit path override (typically supplied alongside patches when
     * the admin path widget has been edited). When omitted, sticky from
     * the previous version.
     */
    path?: string
    /**
     * The editorial advertised-locale set (typically supplied alongside
     * patches when the admin available-locales widget has been edited).
     * `undefined` leaves the existing set untouched (sticky); an explicit
     * array replaces it wholesale. See docs/08-internationalization/index.md.
     */
    availableLocales?: string[]
  }
): Promise<UpdateDocumentWithPatchesResult> {
  params = { ...params, availableLocales: params.availableLocales?.slice() }
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'updateDocumentWithPatches' },
    async () => {
      const { db, definition, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, definition, 'update')

      // 1. Fetch current document.
      const latest = await readDocumentForMutation(ctx, params)
      const hooks = await resolveHooks(definition)
      const previousVersionId = latest.document_version_id as string
      const observedPath = latest.path as string | undefined
      const observedSourceLocale = (latest.source_locale as string | undefined) ?? defaultLocale

      const originalData = latest

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
      normalizeNumericFields(definition.fields, nextData)

      // 5. beforeUpdate hook.
      await invokeHook(hooks?.beforeUpdate, { data: nextData, originalData, collectionPath })
      normalizeNumericFields(definition.fields, nextData)

      // 5b. Carry counter values forward from the previous version (or
      // lazy-allocate if the previous version is missing a value). See
      // updateDocument for the rationale — patch-based updates are
      // subject to the same immutability contract.
      await assignCounterValues({
        fields: definition.fields,
        data: nextData,
        previousData: (originalData.fields as Record<string, any>) ?? {},
        counters: db.commands.counters,
      })

      // 6. Persist.
      const defaultStatus = getDefaultStatus(definition)

      const explicitPath =
        typeof params.path === 'string' && params.path.length > 0 ? params.path : null
      const requestLocale = params.locale ?? defaultLocale
      // The document's own content-locale anchor governs which save writes the
      // path row — not the mutable global default. Falls back to the global
      // default for rows predating source_locale (not yet backfilled).
      const sourceLocale = observedSourceLocale
      const pathForCommand = resolvePathForUpdate({
        explicitPath,
        currentPath: observedPath,
        requestLocale,
        sourceLocale,
        documentId: params.documentId,
        logger: ctx.logger,
      })

      await applyRichTextEmbed(ctx, nextData)

      const committed = await commitGuardedDocumentMutation(
        ctx,
        {
          documentId: params.documentId,
          expectedRevision: params.expectedRevision,
          previousVersionId,
          locale: requestLocale,
        },
        async (locked) => {
          const systemFields = await writeSystemFieldsInTransaction(ctx, params, locked)
          const result = await persistExistingDocumentVersion(ctx, {
            documentId: params.documentId,
            action: 'update',
            documentData: nextData,
            path: pathForCommand,
            status: defaultStatus,
            locale: requestLocale,
            previousVersionId,
          })
          await selfHealTreePlacement(ctx, params.documentId)
          return { value: { result, systemFields }, changed: true }
        }
      ).catch((err: unknown) =>
        rethrowPathConflict(db, err, pathForCommand ?? '', sourceLocale, 'update')
      )
      const { result, systemFields } = committed.value
      const revision = committed.revision

      const documentId = extractDocumentId(result.document) || params.documentId
      const documentVersionId = extractVersionId(result.document)

      // 7. afterUpdate hook.
      await finishSystemFieldMutation(ctx, params, { ...systemFields, documentVersionId }, revision)
      await runCommittedDocumentHook(
        ctx,
        { phase: 'afterUpdate', documentId, documentVersionId, revision },
        () =>
          invokeHook(hooks?.afterUpdate, {
            data: nextData,
            originalData,
            collectionPath,
            documentId,
            documentVersionId,
            path: pathForCommand ?? (originalData.path as string),
          })
      )

      return { documentId, documentVersionId, revision }
    }
  )
}

/** Combined patch/content and optional metadata save, with one guarded commit. */
export async function saveDocument(
  ctx: DocumentLifecycleContext,
  params: Parameters<typeof updateDocumentWithPatches>[1]
) {
  if (params.patches.length === 0) return updateDocumentSystemFields(ctx, params)
  return updateDocumentWithPatches(ctx, params)
}
