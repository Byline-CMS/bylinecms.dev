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
 * the source media document. Also refreshes the node's top-level `src` /
 * `width` / `height` — Lexical's admin-editor preview state — from the
 * resolved image, so a re-keyed or regenerated upload stops serving a
 * stale URL to the editor.
 *
 * That preview is position-aware: `getPreferredSize` picks the same
 * variant the picker chose at insert time (`left`/`right` → `card`,
 * `wide` → `desktop`, otherwise `tablet`, with the original as the
 * fallback), so the refresh must go through it rather than assigning
 * `image.storageUrl` directly — otherwise every save would swap the
 * variant for the full-size original and leave the variant's dimensions
 * describing different bytes. Missing targets, missing images, and
 * blank URLs leave all three fields untouched: the visitor never leaves
 * a node emptier than it found it.
 */

import type { StoredFileValue } from '@byline/core'

import { deriveImageSizes, getPreferredSize } from './utils'
import type { LexicalNodeLike, LexicalNodeVisitor } from '../../lexical-populate-shared'
import type { Position } from './node-types'

/**
 * The inline-image node's own fields, spread flat onto the Lexical node
 * alongside the shared relation envelope. Narrowed here rather than on
 * `LexicalNodeLike` — each visitor knows its own shape, and the shared
 * type stays free of per-plugin fields.
 */
interface InlineImageNodeLike extends LexicalNodeLike {
  src?: string
  position?: Position
  width?: number | string
  height?: number | string
}

export const inlineImageVisitor: LexicalNodeVisitor = {
  match(node: LexicalNodeLike) {
    if (node.type !== 'inline-image') return null
    const collectionPath = node.targetCollectionPath
    const documentId = node.targetDocumentId
    if (!collectionPath || !documentId) return null
    const imageNode = node as InlineImageNodeLike
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
        const preferred = getPreferredSize(imageNode.position, image)
        const url = preferred?.url?.trim()
        if (url) {
          imageNode.src = url
          if (preferred?.width != null) imageNode.width = preferred.width
          if (preferred?.height != null) imageNode.height = preferred.height
        }
      },
    }
  },
}
