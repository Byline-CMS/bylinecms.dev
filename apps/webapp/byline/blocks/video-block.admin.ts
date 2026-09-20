import { defineBlockAdmin } from '@byline/core'
import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical/config'

import { VideoBlock } from './video-block.js'

export const VideoBlockAdmin = defineBlockAdmin(VideoBlock, {
  fields: {
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
