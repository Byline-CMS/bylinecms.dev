import { type BlockData, type BlockFieldData, defineBlock } from '@byline/core'
import { defaultEditorConfig, type EditorConfig } from '@byline/richtext-lexical/server'

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
 * Self-hosted video played through the native `<video>` element, sourced from
 * the `videos` upload collection.
 *
 * `videoMobile` is the bandwidth affordance for a CDN-served file with no
 * streaming service behind it: a second, lower-resolution encode offered to
 * narrow viewports through a `media`-qualified `<source>`.
 */
export const VideoBlock = defineBlock({
  blockType: 'videoBlock',
  label: 'Video Block',
  helpText: 'A video with an optional mobile source and caption.',
  fields: [
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
      name: 'video',
      label: 'Video',
      type: 'relation',
      targetCollection: 'videos',
      displayField: 'alt',
    },
    {
      name: 'videoMobile',
      label: 'Mobile Video',
      type: 'relation',
      targetCollection: 'videos',
      displayField: 'alt',
      optional: true,
      helpText: 'Optional lower-resolution source for mobile visitors.',
    },
    {
      name: 'useSourceVideoCaption',
      label: 'Use Source Video Caption',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      name: 'caption',
      label: 'Caption',
      type: 'richText',
      localized: true,
      optional: true,
      condition: (_data, siblingData) => siblingData.useSourceVideoCaption === false,
      editorConfig: captionEditorConfig,
    },
  ],
})

export type VideoBlockFields = BlockFieldData<typeof VideoBlock>
export type VideoBlockData = BlockData<typeof VideoBlock>
