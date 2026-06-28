/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { lexicalToText } from './lexical-to-text'

const state = (children: unknown[]) => ({ root: { type: 'root', children } })

const para = (text: string) => ({
  type: 'paragraph',
  children: [{ type: 'text', text }],
})

describe('lexicalToText', () => {
  it('returns empty string for null / undefined / non-editor values', () => {
    expect(lexicalToText(null)).toBe('')
    expect(lexicalToText(undefined)).toBe('')
    expect(lexicalToText(42)).toBe('')
    expect(lexicalToText({ not: 'an editor state' })).toBe('')
  })

  it('parses a stringified editor state', () => {
    expect(lexicalToText(JSON.stringify(state([para('Hello world')])))).toBe('Hello world')
  })

  it('joins block-level nodes with newlines', () => {
    expect(lexicalToText(state([para('First'), para('Second')]))).toBe('First\nSecond')
  })

  it('concatenates inline text and follows link children', () => {
    const node = {
      type: 'paragraph',
      children: [
        { type: 'text', text: 'See ' },
        { type: 'link', children: [{ type: 'text', text: 'the docs' }] },
        { type: 'text', text: ' now.' },
      ],
    }
    expect(lexicalToText(state([node]))).toBe('See the docs now.')
  })

  it('recurses into headings, lists, and quotes', () => {
    const heading = { type: 'heading', tag: 'h1', children: [{ type: 'text', text: 'Title' }] }
    const list = {
      type: 'list',
      children: [
        { type: 'listitem', children: [{ type: 'text', text: 'one' }] },
        { type: 'listitem', children: [{ type: 'text', text: 'two' }] },
      ],
    }
    expect(lexicalToText(state([heading, list]))).toBe('Title\none\ntwo')
  })

  it('skips embed-only nodes (youtube/vimeo)', () => {
    expect(
      lexicalToText(state([para('before'), { type: 'youtube', videoID: 'x' }, para('after')]))
    ).toBe('before\nafter')
  })

  it('extracts nested editor states from inline-image captions', () => {
    const node = {
      type: 'inline-image',
      altText: 'A diagram',
      showCaption: true,
      caption: { editorState: state([para('Figure 1')]) },
    }
    expect(lexicalToText(state([node]))).toBe('A diagram\nFigure 1')
  })
})
