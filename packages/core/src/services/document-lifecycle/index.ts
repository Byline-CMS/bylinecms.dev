/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Document lifecycle service.
 *
 * Orchestrates CRUD operations and workflow transitions, invoking collection
 * hooks at the appropriate points. Sits between the API route layer and the
 * storage adapter (`IDbAdapter`) so that every operation path — POST, PUT,
 * PATCH, status change, unpublish — goes through a single set of hooks.
 *
 * Hook invocations run **outside** the storage transaction. They are suitable
 * for logging, cache invalidation, webhooks, and similar side-effects.
 *
 * This module depends only on `@byline/core` types and utilities — it has no
 * dependency on any specific database adapter.
 *
 * One module per operation; shared helpers live in `internals.ts` (not
 * re-exported here — the public surface is exactly this barrel).
 */

export { copyToLocale } from './copy-to-locale.js'
export { createDocument } from './create.js'
export { deleteDocument } from './delete.js'
export { deleteLocale } from './delete-locale.js'
export { duplicateDocument } from './duplicate.js'
export { restoreDocumentVersion } from './restore.js'
export { changeDocumentStatus, unpublishDocument } from './status.js'
export { updateDocumentSystemFields } from './system-fields.js'
export { updateDocument, updateDocumentWithPatches } from './update.js'
export type { DocumentLifecycleContext } from './context.js'
export type { CopyToLocaleResult } from './copy-to-locale.js'
export type { CreateDocumentResult } from './create.js'
export type { DeleteDocumentResult } from './delete.js'
export type { DeleteLocaleResult } from './delete-locale.js'
export type { DuplicateDocumentResult } from './duplicate.js'
export type { RestoreVersionResult } from './restore.js'
export type { ChangeStatusResult, UnpublishResult } from './status.js'
export type { UpdateDocumentSystemFieldsResult } from './system-fields.js'
export type { UpdateDocumentResult, UpdateDocumentWithPatchesResult } from './update.js'
