/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Document read service.
 *
 * Minimal helper — the read path does not need the heavy orchestration of
 * `document-lifecycle` (dates, patches, versioning, concurrency checks),
 * only a consistent place to invoke the `afterRead` hook. `populateDocuments`
 * and `@byline/client` both call through here so hook firing is uniform
 * regardless of how a document is read.
 *
 * Callers that intentionally want **raw** adapter output (admin debug
 * views, migration scripts) simply skip this helper — hooks are opt-in at
 * the call site, following the same pattern as the write services where
 * using `db.commands.documents.createDocumentVersion` directly skips the
 * `beforeCreate` / `afterCreate` hooks.
 */

import type {
  AfterReadContext,
  CollectionDefinition,
  CollectionHookSlot,
  ReadContext,
} from '../@types/index.js'
import { normalizeCollectionHook } from '../@types/index.js'

async function invokeHook<Ctx>(
  hook: CollectionHookSlot<Ctx> | undefined,
  ctx: Ctx
): Promise<void> {
  const fns = normalizeCollectionHook(hook)
  for (const fn of fns) {
    await fn(ctx)
  }
}

/**
 * Fire the `afterRead` hook for one reconstructed document.
 *
 * No-op when the collection has no hook. No-op when the document has
 * already been through `afterRead` in this `ReadContext` — enforces the
 * "once per document per logical request" rule that forecloses the
 * A→B→A infinite loop when hooks perform their own reads.
 *
 * The hook receives the raw storage-shape document (mutable) and the
 * shared `ReadContext` so it can thread the same context through any
 * nested `client.collection(...).findById(id, { _readContext })` calls.
 */
export async function applyAfterRead(params: {
  doc: Record<string, any>
  definition: CollectionDefinition
  readContext: ReadContext
}): Promise<void> {
  const hook = params.definition.hooks?.afterRead
  if (!hook) return
  const docId = params.doc?.document_id
  if (typeof docId !== 'string') return

  const key = `${params.definition.path}:${docId}`
  if (params.readContext.afterReadFired.has(key)) return
  params.readContext.afterReadFired.add(key)

  const ctx: AfterReadContext = {
    doc: params.doc,
    collectionPath: params.definition.path,
    readContext: params.readContext,
  }
  await invokeHook(hook, ctx)
}
