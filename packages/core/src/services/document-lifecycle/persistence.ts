/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

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
 * Persist the first version of a logical document with lifecycle-owned
 * registration and actor metadata. Authentication, hooks, normalization,
 * counters, path derivation, ordering, and rich-text work stay in the caller
 * so their sequencing remains explicit.
 */
export async function persistInitialDocumentVersion(
  ctx: DocumentLifecycleContext,
  write: InitialDocumentVersionWrite
): ReturnType<IDocumentCommands['createDocumentVersion']> {
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
