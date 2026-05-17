/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, test } from 'vitest'

import { stripLeadingH1IfMatches } from './strip-leading-h1.js'

function parse(md: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(md) as Root
}

describe('stripLeadingH1IfMatches', () => {
  test('removes the leading H1 when its text matches the title', () => {
    const root = parse('# Authentication & Authorization\n\nbody')
    const out = stripLeadingH1IfMatches(root, 'Authentication & Authorization')
    expect(out.children).toHaveLength(1)
    expect(out.children[0]).toMatchObject({ type: 'paragraph' })
  })

  test('match is case-insensitive and whitespace-tolerant', () => {
    const root = parse('#   authentication & authorization   \n\nbody')
    const out = stripLeadingH1IfMatches(root, 'Authentication & Authorization')
    expect(out.children).toHaveLength(1)
  })

  test('match flattens inline formatting in the H1', () => {
    // mdast-util-to-string drops backticks / emphasis markers from the
    // H1's inline structure. Frontmatter titles are plain prose, so a
    // body H1 of '# Client SDK (`@byline/client`)' compares equal to a
    // frontmatter title of 'Client SDK (@byline/client)'.
    const root = parse('# Client SDK (`@byline/client`)\n\nbody')
    const out = stripLeadingH1IfMatches(root, 'Client SDK (@byline/client)')
    expect(out.children).toHaveLength(1)
    expect(out.children[0]).toMatchObject({ type: 'paragraph' })
  })

  test('leaves the body untouched when the H1 differs', () => {
    const root = parse('# Different Title\n\nbody')
    const out = stripLeadingH1IfMatches(root, 'Authentication & Authorization')
    expect(out.children).toHaveLength(2)
    expect(out.children[0]).toMatchObject({ type: 'heading', depth: 1 })
  })

  test('leaves the body untouched when there is no leading heading', () => {
    const root = parse('just a paragraph')
    const out = stripLeadingH1IfMatches(root, 'Anything')
    expect(out.children).toHaveLength(1)
    expect(out.children[0]).toMatchObject({ type: 'paragraph' })
  })

  test('leaves the body untouched when the leading heading is H2', () => {
    const root = parse('## A Subheading\n\nbody')
    const out = stripLeadingH1IfMatches(root, 'A Subheading')
    expect(out.children).toHaveLength(2)
    expect(out.children[0]).toMatchObject({ type: 'heading', depth: 2 })
  })
})
