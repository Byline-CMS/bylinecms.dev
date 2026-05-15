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

export const Nodes: Array<Klass<LexicalNode>> = [
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
