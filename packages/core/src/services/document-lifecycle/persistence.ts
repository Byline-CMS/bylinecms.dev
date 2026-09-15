/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { assertDocumentFields } from '../../validation/document-fields.js'
import { requireAuditCapability } from './audit.js'
import { actorId } from './internals.js'
import { commitContentVersionWithScheduleSuspension } from './publish-schedule-consistency.js'
import { normalizeDocumentVersionParentError } from './stale-document.js'
import { appendTreeRoot } from './tree.js'
import type { IDocumentCommands } from '../../@types/index.js'
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
 * Persist a new version of an existing logical document and suspend any armed
 * publication schedule atomically. All operation-specific preparation and
 * hook sequencing remains in the caller.
 */
export function persistExistingDocumentVersion(
  ctx: DocumentLifecycleContext,
  write: ExistingDocumentVersionWrite
): ReturnType<IDocumentCommands['createDocumentVersion']> {
  assertWritableContent(ctx, write)
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
