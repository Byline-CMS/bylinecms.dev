/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineBlockAdmin } from '@byline/core'
import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical/config'

import { VideoEmbedPreview } from './components/video-embed-preview.js'
import { VideoEmbedBlock } from './video-embed-block.js'

/**
 * Admin half of the VideoEmbedBlock schema/admin split. Two overrides: the
 * caption's trimmed extension list (Link/AutoLink deliberately kept, as on
 * PhotoBlock — captions carry credits), and the live thumbnail beneath the
 * URL field, which replaces legacy's Payload `ui` preview field.
 */
export const VideoEmbedBlockAdmin = defineBlockAdmin(VideoEmbedBlock, {
  fields: {
    url: {
      components: { afterField: VideoEmbedPreview },
    },
    caption: {
      editor: lexicalEditor((config) => {
        config.extensions
          .remove(builtInExtensions.Admonition)
          .remove(builtInExtensions.HorizontalRule)
          .remove(builtInExtensions.InlineImage)
          .remove(builtInExtensions.Layout)
          .remove(builtInExtensions.Table)
          .remove(builtInExtensions.AutoEmbed)
          .remove(builtInExtensions.Vimeo)
          .remove(builtInExtensions.YouTube)
          .remove(builtInExtensions.CodeHighlight)
          .remove(builtInExtensions.FloatingTextFormat)
        return config
      }),
    },
  },
})
