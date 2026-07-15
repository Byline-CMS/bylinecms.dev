/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Richtext embed service — walks an outgoing document, finds every
 * rich-text leaf (including those nested inside `group` / `array` /
 * `blocks` structures), gates each leaf by its `embedRelationsOnSave`
 * flag, and dispatches to the registered richtext embed adapter so
 * link envelopes (and any future write-time embeds) can be refreshed
 * before the value is flattened and persisted.
 *
 * Mirror of `richtext-populate.ts`. Slots into the document-lifecycle
 * write path:
 *
 *   beforeCreate / beforeUpdate
 *     → assignCounterValues
 *     → embedRichTextFields       (this module)
 *     → createDocumentVersion
 *     → afterCreate / afterUpdate
 *
 * Per-leaf errors are logged and swallowed — leaving the persisted state
 * for that leaf as the editor submitted it. Aligns with the strategy's
 * "branch C — hard error" non-destructive fail mode (see
 * docs/RICHTEXT-LINK-REFACTOR-STRATEGY.md § 3.3).
 *
 * Multi-locale (`locale: 'all'`) writes: when a richText leaf's value is
 * a `{ <locale>: lexicalJson }` map (the shape used by
 * `restoreDocumentVersion` and `duplicateDocument`), the adapter's
 * `getLexicalRoot` parses the object as a single tree, finds no `root`
 * key and no `children` array, and yields nothing. So embed is a no-op
 * on multi-locale writes — the persisted state carries forward exactly
 * what the source had. Per-locale walking is a deliberate future
 * refinement; today's behaviour matches the populate side (which only
 * fires on locale-scoped reads) and the renderer's fallback chain
 * handles stale embedded paths.
 */

import type { RequestContext } from '@byline/auth'

import { collectRichTextLeaves } from './richtext-populate.js'
import type {
  FieldSet,
  RichTextEmbedFn,
  RichTextField,
  RichTextReadDocumentsFn,
} from '../@types/field-types.js'
import type { ReadContext, ReadMode } from '../@types/index.js'
import type { BylineLogger } from '../lib/logger.js'

/**
 * Resolve the effective `embedRelationsOnSave` for a richText field.
 * Defaults to `true` — embed-on-save is the headline behaviour the new
 * walker turns on, and CMS authors expect picker-time choices to land
 * with refreshed envelopes by default.
 */
export function resolveEmbedOnSave(field: RichTextField): boolean {
  return field.embedRelationsOnSave ?? true
}

export interface EmbedRichTextFieldsOptions {
  /** Source collection's schema fields (used to drive the leaf walk). */
  fields: FieldSet
  collectionPath: string
  /**
   * The outgoing document data. Mutated in place by the adapter as each
   * rich-text leaf is walked.
   */
  data: Record<string, any>
  /** Registered server-side embed function from `ServerConfig`. */
  embed: RichTextEmbedFn
  /**
   * Request-scoped read context. Threading is mandatory — the embed
   * adapter performs reads while walking and must share the same
   * visited-set / read-budget machinery as the rest of the framework.
   */
  readContext: ReadContext
  requestContext: RequestContext
  readMode: ReadMode
  readDocuments: RichTextReadDocumentsFn
  /** Structured logger — used for branch-C per-leaf error reporting. */
  logger: BylineLogger
}

/**
 * For one document being saved, walk its rich-text leaves and call the
 * registered embed function for each leaf whose effective
 * `embedRelationsOnSave` is `true`.
 *
 * Per-leaf errors are caught and logged at `error` level. The leaf's
 * value is left as whatever the caller submitted — the persistence step
 * downstream proceeds. Document-level errors propagate.
 */
export async function embedRichTextFields(options: EmbedRichTextFieldsOptions): Promise<void> {
  const {
    fields,
    collectionPath,
    data,
    embed,
    readContext,
    requestContext,
    readMode,
    readDocuments,
    logger,
  } = options
  for (const leaf of collectRichTextLeaves(fields, data)) {
    if (!resolveEmbedOnSave(leaf.field)) continue
    try {
      await embed({
        value: leaf.value,
        fieldPath: leaf.fieldPath,
        collectionPath,
        readContext,
        requestContext,
        readMode,
        readDocuments,
      })
    } catch (err) {
      logger.error(
        { err, collectionPath, fieldPath: leaf.fieldPath },
        'richtext embed adapter threw — leaf left untouched (branch C)'
      )
    }
  }
}
