/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-side populate visitor for the link plugin. Pure / framework-
 * agnostic — imported only from the package's `server` entry.
 *
 * Refreshes `attributes.document` on `link` nodes whose
 * `attributes.linkType` is `'internal'`. Tight projection — `{ title,
 * path }` only, matching what the link modal embeds at picker time.
 *
 * `linkType: 'custom'` links carry a literal URL and have no relation
 * envelope; they're skipped. Auto-link nodes (`type: 'autolink'`) are
 * also skipped — they're derived from URL patterns and never internal.
 */

import type { LexicalNodeLike, LexicalNodeVisitor } from '../../lexical-populate-shared'

export const linkVisitor: LexicalNodeVisitor = {
  match(node: LexicalNodeLike) {
    if (node.type !== 'link') return null
    const attributes = node.attributes
    if (attributes == null) return null
    if (attributes.linkType !== 'internal') return null
    const collectionPath = attributes.targetCollectionPath as string | undefined
    const documentId = attributes.targetDocumentId as string | undefined
    if (!collectionPath || !documentId) return null
    return {
      node,
      collectionPath,
      documentId,
      apply(target: Record<string, any>) {
        const targetFields = (target.fields ?? {}) as Record<string, any>
        const path = target.path as string | undefined
        const title = targetFields.title as string | undefined
        const next: Record<string, any> = { ...(attributes.document ?? {}) }
        if (typeof title === 'string' && title.length > 0) next.title = title
        if (typeof path === 'string' && path.length > 0) next.path = path
        attributes.document = next
      },
    }
  },
}
