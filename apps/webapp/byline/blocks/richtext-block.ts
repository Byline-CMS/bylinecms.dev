/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CompositeField } from '@byline/core'

export const RichTextBlock: CompositeField = {
  name: 'richTextBlock',
  label: 'Richtext Block',
  type: 'composite',
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
