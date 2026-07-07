/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { ERR_CONFLICT, ERR_NOT_FOUND, ERR_PATCH_FAILED } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { applyPatches } from '../../patches/index.js'
import { normaliseDateFields } from '../../utils/normalise-dates.js'
import { getDefaultStatus } from '../../workflow/workflow.js'
import { assignCounterValues } from '../assign-counter-values.js'
import {
  actorId,
  applyRichTextEmbed,
  extractDocumentId,
  extractVersionId,
  invokeHook,
  resolvePathForUpdate,
  rethrowPathConflict,
  selfHealTreePlacement,
} from './internals.js'
import type { DocumentPatch } from '../../patches/index.js'
import type { DocumentLifecycleContext } from './context.js'

export interface UpdateDocumentResult {
  documentId: string
  documentVersionId: string
}

export interface UpdateDocumentWithPatchesResult {
  documentId: string
  documentVersionId: string
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
    /**
     * The editorial advertised-locale set. `undefined` leaves the existing
     * set untouched (sticky — document-grain, like `path`); an explicit array
     * (empty included) replaces it wholesale. Driven by the admin
     * available-locales sidebar widget. See docs/07-internationalization/index.md.
     */
    availableLocales?: string[]
  }
): Promise<UpdateDocumentResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'updateDocument' },
    async () => {
      const { db, definition, collectionId, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'update')
      const hooks = await resolveHooks(definition)
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
      const sourceLocale = (originalData.source_locale as string | undefined) ?? defaultLocale
      const pathForCommand = resolvePathForUpdate({
        explicitPath,
        currentPath: originalData.path as string | undefined,
        requestLocale,
        sourceLocale,
        documentId: params.documentId,
        logger: ctx.logger,
      })

      await applyRichTextEmbed(ctx, data)

      const result = await db.commands.documents
        .createDocumentVersion({
          documentId: params.documentId,
          collectionId,
          collectionVersion: ctx.collectionVersion,
          collectionConfig: definition,
          action: 'update',
          documentData: data,
          path: pathForCommand,
          availableLocales: params.availableLocales,
          status: defaultStatus,
          locale: requestLocale,
          previousVersionId: originalData.document_version_id as string | undefined,
          createdBy: actorId(ctx),
        })
        .catch((err: unknown) => rethrowPathConflict(err, pathForCommand ?? '', defaultLocale))

      const documentId = extractDocumentId(result.document) || params.documentId
      const documentVersionId = extractVersionId(result.document)

      // Self-heal: re-root a genuinely-unplaced doc in a tree collection so any
      // save re-trees a stray (system step, best-effort, no-op when placed).
      await selfHealTreePlacement(ctx, documentId)

      await invokeHook(hooks?.afterUpdate, {
        data,
        originalData,
        collectionPath,
        documentId,
        documentVersionId,
        path: pathForCommand ?? (originalData.path as string),
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
    /**
     * The editorial advertised-locale set (typically supplied alongside
     * patches when the admin available-locales widget has been edited).
     * `undefined` leaves the existing set untouched (sticky); an explicit
     * array replaces it wholesale. See docs/07-internationalization/index.md.
     */
    availableLocales?: string[]
  }
): Promise<UpdateDocumentWithPatchesResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'updateDocumentWithPatches' },
    async () => {
      const { db, definition, collectionId, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'update')
      const hooks = await resolveHooks(definition)

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
      const sourceLocale = (originalData.source_locale as string | undefined) ?? defaultLocale
      const pathForCommand = resolvePathForUpdate({
        explicitPath,
        currentPath: originalData.path as string | undefined,
        requestLocale,
        sourceLocale,
        documentId: params.documentId,
        logger: ctx.logger,
      })

      await applyRichTextEmbed(ctx, nextData)

      const result = await db.commands.documents
        .createDocumentVersion({
          documentId: params.documentId,
          collectionId,
          collectionVersion: ctx.collectionVersion,
          collectionConfig: definition,
          action: 'update',
          documentData: nextData,
          path: pathForCommand,
          availableLocales: params.availableLocales,
          status: defaultStatus,
          locale: requestLocale,
          previousVersionId: originalData.document_version_id as string | undefined,
          createdBy: actorId(ctx),
        })
        .catch((err: unknown) => rethrowPathConflict(err, pathForCommand ?? '', defaultLocale))

      const documentId = extractDocumentId(result.document) || params.documentId
      const documentVersionId = extractVersionId(result.document)

      // Self-heal: re-root a genuinely-unplaced doc in a tree collection so any
      // save re-trees a stray (system step, best-effort, no-op when placed).
      await selfHealTreePlacement(ctx, documentId)

      // 7. afterUpdate hook.
      await invokeHook(hooks?.afterUpdate, {
        data: nextData,
        originalData,
        collectionPath,
        documentId,
        documentVersionId,
        path: pathForCommand ?? (originalData.path as string),
      })

      return { documentId, documentVersionId }
    }
  )
}
