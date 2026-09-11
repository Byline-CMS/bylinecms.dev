/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { CodeHighlightNode, CodeNode } from '@lexical/code'
import { ListItemNode, ListNode } from '@lexical/list'
import { MarkNode } from '@lexical/mark'
import { OverflowNode } from '@lexical/overflow'
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import type { Klass, LexicalNode } from 'lexical'

import { AdmonitionNode } from '../extensions/admonition/admonition-node'
import { InlineImageNode } from '../extensions/inline-image/inline-image-node'
import { LayoutContainerNode } from '../extensions/layout/layout-container-node'
import { LayoutItemNode } from '../extensions/layout/layout-item-node'
import { AutoLinkNode, LinkNode } from '../extensions/link'
import { VimeoNode } from '../extensions/vimeo/vimeo-node'
import { YouTubeNode } from '../extensions/youtube/youtube-node'

/**
 * Every node class Byline knows how to READ.
 *
 * This is not a registration list — registration belongs to the
 * extension that owns each node, so that removing an extension removes
 * what the field accepts as well as what it offers. This array is the
 * vocabulary the normalizer and the capability manifest work from, so a
 * stored document can still be inspected by a field that supports far
 * less than the document contains.
 */
export const READABLE_NODES: Array<Klass<LexicalNode>> = [
  HeadingNode,
  ListNode,
  ListItemNode,
  QuoteNode,
  CodeNode,
  TableNode,
  TableCellNode,
  TableRowNode,
  CodeHighlightNode,
  AutoLinkNode,
  LinkNode,
  OverflowNode,
  InlineImageNode,
  HorizontalRuleNode,
  MarkNode,
  AdmonitionNode,
  YouTubeNode,
  VimeoNode,
  LayoutContainerNode,
  LayoutItemNode,
]
