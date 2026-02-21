/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Position } from '../../nodes/inline-image-node/types'

export interface InlineImageData {
  id?: string
  altText?: string
  position?: Position
  showCaption?: boolean
}

export interface InlineImageDrawerProps {
  isOpen: boolean
  drawerSlug: string
  onClose: () => void
  onSubmit: (data: InlineImageData) => void
  data?: InlineImageData
}

export interface InlineImageFormState {
  image: {
    value: string | undefined
    initialValue: string | undefined
    valid: boolean
  }
  altText: {
    value: string | undefined
    initialValue: string | undefined
    valid: boolean
  }
  position: {
    value: 'left' | 'right' | 'full' | 'wide' | 'default'
    initialValue: 'left' | 'right' | 'full' | 'wide' | 'default'
    valid: boolean
  }
  showCaption: {
    value: boolean
    initialValue: boolean
    valid: boolean
  }
}
