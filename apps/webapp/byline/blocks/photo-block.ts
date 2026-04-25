/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Block } from '@byline/core'

export const PhotoBlock = {
  blockType: 'photoBlock',
  label: 'Photo Block',
  helpText: 'A block for displaying a photo with optional caption and alt text.',
  fields: [
    {
      name: 'display',
      label: 'Display',
      type: 'select',
      optional: true,
      defaultValue: 'default',
      helpText: 'Select a display option for the photo.',
      options: [
        { label: 'Default', value: 'default' },
        { label: 'Wide', value: 'wide' },
        { label: 'Full Width', value: 'full_width' },
      ],
    },
    {
      name: 'photo',
      label: 'Photo',
      type: 'relation',
      targetCollection: 'media',
      displayField: 'title',
      optional: true,
    },
    { name: 'alt', label: 'Alt', type: 'text', localized: false },
    {
      name: 'caption',
      label: 'Caption',
      type: 'richText',
      optional: true,
      localized: true,
    },
  ],
} as const satisfies Block
