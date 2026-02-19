/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { BlockField } from '@byline/core'

export const RichTextBlock: BlockField = {
  name: 'richTextBlock',
  label: 'Richtext Block',
  type: 'block',
  fields: [
    {
      name: 'richText',
      label: 'Richtext',
      type: 'richText',
      required: true,
      localized: true,
    },
    {
      name: 'constrainedWidth',
      label: 'Constrained Width',
      type: 'checkbox',
      required: false,
      defaultValue: true,
      helpText:
        'If enabled, the richtext content will be constrained to a maximum width for better readability.',
    },
  ],
}
