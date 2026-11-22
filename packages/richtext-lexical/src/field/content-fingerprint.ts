/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SerializedEditorState } from 'lexical'

import { hashSerializedState } from './utils/hashSerializedState'

type JsonNode = Record<string, unknown> & { children?: unknown }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

/**
 * Removes `keys` from the relation envelope `holder.document`, dropping the
 * envelope when nothing else is left in it (the walker may create an
 * envelope holding only `_resolved`).
 */
function stripEnvelope(holder: Record<string, unknown>, keys: readonly string[]): void {
  const envelope = holder.document
  if (!isRecord(envelope)) return
  const next = { ...envelope }
  for (const key of keys) delete next[key]
  if (Object.keys(next).length === 0) delete holder.document
  else holder.document = next
}

const hasIdentity = (relation: Record<string, unknown>): boolean =>
  Boolean(relation.targetCollectionPath) && Boolean(relation.targetDocumentId)

/**
 * The allow-list of what the save path may rewrite on a node whose embed
 * identity is unchanged, keyed by node type. Everything not listed here is
 * significant: author formatting, a custom link's URL, an embed's identity
 * (`targetCollectionPath` / `targetDocumentId`), an image's position and
 * authored alt text, its caption and click-through link target, and any
 * attribute this list does not know about.
 *
 * Source: the write-time embed (`packages/core/src/services/richtext-embed.ts`
 * → `lexicalEditorEmbedServer` in `src/server.ts`) runs these visitors over
 * the nodes reachable through `children` (`iterAllNodes` in
 * `lexical-populate-shared.ts`), never into a caption's nested editor state:
 *
 *  - `inlineImageVisitor` (`extensions/inline-image/populate.ts`), for an
 *    `inline-image` node with both identity fields: replaces `document.title`,
 *    `document.altText`, `document.image`, `document.sizes` and
 *    `document._resolved`, and the preview `src`, `width` and `height`.
 *  - `inlineImageLinkVisitor` (same file) through `createInternalLinkHydration`
 *    (`extensions/link/populate.ts`), for an internal click-through `link` with
 *    both identity fields: replaces `link.document.title`, `link.document.path`
 *    and `link.document._resolved`.
 *  - `linkVisitor` (`extensions/link/populate.ts`), for a `link` node whose
 *    `attributes.linkType` is `internal` with both identity fields: replaces
 *    `attributes.document.title`, `attributes.document.path` and
 *    `attributes.document._resolved`.
 */
function stripRefreshedMetadata(node: JsonNode): void {
  if (node.type === 'inline-image' && hasIdentity(node)) {
    delete node.src
    delete node.width
    delete node.height
    stripEnvelope(node, ['title', 'altText', 'image', 'sizes', '_resolved'])
    const link = node.link
    if (isRecord(link) && link.linkType === 'internal' && hasIdentity(link)) {
      const next = { ...link }
      stripEnvelope(next, ['title', 'path', '_resolved'])
      node.link = next
    }
  }
  if (node.type === 'link' && isRecord(node.attributes)) {
    const attributes = node.attributes
    if (attributes.linkType === 'internal' && hasIdentity(attributes)) {
      const next = { ...attributes }
      stripEnvelope(next, ['title', 'path', '_resolved'])
      node.attributes = next
    }
  }
  // Only `children` are walked, as the embed walker does: a caption's
  // nested editor state stays fully significant.
  if (Array.isArray(node.children)) {
    for (const child of node.children) if (isRecord(child)) stripRefreshedMetadata(child)
  }
}

/**
 * A fingerprint of the editor's normalized content as a save would store
 * it, with only the server-refreshed embed metadata above left out. Two
 * states with the same fingerprint differ at most in values the save path
 * itself rewrites, so a caret recorded in one fits the other.
 */
export function contentFingerprint(state: SerializedEditorState): string {
  const copy = JSON.parse(JSON.stringify(state)) as { root?: unknown }
  if (isRecord(copy.root)) stripRefreshedMetadata(copy.root)
  return hashSerializedState(copy as unknown as SerializedEditorState)
}
