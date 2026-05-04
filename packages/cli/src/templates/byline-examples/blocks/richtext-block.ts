/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type BlockData, type BlockFieldData, defineBlock } from '@byline/core'

export const RichTextBlock = defineBlock({
  blockType: 'richTextBlock',
  label: 'Richtext Block',
  helpText: 'A block for displaying a richtext editor.',
  fields: [
    {
      name: 'richText',
      label: 'Richtext',
      type: 'richText',
      localized: true,
    },
    {
      name: 'constrainedWidth',
      label: 'Constrained Width',
      type: 'checkbox',
      optional: true,
      defaultValue: true,
      helpText:
        'If enabled, the richtext content will be constrained to a maximum width for better readability.',
    },
  ],
})

export type RichTextBlockFields = BlockFieldData<typeof RichTextBlock>
export type RichTextBlockData = BlockData<typeof RichTextBlock>
