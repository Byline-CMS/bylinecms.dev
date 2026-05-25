/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Stored shape for any Lexical node that references a Byline document
 * (currently `LinkNode` for internal links and `InlineImageNode` for media
 * picks). Mirrors the relation-field envelope (`targetDocumentId` /
 * `targetCollectionId`) and adds the human-readable collection `path` plus
 * an optional `document` bag for denormalised fields populated by the picker
 * at write time or by the server-side richtext walker at read / save time.
 *
 * The two ID fields are the source of truth; `targetCollectionPath` is
 * carried alongside because the editor has no field-definition side-channel
 * (unlike a `relation` field) to look up the path from the id at render time.
 * `document` is best-effort — renderers must tolerate it being absent.
 *
 * The `document` slot is parameterised by `D` so each node type can pin its
 * own shape: internal-link nodes pin `{ title?, path?, _resolved?: false }`
 * (see `InternalLinkAttributes`); inline-image nodes carry image-specific
 * fields (`title`, `altText`, `image`, `sizes`). Defaults to a loose
 * `Record<string, any>` so existing call sites continue to compile.
 */
export interface DocumentRelation<D extends Record<string, any> = Record<string, any>> {
  targetDocumentId: string
  targetCollectionId: string
  targetCollectionPath: string
  /**
   * Denormalised fields from the target document — typically `path`, `title`,
   * and any other fields a renderer needs without a round-trip. Populated by
   * the picker at write time and refreshed by the server-side richtext
   * walker (write-time embed and / or read-time populate). Treat as
   * advisory; the ID fields are the source of truth.
   */
  document?: D
}
