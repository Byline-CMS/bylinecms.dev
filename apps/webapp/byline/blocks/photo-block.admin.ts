/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineBlockAdmin } from '@byline/core'
import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical/config'

import { PhotoBlock } from './photo-block.js'

/**
 * Admin half of the PhotoBlock schema/admin split — the extension half of
 * the caption's tailored editor (the settings half is `captionEditorConfig`
 * in ./photo-block.ts). Built inline rather than via the shared
 * `minimalRichTextAdmin()` helper because this block wants its own variant:
 * everything minimal, but **Link/AutoLink stay** — captions legitimately
 * carry links (photo credits, source attributions), and the toolbar's link
 * button is gated on the Link extension's presence.
 *
 * Registered via `blockAdmin: […]` in `byline/admin.config.ts`; applies
 * wherever the block renders.
 */
export const PhotoBlockAdmin = defineBlockAdmin(PhotoBlock, {
  fields: {
    caption: {
      editor: lexicalEditor((c) => {
        c.extensions
          // Insert-menu contributors — with all of them gone the "Insert"
          // dropdown itself no longer renders.
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
          // Selection popover — inline-only fields don't need a second
          // surface for the same three buttons.
          .remove(builtInExtensions.FloatingTextFormat)
        // NOTE: Link + AutoLink are deliberately NOT removed.
        return c
      }),
    },
  },
})
