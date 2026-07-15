/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { ERR_AUDIT_UNSUPPORTED, ERR_NOT_FOUND } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { AUDIT_ACTIONS, auditActor, requireAuditCapability, sameLocaleSet } from './audit.js'
import { invokeHook, resolvePathForUpdate, rethrowPathConflict } from './internals.js'
import type { DocumentLifecycleContext } from './context.js'

export interface UpdateDocumentSystemFieldsResult {
  documentId: string
  /** The path actually written, or `undefined` when no path write occurred. */
  path?: string
  /** Whether either system field actually changed. */
  changed: boolean
  /** Whether a no-op request emitted the reconciliation hook. */
  reconciliation: boolean
  pathChanged: boolean
  availableLocalesChanged: boolean
  /** Whether the advertised-locale set was actually rewritten this call. */
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
 *   2. Inside the audit transaction, lock the logical document and read its
 *      authoritative source locale, path, and advertised locales.
 *   3. Path (when supplied): `resolvePathForUpdate` enforces the source-locale
 *      rule (translation-locale path edits are dropped with a warn); a real
 *      change is written via `updateDocumentPath`, mapping the unique-constraint
 *      violation to `ERR_PATH_CONFLICT`.
 *   4. `availableLocales` (when supplied): rewritten wholesale via
 *      `setDocumentAvailableLocales`.
 *
 * Content hooks do not fire because these are not content writes. Actual
 * changes emit `afterSystemFieldsChange` after the audited write commits. A
 * caller can pass `reconcile: true` to emit the same hook for a no-op retry
 * after an earlier post-commit hook failure. Hook failures reject the call but
 * never roll back the already-committed write/audit.
 * Accountability for these mutations is the document-grain audit log: each
 * changed field records a `document.path.changed` /
 * `document.locales.changed` row atomically with the write.
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
    /** Re-run `afterSystemFieldsChange` when requested values are already current. */
    reconcile?: boolean
  }
): Promise<UpdateDocumentSystemFieldsResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'updateDocumentSystemFields' },
    async () => {
      const { db, definition, collectionId, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'update')

      const requestLocale = params.locale ?? defaultLocale
      const explicitPath =
        typeof params.path === 'string' && params.path.length > 0 ? params.path : null
      const requested = {
        path: explicitPath !== null,
        availableLocales: params.availableLocales !== undefined,
      }
      const requestedLocales =
        params.availableLocales === undefined ? undefined : [...new Set(params.availableLocales)]
      const audit = requireAuditCapability(db)
      const lockSystemFields = db.queries.documents.getDocumentSystemFieldsForUpdate?.bind(
        db.queries.documents
      )
      if (lockSystemFields == null) {
        throw ERR_AUDIT_UNSUPPORTED({
          message: 'audited system-field writes require a transaction-scoped lock/read capability',
        })
      }
      const actor = auditActor(ctx)

      // The logical document row is the mutex for both document-grain fields.
      // Reading after that lock prevents concurrent writers from auditing a
      // stale before value or omitting an intermediate old path from the event.
      const outcome = await audit.withTransaction(async () => {
        const snapshot = await lockSystemFields({
          collection_id: collectionId,
          document_id: params.documentId,
        })
        if (snapshot == null) {
          throw ERR_NOT_FOUND({
            message: 'document not found',
            details: { documentId: params.documentId },
          }).log(ctx.logger)
        }

        const sourceLocale = snapshot.source_locale ?? defaultLocale
        const currentPath = snapshot.path ?? undefined
        const currentLocales = snapshot.availableLocales
        const nextLocales = requestedLocales ?? currentLocales
        const pathForCommand = resolvePathForUpdate({
          explicitPath,
          currentPath,
          requestLocale,
          sourceLocale,
          documentId: params.documentId,
          logger: ctx.logger,
        })
        const pathChanged = pathForCommand !== undefined && pathForCommand !== currentPath
        const availableLocalesChanged =
          requestedLocales !== undefined && !sameLocaleSet(currentLocales, nextLocales)

        if (pathChanged) {
          await db.commands.documents
            .updateDocumentPath({
              documentId: params.documentId,
              collectionId,
              locale: sourceLocale,
              path: pathForCommand,
            })
            .catch((err: unknown) => rethrowPathConflict(err, pathForCommand, sourceLocale))
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

        if (availableLocalesChanged) {
          await db.commands.documents.setDocumentAvailableLocales({
            documentId: params.documentId,
            collectionId,
            availableLocales: nextLocales,
          })
          await audit.append({
            documentId: params.documentId,
            collectionId,
            actorId: actor.actorId,
            actorRealm: actor.actorRealm,
            action: AUDIT_ACTIONS.localesChanged,
            field: 'availableLocales',
            before: currentLocales,
            after: nextLocales,
          })
        }

        return {
          pathForCommand,
          pathChanged,
          availableLocalesChanged,
          previousPath: currentPath,
          currentPath: pathChanged ? pathForCommand : currentPath,
          previousAvailableLocales: [...currentLocales],
          currentAvailableLocales: [...nextLocales],
        }
      })

      const changed = outcome.pathChanged || outcome.availableLocalesChanged
      const reconciliation = !changed && params.reconcile === true
      if (changed || reconciliation) {
        const hooks = await resolveHooks(definition)
        await invokeHook(hooks?.afterSystemFieldsChange, {
          documentId: params.documentId,
          collectionPath,
          requested,
          changed: {
            path: outcome.pathChanged,
            availableLocales: outcome.availableLocalesChanged,
          },
          reconciliation,
          previousPath: outcome.previousPath,
          currentPath: outcome.currentPath,
          previousAvailableLocales: outcome.previousAvailableLocales,
          currentAvailableLocales: outcome.currentAvailableLocales,
        })
      }

      return {
        documentId: params.documentId,
        path: outcome.pathChanged ? outcome.pathForCommand : undefined,
        changed,
        reconciliation,
        pathChanged: outcome.pathChanged,
        availableLocalesChanged: outcome.availableLocalesChanged,
        availableLocalesWritten: outcome.availableLocalesChanged,
      }
    }
  )
}
