/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type BlockData, type BlockFieldData, defineBlock } from '@byline/core'
import { defaultEditorConfig, type EditorConfig } from '@byline/richtext-lexical/server'

/**
 * Settings half of the caption's tailored editor — see the equivalent note in
 * ./photo-block.ts. The extension half lives in ./video-embed-block.admin.ts.
 */
const captionEditorConfig: EditorConfig = (() => {
  const config = structuredClone(defaultEditorConfig)
  const options = config.settings.controls
  options.textAlignment = false
  options.blockFormat = false
  options.inlineCode = false
  options.undoRedo = false
  options.markdownToggle = false
  config.settings.markdownShortcuts = false
  return config
})()

/**
 * A third-party hosted video (YouTube / Vimeo) embedded by URL.
 *
 * Distinct from `videoBlock`, which plays a file from the `videos` upload
 * collection through the native player. The same two providers are also
 * available as Lexical nodes inside a `richTextBlock` — the node form is what
 * the 58 legacy YouTube embeds use. This block is the standalone form, adding
 * a `display` option and a caption the node form has no room for.
 */
export const VideoEmbedBlock = defineBlock({
  blockType: 'videoEmbedBlock',
  label: 'Video Embed',
  helpText: 'A YouTube or Vimeo video embedded by URL, with an optional caption.',
  fields: [
    {
      name: 'type',
      label: 'Type',
      type: 'select',
      helpText: 'Select the type of video to embed. YouTube and Vimeo are currently supported.',
      options: [
        { label: 'YouTube', value: 'youtube' },
        { label: 'Vimeo', value: 'vimeo' },
      ],
    },
    {
      name: 'display',
      label: 'Display',
      type: 'select',
      optional: true,
      defaultValue: 'default',
      options: [
        { label: 'Default', value: 'default' },
        { label: 'Wide', value: 'wide' },
        { label: 'Full Width', value: 'full_width' },
      ],
    },
    {
      name: 'url',
      label: 'URL',
      type: 'text',
      helpText:
        'Paste the video page URL — e.g. https://www.youtube.com/watch?v=… , https://youtu.be/… or https://vimeo.com/… ',
    },
    {
      name: 'caption',
      label: 'Caption',
      type: 'richText',
      localized: true,
      optional: true,
      editorConfig: captionEditorConfig,
    },
  ],
})

export type VideoEmbedBlockFields = BlockFieldData<typeof VideoEmbedBlock>
export type VideoEmbedBlockData = BlockData<typeof VideoEmbedBlock>
