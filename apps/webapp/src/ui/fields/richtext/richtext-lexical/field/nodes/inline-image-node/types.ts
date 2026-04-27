/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  LexicalEditor,
  NodeKey,
  SerializedEditor,
  SerializedLexicalNode,
  Spread,
} from 'lexical'

import type { DocumentRelation } from '../document-relation'

export type Position = 'left' | 'right' | 'full' | 'wide' | 'default' | undefined

export interface InlineImageAttributes {
  relation: DocumentRelation
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
    relation: DocumentRelation
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
