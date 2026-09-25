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
 * describing different bytes.
 *
 * Every copied media value — the envelope's `title`, `altText`, `image` and
 * `sizes`, and the node's `src` / `width` / `height` — is **replaced, never
 * merged**. When the media target is missing or denied to this reader, or it
 * resolves without an image or without a usable URL, the copied image data
 * and preview are removed and `document._resolved = false` marks the node
 * unresolved, so no stale image is rendered, serialized or exported to
 * Markdown. A valid current image still renders when only its title or alt
 * text is absent. The node's identity, position, authored `altText`, caption
 * and click-through link are never touched here.
 */

import type { StoredFileValue } from '@byline/core'

import { createInternalLinkHydration } from '../link/populate'
import { deriveImageSizes, getPreferredSize } from './utils'
import type { LexicalNodeLike, LexicalNodeVisitor } from '../../lexical-populate-shared'
import type { LinkAttributes } from '../link'
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
  /** Optional click-through target — a SECOND relation, see below. */
  link?: LinkAttributes
}

/** Envelope values copied from the media document on every refresh. */
const DERIVED_KEYS = ['title', 'altText', 'image', 'sizes'] as const

/**
 * Remove the copied preview. `src` is a required string on the serialized
 * node, so it becomes empty (the Markdown serializer and editor already treat
 * an empty `src` as "no image") rather than being deleted.
 */
function clearPreview(node: InlineImageNodeLike): void {
  node.src = ''
  delete node.width
  delete node.height
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
        const next: Record<string, any> = { ...(node.document ?? {}) }
        for (const key of DERIVED_KEYS) delete next[key]
        if (typeof targetFields.title === 'string') next.title = targetFields.title
        if (typeof targetFields.altText === 'string') next.altText = targetFields.altText

        const preferred = getPreferredSize(imageNode.position, image)
        const url = preferred?.url?.trim()
        if (image != null && url) {
          const sizes = deriveImageSizes(image)
          next.image = image
          if (sizes.length > 0) next.sizes = sizes
          delete next._resolved
          imageNode.src = url
          if (preferred?.width != null) imageNode.width = preferred.width
          else delete imageNode.width
          if (preferred?.height != null) imageNode.height = preferred.height
          else delete imageNode.height
        } else {
          // Resolved without an image, or without a usable URL.
          next._resolved = false
          clearPreview(imageNode)
        }
        node.document = next
      },
      applyMissing() {
        // The media target could not be read (deleted, unpublished, or
        // denied to this reader). Remove every copied value rather than
        // serve it as though it were a live resolution.
        const next: Record<string, any> = { ...(node.document ?? {}) }
        for (const key of DERIVED_KEYS) delete next[key]
        next._resolved = false
        node.document = next
        clearPreview(imageNode)
      },
    }
  },
}

/**
 * Second visitor for the same node type. An inline image carries **two**
 * independent relations:
 *
 *   - the flat `DocumentRelation` envelope on the node — the *media*
 *     document the image comes from, refreshed by `inlineImageVisitor`
 *     above;
 *   - `node.link` — an optional *click-through target*, which is an
 *     unrelated document in an unrelated collection.
 *
 * They cannot share one visitor: `PendingHydration` addresses exactly one
 * `{ collectionPath, documentId }` pair. `runLexicalPopulate` runs every
 * visitor against every node and enqueues each match separately, so
 * registering this alongside `inlineImageVisitor` hydrates both relations
 * in the same batched pass with no change to the driver contract.
 *
 * Only `linkType: 'internal'` links carry a relation; custom-URL links are
 * a literal href and are skipped. Resolution branches — found, hook threw,
 * target missing — are the internal-link rules shared with `linkVisitor`
 * (see `../link/populate.ts`).
 */
export const inlineImageLinkVisitor: LexicalNodeVisitor = {
  match(node: LexicalNodeLike) {
    if (node.type !== 'inline-image') return null
    const link = (node as InlineImageNodeLike).link
    if (link == null) return null
    if (link.linkType !== 'internal') return null
    const collectionPath = link.targetCollectionPath
    const documentId = link.targetDocumentId
    if (!collectionPath || !documentId) return null

    return {
      node,
      collectionPath,
      documentId,
      ...createInternalLinkHydration(link, collectionPath, documentId),
    }
  },
}
