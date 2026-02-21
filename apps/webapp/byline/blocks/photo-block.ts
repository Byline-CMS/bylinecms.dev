/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { BlockField } from '@byline/core'

export const PhotoBlock: BlockField = {
  name: 'photoBlock',
  label: 'Photo Block',
  type: 'block',
  fields: [
    { name: 'display', label: 'Display', type: 'text', required: false },
    { name: 'photo', label: 'Photo', type: 'image', required: true },
    { name: 'alt', label: 'Alt', type: 'text', required: true, localized: false },
    {
      name: 'caption',
      label: 'Caption',
      type: 'richText',
      required: false,
      localized: true,
    },
  ],
}
