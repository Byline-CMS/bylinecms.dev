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

import { CodeHighlightNode, CodeNode } from '@lexical/code'
import { ListItemNode, ListNode } from '@lexical/list'
import { MarkNode } from '@lexical/mark'
import { OverflowNode } from '@lexical/overflow'
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import type { Klass, LexicalNode } from 'lexical'

import { AdmonitionNode } from './admonition-node/admonition-node'
// import { InlineImageNode } from './inline-image-node/inline-image-node'
import { LayoutContainerNode } from './layout-container-node/layout-container-node'
import { LayoutItemNode } from './layout-container-node/layout-item-node'
import { AutoLinkNode, LinkNode } from './link-nodes'
import { VimeoNode } from './vimeo-node'
import { YouTubeNode } from './youtube-node'

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
  // InlineImageNode,
  HorizontalRuleNode,
  MarkNode,
  AdmonitionNode,
  YouTubeNode,
  VimeoNode,
  LayoutContainerNode,
  LayoutItemNode,
]
