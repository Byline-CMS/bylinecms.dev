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
