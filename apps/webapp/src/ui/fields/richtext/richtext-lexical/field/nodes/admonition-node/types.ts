/**
 * This Source Code Form is subject to the terms of the Mozilla Public
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

export type AdmonitionType = 'note' | 'tip' | 'warning' | 'danger'

export interface AdmonitionAttributes {
  admonitionType: AdmonitionType
  title: string
  content?: LexicalEditor
  key?: NodeKey
}

export type SerializedAdmonitionNode = Spread<
  {
    admonitionType: AdmonitionType
    title: string
    content: SerializedEditor
  },
  SerializedLexicalNode
>
