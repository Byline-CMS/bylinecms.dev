/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { findLocalizationMismatches } from '../../storage/localized-toggle.js'
import { assertDocumentFields } from '../../validation/document-fields.js'
import { requireAuditCapability } from './audit.js'
import { hasStructuralChanges } from './has-structural-changes.js'
import { actorId } from './internals.js'
import { mergeWriteLocale } from './merge-write-locale.js'
import { commitContentVersionWithScheduleSuspension } from './publish-schedule-consistency.js'
import { normalizeDocumentVersionParentError } from './stale-document.js'
import { appendTreeRoot } from './tree.js'
import type { IDocumentCommands } from '../../@types/index.js'
import type { UnavailableBlock } from '../../storage/storage-restore.js'
import type { DocumentLifecycleContext } from './context.js'

type AdapterVersionWrite = Parameters<IDocumentCommands['createDocumentVersion']>[0]
type LifecycleOwnedWriteKeys =
  | 'collectionId'
  | 'collectionVersion'
  | 'collectionConfig'
  | 'createdBy'

type InitialDocumentVersionWrite = Omit<
  AdapterVersionWrite,
  LifecycleOwnedWriteKeys | 'documentId' | 'previousVersionId'
>

type ExistingDocumentVersionWrite = Omit<
  AdapterVersionWrite,
  LifecycleOwnedWriteKeys | 'documentId'
> & {
  documentId: string
}

/**
 * The single content gate for versioned writes.
 *
 * Restore is exempt, and the exemption is tied to `action: 'restore'` rather
 * than to a caller-supplied flag: a write cannot obtain it without also
 * declaring itself a restore in the audit trail. Only the document and
 * singleton restore services set that action.
 *
 * The exemption exists because a historical version cannot be corrected
 * through ordinary editing before it is restored. Two independent sources of
 * failure make that fatal rather than inconvenient: the collection's schema
 * may have tightened since the version was written, and validation rules
 * themselves may have changed — corrected `email` and `url` rules can fail a
 * version whose schema never moved at all. Either way the content becomes
 * permanently unrecoverable.
 *
 * Its consequences are deliberate recovery semantics, not guarantees about
 * restored content:
 *
 *  - `beforeUpdate` hooks on a restore run inside the exemption, so content
 *    they produce is not validated either.
 *  - A workflow whose `defaultStatus` is `published` republishes restored
 *    content that fails today's validation.
 *
 * The restored version is still subject to authorization, revision and version
 * ownership checks, hooks, and storage constraints, and the next ordinary
 * content save enforces current validation in full. Schema-aware
 * reconstruction and repair-before-commit are separate future work; skipping
 * validation does not address them.
 */
function assertWritableContent(
  ctx: DocumentLifecycleContext,
  write: { documentData: Record<string, any>; locale?: string; action?: string }
): void {
  if (write.action === 'restore') return
  assertDocumentFields(
    ctx.definition.fields,
    write.documentData,
    write.locale ?? ctx.defaultLocale,
    ctx.logger
  )
}

/**
 * Persist the first version of a logical document with lifecycle-owned
 * registration and actor metadata. Authentication, hooks, normalization,
 * counters, path derivation, ordering, and rich-text work stay in the caller
 * so their sequencing remains explicit.
 */
export async function persistInitialDocumentVersion(
  ctx: DocumentLifecycleContext,
  write: InitialDocumentVersionWrite
): ReturnType<IDocumentCommands['createDocumentVersion']> {
  assertWritableContent(ctx, write)
  return requireAuditCapability(ctx.db).withTransaction(async () => {
    await ctx.db.commands.collections.lockCollectionRegistration(
      ctx.collectionId,
      ctx.definition.tree === true || ctx.definition.singleton === true ? 'exclusive' : 'shared'
    )
    const result = await ctx.db.commands.documents.createDocumentVersion({
      ...write,
      collectionId: ctx.collectionId,
      collectionVersion: ctx.collectionVersion,
      collectionConfig: ctx.definition,
      createdBy: actorId(ctx),
    })
    if (ctx.definition.tree === true) await appendTreeRoot(ctx, result.document.document_id)
    return result
  })
}

/**
 * Whether a stored version holds a row written under a field's previous
 * `localized` flag: a shared row on a now-localized field, or a locale row on
 * a now-shared field (localized-toggle spec section 4.3). It examines every
 * stored `(field_path, locale)` pair of the version, not the rows a read
 * happened to load, so a stale row in a locale outside the save's read chain
 * still counts.
 *
 * Callers run it inside their write transaction. The adapters run the query
 * (and the merged write's `getDocumentByVersion` map read) on the ambient
 * transaction's connection, so a save never waits for a second pool
 * connection. Every caller passes the document's current version as observed
 * before its write transaction began, so the version is committed either way.
 *
 * Internal to the lifecycle services; not part of the public barrel.
 */
export async function versionHasLocalizationMismatch(
  ctx: DocumentLifecycleContext,
  versionId: string
): Promise<boolean> {
  const pairs = await ctx.db.queries.documents.listVersionFieldLocales({
    document_version_id: versionId,
  })
  return findLocalizationMismatches(ctx.definition.fields, pairs).length > 0
}

/**
 * Persist a new version of an existing logical document and suspend any armed
 * publication schedule atomically. All operation-specific preparation and
 * hook sequencing remains in the caller.
 */
export async function persistExistingDocumentVersion(
  ctx: DocumentLifecycleContext,
  write: ExistingDocumentVersionWrite,
  previousRead?: {
    fields?: Record<string, any>
    unavailableBlocks?: readonly UnavailableBlock[]
  } | null
): ReturnType<IDocumentCommands['createDocumentVersion']> {
  assertWritableContent(ctx, write)
  // Single-locale storage writes copy other locales' positional rows forward.
  // Structural edits and incompatible previous rows make that unsafe, so rebuild
  // all locales by item identity instead, written as one `locale: 'all'` map:
  //  - after compaction, positional rows can resurrect unavailable blocks or
  //    attach a translation to the wrong survivor;
  //  - adding, removing, replacing or moving items changes which identity is
  //    at a stored position, including inside otherwise unchanged containers;
  //  - after a field's `localized` flag changed, copy-forward skips the old
  //    shared row of a now-localized field (losing its value in every other
  //    locale) and carries stale locale rows of a now-shared field.
  // The map read converts toggled rows (spec 4.1/4.2); the merged write
  // persists that converted shape. No `collection_version` shortcut: a version
  // stamped with the current collection version can still hold stale rows.
  if (write.previousVersionId && write.locale && write.locale !== 'all') {
    const mismatch = await versionHasLocalizationMismatch(ctx, write.previousVersionId)
    const structuralChange = hasStructuralChanges(
      ctx.definition.fields,
      previousRead?.fields ?? {},
      write.documentData
    )
    if (previousRead?.unavailableBlocks?.length || mismatch || structuralChange) {
      const previous = await ctx.db.queries.documents.getDocumentByVersion({
        document_version_id: write.previousVersionId,
        document_id: write.documentId,
        collection_id: ctx.collectionId,
        locale: 'all',
      })
      if (previous && (previous.unavailableBlocks?.length || mismatch || structuralChange)) {
        write = {
          ...write,
          documentData: mergeWriteLocale(
            ctx.definition.fields,
            previous.fields,
            write.documentData,
            write.locale
          ),
          locale: 'all',
        }
      }
    }
  }
  return commitContentVersionWithScheduleSuspension({
    ctx,
    documentId: write.documentId,
    write: () =>
      ctx.db.commands.documents.createDocumentVersion({
        ...write,
        collectionId: ctx.collectionId,
        collectionVersion: ctx.collectionVersion,
        collectionConfig: ctx.definition,
        createdBy: actorId(ctx),
      }),
  }).catch((error: unknown) => {
    throw normalizeDocumentVersionParentError(error)
  })
}
