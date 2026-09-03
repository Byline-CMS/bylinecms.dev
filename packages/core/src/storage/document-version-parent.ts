/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_CONFLICT } from '../lib/errors.js'

export type DocumentVersionParentConflictReason = 'missing' | 'stale'

export interface DocumentVersionParentAssertion {
  documentId: string
  locale?: string
  previousVersionId?: string
  currentVersionId: string | null
}

/**
 * Protect immutable-version carry-forward from an absent or stale parent.
 * Callers must obtain `currentVersionId` while holding the logical document's
 * write lock; this helper owns only the adapter-independent invariant.
 */
export function assertDocumentVersionParent(params: DocumentVersionParentAssertion): void {
  const localeScopedWrite = params.locale != null && params.locale !== 'all'
  const reason: DocumentVersionParentConflictReason | null =
    localeScopedWrite && params.currentVersionId != null && params.previousVersionId == null
      ? 'missing'
      : params.previousVersionId != null && params.previousVersionId !== params.currentVersionId
        ? 'stale'
        : null

  if (reason == null) return

  throw ERR_CONFLICT({
    message:
      reason === 'missing'
        ? 'previous document version is required for a locale-scoped write'
        : 'previous document version is stale',
    details: {
      reason,
      documentId: params.documentId,
      previousVersionId: params.previousVersionId ?? null,
      currentVersionId: params.currentVersionId,
    },
  })
}
