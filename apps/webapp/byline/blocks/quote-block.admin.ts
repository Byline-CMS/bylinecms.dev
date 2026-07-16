/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineBlockAdmin } from '@byline/core'
import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical/config'

import { QuoteBlock } from './quote-block.js'

/**
 * Admin half of the QuoteBlock schema/admin split. Registered site-wide via
 * `blockAdmin: [QuoteBlockAdmin]` in `byline/admin.config.ts`, it applies
 * wherever the block renders (any collection, any nesting).
 *
 * The `editor` override opts this block's `quoteText` into a plain non-AI
 * Lexical editor while every other richtext field keeps the site-wide
 * AI-enabled registration (`fields.richText.editor` = `LexicalRichTextAi`).
 * Imported from the light `/config` subpath so this registration stays free
 * of the editor runtime.
 */
export const QuoteBlockAdmin = defineBlockAdmin(QuoteBlock, {
  fields: {
    quoteText: {
      editor: lexicalEditor((c) => {
        c.extensions.remove(builtInExtensions.FloatingTextFormat)
        c.settings.placeholderText = 'Enter the quotation…'
        return c
      }),
    },
  },
})
