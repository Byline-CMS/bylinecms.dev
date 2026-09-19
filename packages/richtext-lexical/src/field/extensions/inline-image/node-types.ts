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

import type { DocumentRelation } from '../../nodes/document-relation'
import type { LinkAttributes } from '../link'

export type Position = 'left' | 'right' | 'full' | 'wide' | 'default' | undefined

/**
 * An inline image carries **two** independent document references, and the
 * distinction matters at every layer:
 *
 *   - the flat `DocumentRelation` this interface extends — the *media*
 *     document the image is sourced from. Always present.
 *   - `link` — an optional *click-through target*. Nested rather than
 *     flattened precisely because the flat envelope is already spent on
 *     the media pick, and the two resolve against different collections.
 *
 * `link` reuses the link extension's discriminated union, so an image can
 * point at a Byline document (`linkType: 'internal'`, relation refreshed
 * by `inlineImageLinkVisitor`) or at an arbitrary URL
 * (`linkType: 'custom'`). Absent means the image is not clickable.
 */
export interface InlineImageAttributes extends DocumentRelation {
  src: string
  altText?: string
  position?: Position
  height?: number | string
  width?: number | string
  key?: NodeKey
  showCaption?: boolean
  caption?: LexicalEditor
  link?: LinkAttributes
}

export type SerializedInlineImageNode = Spread<
  DocumentRelation & {
    src: string
    position?: Position
    altText: string
    height?: number | string
    width?: number | string
    showCaption: boolean
    caption: SerializedEditor
    /** Optional click-through target; absent on unlinked images. */
    link?: LinkAttributes
  },
  SerializedLexicalNode
>
