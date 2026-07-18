/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineBlockAdmin } from '@byline/core'
import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical/config'

import { FAQBlock } from './faq-block.js'

/**
 * Admin half of the FAQBlock schema/admin split — and the reference for
 * **dotted schema-path keys**: `faq.answer` addresses the `answer` field
 * *declaration* inside the block's `faq` array, so the override applies to
 * that field in every FAQ item. Schema paths are index-free (`faq.answer`,
 * never `faq[0].answer` — that bracket notation is the *instance* path the
 * patch system uses) and are validated against the block's field tree at
 * boot (`validateBlockAdminConfigs`).
 *
 * This is the extension half of the compact answer editor. It pairs with the
 * `answerEditorConfig` settings baked into ./faq-block.ts (JSON-safe toolbar
 * toggles); the removals here drop the node extensions an FAQ answer doesn't
 * need while keeping structural prose — lists and Link/AutoLink survive.
 * Registering this also replaces the site-wide AI-enabled editor for the
 * answer field only.
 */
export const FAQBlockAdmin = defineBlockAdmin(FAQBlock, {
  fields: {
    'faq.answer': {
      editor: lexicalEditor((c) => {
        c.extensions
          // Insert-menu contributors an answer doesn't need — plain prose
          // with lists and links, no media or layout structures.
          .remove(builtInExtensions.Admonition)
          .remove(builtInExtensions.HorizontalRule)
          .remove(builtInExtensions.InlineImage)
          .remove(builtInExtensions.Layout)
          .remove(builtInExtensions.Table)
          .remove(builtInExtensions.AutoEmbed)
          .remove(builtInExtensions.Vimeo)
          .remove(builtInExtensions.YouTube)
          // Code blocks (the block-format dropdown is already hidden by the
          // schema-side settings; this drops the node + highlight runtime).
          .remove(builtInExtensions.CodeHighlight)
        // NOTE: Link + AutoLink and HorizontalRule are deliberately kept —
        // answers are real paragraphs.
        return c
      }),
    },
  },
})
