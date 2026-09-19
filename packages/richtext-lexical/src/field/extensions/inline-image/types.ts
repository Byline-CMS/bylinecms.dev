/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { DocumentRelation } from '../../nodes/document-relation'
import type { LinkAttributes } from '../link'
import type { Position } from './node-types'

/**
 * The form-shape carried into / out of the inline image modal. Mirrors
 * `InlineImageAttributes` minus the Lexical-managed bits (`key`, `caption:
 * LexicalEditor`) — those don't belong in form state. The document-reference
 * envelope is carried as an optional nested `DocumentRelation` here (rather
 * than spread flat) because the modal needs a single null/non-null state to
 * represent "user hasn't picked a document yet".
 */
export interface InlineImageData {
  documentRelation: DocumentRelation | null
  src: string
  altText?: string
  position?: Position
  width?: number | string
  height?: number | string
  showCaption?: boolean
  /**
   * Optional click-through target. `undefined` means "no link" — and the
   * modal always emits the key, so the node's `update()` can tell
   * "unchanged" from "cleared".
   */
  link?: LinkAttributes
}

export interface InlineImageModalProps {
  /** Modal visibility — driven by the plugin's open/close commands. */
  isOpen: boolean
  /** The collection path the picker should target — typically `'media'`. */
  collection: string
  /** Pre-filled data when the modal opens in edit mode; undefined for insert. */
  data?: InlineImageData
  onSubmit: (data: InlineImageData) => void
  onClose: () => void
}
