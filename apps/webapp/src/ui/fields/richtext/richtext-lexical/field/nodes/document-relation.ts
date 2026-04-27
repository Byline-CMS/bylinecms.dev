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
 * picks). Mirrors the relation-field envelope (`target_document_id` /
 * `target_collection_id`) and adds the human-readable collection `path` plus
 * an optional `document` bag for denormalised fields populated by the picker
 * at write time or by an `afterRead` collection hook at read time.
 *
 * The two ID fields are the source of truth; `target_collection_path` is
 * carried alongside because the editor has no field-definition side-channel
 * (unlike a `relation` field) to look up the path from the id at render time.
 * `document` is best-effort — renderers must tolerate it being absent.
 */
export interface DocumentRelation {
  target_document_id: string
  target_collection_id: string
  target_collection_path: string
  /**
   * Denormalised fields from the target document — typically `path`, `title`,
   * and any other fields a renderer needs without a round-trip. Populated by
   * the picker at write time and (eventually) refreshed by an `afterRead`
   * hook at read time. Treat as advisory; never the source of truth.
   */
  document?: Record<string, any>
}
