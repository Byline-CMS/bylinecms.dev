/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineBlockAdmin } from '@byline/core'
import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical/config'

import { configureCompactEditor } from '../fields/richtext/lexical-richtext-compact-admin.js'
import { QuoteBlock } from './quote-block.js'

/**
 * Admin half of the QuoteBlock schema/admin split. Registered site-wide via
 * `blockAdmin: [QuoteBlockAdmin, …]` in `byline/admin.config.ts`, it applies
 * wherever the block renders (any collection, any nesting).
 *
 * `minimalRichTextAdmin()` is the extension half of the minimal editor —
 * the same `FieldAdminConfig` factory collections drop into their
 * `admin.tsx` `fields` map (see beta's publications `title`). It pairs with
 * the `lexicalRichTextMinimal()` schema helper on `quoteText` in
 * ./quote-block.ts: settings ride in the schema's `editorConfig` (JSON-safe),
 * extension removals live here (React references). The minimal editor also
 * replaces the site-wide AI-enabled registration for this field —
 * deliberately: a quotation is inline-formatting-only content.
 */
/**
 * The extension narrowing, exported separately from the component so a
 * test can assert which extensions this editor removes. `lexicalEditor()`
 * closes over its callback inside a lazy component, so the resolved list
 * is not otherwise reachable.
 */
export function configureQuoteTextEditor<T extends { extensions?: any }>(c: T): T {
  // The shared compact narrowing: no block structures — heading,
  // quote, list, check list, table, layout, admonition, rule, code
  // — while links survive, because pull-quote text carries credits.
  //
  // Composed rather than restated. This editor previously listed
  // its own removals and so kept accepting headings and lists after
  // the shared preset stopped: a caption that offered no block
  // controls still stored a heading that arrived by paste.
  configureCompactEditor(c)
  c.extensions
    // Beyond compact: no image inside pull-quote text...
    .remove(builtInExtensions.InlineImage)
    // ...and no selection popover for the same three buttons.
    .remove(builtInExtensions.FloatingTextFormat)
  // NOTE: Link + AutoLink are deliberately NOT removed.
  return c
}

export const QuoteBlockAdmin = defineBlockAdmin(QuoteBlock, {
  fields: {
    quoteText: {
      editor: lexicalEditor(configureQuoteTextEditor),
    },
  },
})
