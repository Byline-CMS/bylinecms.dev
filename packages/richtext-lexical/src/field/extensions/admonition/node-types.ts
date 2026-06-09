/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { NodeKey, SerializedElementNode, Spread } from 'lexical'

export type AdmonitionType = 'note' | 'tip' | 'warning' | 'danger'

export interface AdmonitionAttributes {
  admonitionType: AdmonitionType
  title: string
  key?: NodeKey
}

/**
 * The admonition is an `ElementNode` — its body lives as real children in
 * the main editor tree (paragraphs + inline content), so the serialized
 * shape extends `SerializedElementNode` and carries `children`. `type` and
 * `title` are node-level attributes set from the Insert/Edit modal; they
 * ride the opening Docusaurus fence (`:::type[title]`) on markdown export,
 * not the body.
 */
export type SerializedAdmonitionNode = Spread<
  {
    admonitionType: AdmonitionType
    title: string
  },
  SerializedElementNode
>
