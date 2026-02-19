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

import type {
  LexicalEditor,
  NodeKey,
  SerializedEditor,
  SerializedLexicalNode,
  Spread,
} from 'lexical'

export type Position = 'left' | 'right' | 'full' | 'wide' | 'default' | undefined

export interface Doc {
  value: string
  relationTo: string
  data?: Record<string, unknown>
}

export interface InlineImageAttributes {
  id: string
  collection: string
  src: string
  altText?: string
  position?: Position
  height?: number | string
  width?: number | string
  key?: NodeKey
  showCaption?: boolean
  caption?: LexicalEditor
}

export type SerializedInlineImageNode = Spread<
  {
    doc: Doc
    src: string
    position?: Position
    altText: string
    height?: number | string
    width?: number | string
    showCaption: boolean
    caption: SerializedEditor
  },
  SerializedLexicalNode
>
