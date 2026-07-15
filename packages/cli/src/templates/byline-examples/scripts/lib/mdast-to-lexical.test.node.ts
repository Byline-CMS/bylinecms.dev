/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, test } from 'vitest'

import { mdastToLexical } from './mdast-to-lexical.js'
import { parseBodyToMdast } from './parse-markdown.js'

function convert(md: string) {
  return mdastToLexical(parseBodyToMdast(md))
}

describe('mdastToLexical', () => {
  test('empty input yields a single empty paragraph', () => {
    const { state, warnings } = convert('')
    expect(warnings).toEqual([])
    expect(state.root.type).toBe('root')
    expect(state.root.children).toHaveLength(1)
    expect(state.root.children[0]).toMatchObject({ type: 'paragraph', children: [] })
  })

  test('maps plain paragraphs and every heading depth', () => {
    const paragraph = convert('hello world').state.root.children[0]
    expect(paragraph).toMatchObject({
      type: 'paragraph',
      children: [{ type: 'text', text: 'hello world', format: 0 }],
    })
    const headings = convert('# h1\n\n## h2\n\n###### h6').state.root.children
    expect(headings.map((node) => (node as { tag: string }).tag)).toEqual(['h1', 'h2', 'h6'])
  })

  test('maps headings and composed inline formatting', () => {
    const { state } = convert('# heading\n\n***both*** and `code`')
    expect(state.root.children[0]).toMatchObject({ type: 'heading', tag: 'h1' })
    const paragraph = state.root.children[1] as unknown as {
      children: Array<{ format: number; text: string }>
    }
    expect(paragraph.children).toContainEqual(expect.objectContaining({ text: 'both', format: 3 }))
    expect(paragraph.children).toContainEqual(
      expect.objectContaining({ text: 'code', format: 1 << 4 })
    )
  })

  test('preserves GFM strikethrough', () => {
    const { state } = convert('a ~~b~~ c')
    const paragraph = state.root.children[0] as unknown as {
      children: Array<{ format: number; text: string }>
    }
    expect(paragraph.children.find((child) => child.text === 'b')?.format).toBe(1 << 2)
  })

  test('maps unordered, ordered, and nested lists', () => {
    const unordered = convert('- a\n  - a1\n- b').state.root.children[0] as unknown as {
      listType: string
      tag: string
      children: Array<{ children: Array<{ type: string }> }>
    }
    expect(unordered).toMatchObject({ listType: 'bullet', tag: 'ul' })
    expect(unordered.children[0].children.some((child) => child.type === 'list')).toBe(true)

    const ordered = convert('3. a\n4. b').state.root.children[0] as unknown as {
      listType: string
      tag: string
      start: number
      children: Array<{ value: number }>
    }
    expect(ordered).toMatchObject({ listType: 'number', tag: 'ol', start: 3 })
    expect(ordered.children.map((child) => child.value)).toEqual([3, 4])
  })

  test('maps links and fenced code language aliases', () => {
    const linkParagraph = convert('[label](https://example.com)').state.root
      .children[0] as unknown as {
      children: Array<{ attributes: { url: string; newTab: boolean } }>
    }
    expect(linkParagraph.children[0].attributes).toMatchObject({
      url: 'https://example.com',
      newTab: true,
    })

    const code = convert('```ts\nconst x = 1\n```').state.root.children[0] as unknown as {
      language: string
      children: Array<{ type: string; text?: string }>
    }
    expect(code.language).toBe('typescript')
    expect(code.children[0]).toMatchObject({ type: 'code-highlight', text: 'const x = 1' })
  })

  test('maps blockquotes, rules, and image warnings', () => {
    expect(convert('> hello').state.root.children[0]).toMatchObject({ type: 'quote' })
    expect(convert('---').state.root.children[0]).toMatchObject({ type: 'horizontalrule' })
    expect(convert('![alt](https://example.com/x.png)').warnings).toContainEqual(
      expect.objectContaining({ kind: 'dropped-image' })
    )
  })

  test('maps GFM tables with header state and inline formatting', () => {
    const table = convert('| col |\n| - |\n| **bold** |').state.root
      .children[0] as unknown as {
      children: Array<{
        children: Array<{
          headerState: number
          children: Array<{ children: Array<{ text: string; format: number }> }>
        }>
      }>
    }
    expect(table.children[0].children[0].headerState).toBe(1)
    expect(table.children[1].children[0].headerState).toBe(0)
    expect(table.children[1].children[0].children[0].children[0]).toMatchObject({
      text: 'bold',
      format: 1,
    })
  })

  test('gives empty table cells a structurally valid empty paragraph', () => {
    const table = convert('| a | b |\n| - | - |\n|   | 2 |').state.root
      .children[0] as unknown as {
      children: Array<{
        children: Array<{ children: Array<{ type: string; children: unknown[] }> }>
      }>
    }
    expect(table.children[1].children[0].children[0]).toMatchObject({
      type: 'paragraph',
      children: [],
    })
  })

  test('normalizes common code fence aliases and preserves known names', () => {
    const cases: Array<[string, string]> = [
      ['ts', 'typescript'],
      ['js', 'javascript'],
      ['sh', 'bash'],
      ['yml', 'yaml'],
      ['tsx', 'tsx'],
    ]
    for (const [input, expected] of cases) {
      const code = convert(`\`\`\`${input}\nx\n\`\`\``).state.root.children[0] as unknown as {
        language: string
      }
      expect(code.language).toBe(expected)
    }
  })

  test('collapses hard-wrapped paragraph newlines', () => {
    const paragraph = convert('first line,\nsecond line.').state.root.children[0] as unknown as {
      children: Array<{ text: string }>
    }
    expect(paragraph.children[0].text).toBe('first line, second line.')
  })

  test('maps admonitions and ignores colon-bearing prose', () => {
    const admonition = convert(':::warning[Careful]\nThis is **bold**.\n:::').state.root
      .children[0] as unknown as {
      admonitionType: string
      title: string
      children: Array<{ children: Array<{ text?: string; format?: number }> }>
    }
    expect(admonition).toMatchObject({ admonitionType: 'warning', title: 'Careful' })
    expect(admonition.children[0].children).toContainEqual(
      expect.objectContaining({ text: 'bold', format: 1 })
    )

    const prose = convert('Run at 9:30 with a 1:2:3 ratio and note:foo.')
    expect(prose.warnings).toEqual([])
    expect(prose.state.root.children[0]).toMatchObject({ type: 'paragraph' })
  })

  test('supports untitled, empty, and source-ordered admonitions', () => {
    const untitled = convert(':::tip\nA quick tip.\n:::').state.root.children[0]
    expect(untitled).toMatchObject({ admonitionType: 'tip', title: '' })

    const empty = convert(':::danger[Stop]\n:::').state.root.children[0] as unknown as {
      children: Array<{ type: string; children: unknown[] }>
    }
    expect(empty.children).toEqual([expect.objectContaining({ type: 'paragraph', children: [] })])

    const ordered = convert('# Title\n\n:::note[Note]\nBody.\n:::\n\nAfter.').state.root.children
    expect(ordered.map((node) => (node as { type: string }).type)).toEqual([
      'heading',
      'admonition',
      'paragraph',
    ])
  })

  test('keeps admonition-looking fences inside code blocks as code', () => {
    const state = convert('```\n:::note[Not an admonition]\nstill code\n:::\n```').state
    expect(state.root.children).toHaveLength(1)
    expect(state.root.children[0]).toMatchObject({ type: 'code' })
  })
})
