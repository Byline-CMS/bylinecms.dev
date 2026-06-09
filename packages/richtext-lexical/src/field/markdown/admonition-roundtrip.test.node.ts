/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Round-trip coverage for the admonition markdown transformer. The
 * `ElementNode` body (paragraphs + inline content) is converted with the same
 * engine as the rest of the document, so a markdown → Lexical → markdown
 * cycle must be stable. These run headless (no DOM / React).
 */

import { CodeNode } from '@lexical/code'
import { createHeadlessEditor } from '@lexical/headless'
import { LinkNode } from '@lexical/link'
import { ListItemNode, ListNode } from '@lexical/list'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import { $getRoot, type Klass, type LexicalNode } from 'lexical'
import { describe, expect, it } from 'vitest'

import { $isAdmonitionNode, AdmonitionNode } from '../extensions/admonition/admonition-node'
import { BYLINE_TRANSFORMERS } from './transformers'

// Explicit node list rather than the `../nodes` barrel — that barrel pulls in
// JSX-bearing decorator nodes (inline-image, embeds) which node-mode Vitest
// won't parse. The new AdmonitionNode is pure-DOM, so it imports cleanly here.
const Nodes: Array<Klass<LexicalNode>> = [
  AdmonitionNode,
  LinkNode,
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  TableNode,
  TableRowNode,
  TableCellNode,
]

function roundTrip(markdown: string): string {
  const editor = createHeadlessEditor({
    namespace: 'test',
    nodes: Nodes,
    onError: (e) => {
      throw e
    },
  })
  let output = ''
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, BYLINE_TRANSFORMERS)
    },
    { discrete: true }
  )
  editor.read(() => {
    output = $convertToMarkdownString(BYLINE_TRANSFORMERS)
  })
  return output
}

describe('admonition markdown round-trip', () => {
  it('round-trips a titled warning with inline formatting + a link', () => {
    const md = [
      ':::warning[Heads up]',
      'This is **bold** and a [link](https://example.com).',
      ':::',
    ].join('\n')
    expect(roundTrip(md)).toBe(md)
  })

  it('round-trips a multi-paragraph body', () => {
    const md = [':::note[Notes]', 'First paragraph.', '', 'Second paragraph.', ':::'].join('\n')
    expect(roundTrip(md)).toBe(md)
  })

  it('round-trips an admonition with no title', () => {
    const md = [':::tip', 'A quick tip.', ':::'].join('\n')
    expect(roundTrip(md)).toBe(md)
  })

  it('builds an AdmonitionNode with the right type + title on import', () => {
    const editor = createHeadlessEditor({
      namespace: 'test',
      nodes: Nodes,
      onError: (e) => {
        throw e
      },
    })
    editor.update(
      () => {
        $convertFromMarkdownString(':::danger[Stop]\nBody text.\n:::', BYLINE_TRANSFORMERS)
      },
      { discrete: true }
    )
    editor.read(() => {
      const node = $getRoot().getFirstChild()
      expect($isAdmonitionNode(node)).toBe(true)
      if ($isAdmonitionNode(node)) {
        expect(node.getAdmonitionType()).toBe('danger')
        expect(node.getTitle()).toBe('Stop')
        expect(node.getTextContent()).toContain('Body text.')
      }
    })
  })
})
