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

import { normalizeCollectionHook, resolveHooks } from '../@types/index.js'
import { resolveReadContextRoot } from '../auth/read-context-scope.js'
import { ERR_READ_RECURSION } from '../lib/errors.js'
import type {
  AfterReadContext,
  CollectionDefinition,
  CollectionHookSlot,
  ReadContext,
  ReadMode,
} from '../@types/index.js'

async function invokeHook<Ctx>(hook: CollectionHookSlot<Ctx> | undefined, ctx: Ctx): Promise<void> {
  const fns = normalizeCollectionHook(hook)
  for (const fn of fns) {
    await fn(ctx)
  }
}

/**
 * Fire the `afterRead` hook for one reconstructed document.
 *
 * No-op when the collection has no hook, when this exact materialized object
 * completed the hook already. An active logical version fails closed with
 * `ERR_READ_RECURSION`: even the same object may be only partially processed,
 * so returning it cannot be proven safe. Fresh raw objects are always redacted
 * once the active call completes. Failed hooks do not mark the object complete,
 * and active state is cleared in `finally` so a later retry can proceed.
 *
 * The hook receives the raw storage-shape document (mutable) and the
 * operation's authenticated context plus the shared `ReadContext`, so it can
 * redact by actor and thread the same context through any
 * nested `client.collection(...).findById(id, { _readContext })` calls.
 */
export async function applyAfterRead(params: {
  doc: Record<string, any>
  definition: CollectionDefinition
  readContext: ReadContext
  requestContext: import('@byline/auth').RequestContext
  locale?: string
  readMode?: ReadMode
  projection?: readonly string[]
  materialization?: string
}): Promise<void> {
  const resolved = await resolveHooks(params.definition)
  const hook = resolved?.afterRead
  if (!hook) return
  const docId = params.doc?.document_id
  if (typeof docId !== 'string') return

  const versionId =
    typeof params.doc?.document_version_id === 'string'
      ? params.doc.document_version_id
      : `document:${docId}`
  const state = getAfterReadState(params.readContext)
  if (state.processed.has(params.doc)) return
  // ReadContext already scopes the operation; keeping identity out of this key
  // prevents a nested caller from evading the guard with another context clone.
  const activeKey = `${params.definition.path}:${versionId}`
  if (state.active.has(activeKey)) {
    throw ERR_READ_RECURSION({
      message: `afterRead recursion blocked for active version '${versionId}'`,
      details: {
        collectionPath: params.definition.path,
        documentId: docId,
        documentVersionId: versionId,
      },
    })
  }

  const ctx: AfterReadContext = {
    doc: params.doc,
    collectionPath: params.definition.path,
    requestContext: params.requestContext,
    readContext: params.readContext,
  }
  state.active.add(activeKey)
  try {
    await invokeHook(hook, ctx)
    state.processed.add(params.doc)
  } finally {
    state.active.delete(activeKey)
  }
}

interface AfterReadState {
  active: Set<string>
  processed: WeakSet<object>
}

const afterReadStates = new WeakMap<ReadContext, AfterReadState>()

function getAfterReadState(readContext: ReadContext): AfterReadState {
  const root = resolveReadContextRoot(readContext)
  const existing = afterReadStates.get(root)
  if (existing) return existing
  const state: AfterReadState = { active: new Set(), processed: new WeakSet() }
  afterReadStates.set(root, state)
  return state
}
