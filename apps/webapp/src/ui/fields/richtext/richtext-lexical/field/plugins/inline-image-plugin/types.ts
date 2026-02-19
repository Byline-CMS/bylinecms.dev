/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
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
