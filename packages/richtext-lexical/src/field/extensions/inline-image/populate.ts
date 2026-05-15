/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-side populate visitor for the inline-image plugin. Pure /
 * framework-agnostic — imported only from the package's `server` entry.
 *
 * Refreshes `node.document` with `{ title, altText, image, sizes }` from
 * the source media document. Does not touch the inline-image node's
 * top-level `src` / `width` / `height` / `altText` — those are Lexical
 * render state and survive untouched, providing a usable fallback when
 * populate hasn't run.
 */

import type { StoredFileValue } from '@byline/core'

import { deriveImageSizes } from './utils'
import type { LexicalNodeLike, LexicalNodeVisitor } from '../../lexical-populate-shared'

export const inlineImageVisitor: LexicalNodeVisitor = {
  match(node: LexicalNodeLike) {
    if (node.type !== 'inline-image') return null
    const collectionPath = node.targetCollectionPath
    const documentId = node.targetDocumentId
    if (!collectionPath || !documentId) return null
    return {
      node,
      collectionPath,
      documentId,
      apply(target: Record<string, any>) {
        const targetFields = (target.fields ?? {}) as Record<string, any>
        const image = targetFields.image as StoredFileValue | undefined
        const sizes = image ? deriveImageSizes(image) : []
        const next: Record<string, any> = { ...(node.document ?? {}) }
        if (typeof targetFields.title === 'string') next.title = targetFields.title
        if (typeof targetFields.altText === 'string') next.altText = targetFields.altText
        if (image != null) next.image = image
        if (sizes.length > 0) next.sizes = sizes
        node.document = next
      },
    }
  },
}
