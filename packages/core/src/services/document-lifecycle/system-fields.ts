/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { ERR_NOT_FOUND } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { AUDIT_ACTIONS, auditActor, requireAuditCapability, sameLocaleSet } from './audit.js'
import { resolvePathForUpdate, rethrowPathConflict } from './internals.js'
import type { DocumentLifecycleContext } from './context.js'

export interface UpdateDocumentSystemFieldsResult {
  documentId: string
  /** The path actually written, or `undefined` when no path write occurred. */
  path?: string
  /** Whether the advertised-locale set was rewritten this call. */
  availableLocalesWritten: boolean
}

/**
 * Write a document's system-managed, document-grain fields — `path` and the
 * editorial `availableLocales` set — **without** minting a new version or
 * touching workflow status.
 *
 * These fields are document-grain (they live in `byline_document_paths` and
 * `byline_document_available_locales`, keyed by logical document, sticky across
 * versions), so a workflow status change would falsely imply the edit is gated
 * behind publish. It is not: the write is immediate and applies across every
 * version. This service backs the admin path / available-locales widgets'
 * direct-write Save (the `direct-write` and `both` dirty-reason cases). The
 * public *advertised* set remains the intersection of `availableLocales` with
 * the resolved version's completeness ledger. See docs/07-internationalization/index.md.
 *
 * Flow:
 *   1. `assertActorCanPerform('update')` — same auth gate as content writes.
 *   2. Fetch the document to resolve its `source_locale` anchor + current path.
 *   3. Path (when supplied): `resolvePathForUpdate` enforces the source-locale
 *      rule (translation-locale path edits are dropped with a warn); a real
 *      change is written via `updateDocumentPath`, mapping the unique-constraint
 *      violation to `ERR_PATH_CONFLICT`.
 *   4. `availableLocales` (when supplied): rewritten wholesale via
 *      `setDocumentAvailableLocales`.
 *
 * No content hooks fire — these are not content writes. Accountability for
 * these mutations is the document-grain audit log: each field that actually
 * changes records a `document.path.changed` / `document.locales.changed` row
 * atomically with the write (docs/06-auth-and-security/02-auditability.md — Workstream 2).
 *
 * @throws {BylineError} ERR_NOT_FOUND if the document does not exist.
 * @throws {BylineError} ERR_PATH_CONFLICT if the path is already in use.
 */
export async function updateDocumentSystemFields(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    locale?: string
    /**
     * Explicit path override from the path widget. `null` / empty / omitted
     * means "no path write" (the existing row stays sticky). A non-empty
     * string is written when the request locale is the document's source
     * locale; on a translation locale it is dropped with a warn.
     */
    path?: string | null
    /**
     * The editorial advertised-locale set from the available-locales widget.
     * `undefined` means "no advertised-locale write"; an explicit array — `[]`
     * included — replaces the set wholesale.
     */
    availableLocales?: string[]
  }
): Promise<UpdateDocumentSystemFieldsResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'updateDocumentSystemFields' },
    async () => {
      const { db, collectionId, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'update')

      const requestLocale = params.locale ?? defaultLocale

      // Resolve the document's source-locale anchor + current path. Both feed
      // the path source-locale guard below; the fetch also asserts existence.
      const latest = await db.queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: params.documentId,
        locale: requestLocale,
        reconstruct: true,
      })

      if (latest == null) {
        throw ERR_NOT_FOUND({
          message: 'document not found',
          details: { documentId: params.documentId },
        }).log(ctx.logger)
      }

      const originalData = latest as Record<string, any>
      const sourceLocale = (originalData.source_locale as string | undefined) ?? defaultLocale

      // Path: honour the same source-locale-only rule the versioned write
      // uses. `resolvePathForUpdate` returns `undefined` to mean "skip the
      // write" (null/empty override, or a translation-locale save).
      const explicitPath =
        typeof params.path === 'string' && params.path.length > 0 ? params.path : null
      const pathForCommand = resolvePathForUpdate({
        explicitPath,
        currentPath: originalData.path as string | undefined,
        requestLocale,
        sourceLocale,
        documentId: params.documentId,
        logger: ctx.logger,
      })

      // Both document-grain writes and their audit rows commit atomically.
      // These fields are non-versioned, so the version stream never records
      // them — the audit log is their only accountability home. One audit row
      // per field that actually changed (docs/06-auth-and-security/02-auditability.md).
      const currentPath = originalData.path as string | undefined
      const currentLocales = (originalData.availableLocales as string[] | undefined) ?? []
      const availableLocalesWritten = params.availableLocales !== undefined

      const audit = requireAuditCapability(db)
      const actor = auditActor(ctx)
      await audit.withTransaction(async () => {
        if (pathForCommand !== undefined) {
          await db.commands.documents
            .updateDocumentPath({
              documentId: params.documentId,
              collectionId,
              locale: sourceLocale,
              path: pathForCommand,
            })
            .catch((err: unknown) => rethrowPathConflict(err, pathForCommand, defaultLocale))
          if (pathForCommand !== currentPath) {
            await audit.append({
              documentId: params.documentId,
              collectionId,
              actorId: actor.actorId,
              actorRealm: actor.actorRealm,
              action: AUDIT_ACTIONS.pathChanged,
              field: 'path',
              before: currentPath ?? null,
              after: pathForCommand,
            })
          }
        }

        // Advertised locales: rewrite the document-grain set wholesale.
        if (params.availableLocales !== undefined) {
          await db.commands.documents.setDocumentAvailableLocales({
            documentId: params.documentId,
            collectionId,
            availableLocales: params.availableLocales,
          })
          if (!sameLocaleSet(currentLocales, params.availableLocales)) {
            await audit.append({
              documentId: params.documentId,
              collectionId,
              actorId: actor.actorId,
              actorRealm: actor.actorRealm,
              action: AUDIT_ACTIONS.localesChanged,
              field: 'availableLocales',
              before: currentLocales,
              after: params.availableLocales,
            })
          }
        }
      })

      return {
        documentId: params.documentId,
        path: pathForCommand,
        availableLocalesWritten,
      }
    }
  )
}
