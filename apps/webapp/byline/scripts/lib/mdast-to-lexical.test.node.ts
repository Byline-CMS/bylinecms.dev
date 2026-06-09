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

  test('paragraph with plain text', () => {
    const { state } = convert('hello world')
    expect(state.root.children[0]).toMatchObject({
      type: 'paragraph',
      children: [{ type: 'text', text: 'hello world', format: 0 }],
    })
  })

  test('heading depth maps to tag h1-h6', () => {
    const { state } = convert('# h1\n\n## h2\n\n###### h6')
    expect(state.root.children).toHaveLength(3)
    expect(state.root.children[0]).toMatchObject({ type: 'heading', tag: 'h1' })
    expect(state.root.children[1]).toMatchObject({ type: 'heading', tag: 'h2' })
    expect(state.root.children[2]).toMatchObject({ type: 'heading', tag: 'h6' })
  })

  test('bold + italic compose into a single text node with bitmask format=3', () => {
    const { state } = convert('***both***')
    const paragraph = state.root.children[0] as unknown as {
      children: Array<{ format: number; text: string }>
    }
    expect(paragraph.children).toHaveLength(1)
    expect(paragraph.children[0]).toMatchObject({ text: 'both', format: 1 | 2 })
  })

  test('inline code carries the IS_CODE bit', () => {
    const { state } = convert('a `b` c')
    const paragraph = state.root.children[0] as unknown as {
      children: Array<{ format: number; text: string }>
    }
    // 'a ', code 'b', ' c'
    expect(paragraph.children.map((c) => ({ text: c.text, format: c.format }))).toEqual([
      { text: 'a ', format: 0 },
      { text: 'b', format: 1 << 4 },
      { text: ' c', format: 0 },
    ])
  })

  test('strikethrough (GFM) carries the strikethrough bit', () => {
    const { state } = convert('a ~~b~~ c')
    const paragraph = state.root.children[0] as unknown as {
      children: Array<{ format: number; text: string }>
    }
    const struck = paragraph.children.find((c) => c.text === 'b')
    expect(struck?.format).toBe(1 << 2)
  })

  test('unordered list emits listType=bullet, tag=ul, listitems with peeled paragraph children', () => {
    const { state } = convert('- one\n- two')
    const list = state.root.children[0] as unknown as {
      type: string
      listType: string
      tag: string
      children: Array<{ type: string; children: Array<{ type: string; text: string }> }>
    }
    expect(list).toMatchObject({ type: 'list', listType: 'bullet', tag: 'ul' })
    expect(list.children).toHaveLength(2)
    expect(list.children[0]).toMatchObject({
      type: 'listitem',
      children: [{ type: 'text', text: 'one' }],
    })
  })

  test('ordered list propagates start and numbers values', () => {
    const { state } = convert('3. a\n4. b')
    const list = state.root.children[0] as unknown as {
      listType: string
      tag: string
      start: number
      children: Array<{ value: number }>
    }
    expect(list).toMatchObject({ listType: 'number', tag: 'ol', start: 3 })
    expect(list.children[0].value).toBe(3)
    expect(list.children[1].value).toBe(4)
  })

  test('nested list lives inside the parent listitem', () => {
    const { state } = convert('- a\n  - a1\n- b')
    const list = state.root.children[0] as unknown as {
      children: Array<{ children: Array<{ type: string }> }>
    }
    const firstItemChildren = list.children[0].children
    expect(firstItemChildren.some((c) => c.type === 'list')).toBe(true)
  })

  test('link emits link node with custom attributes envelope', () => {
    const { state } = convert('[label](https://example.com)')
    const paragraph = state.root.children[0] as unknown as {
      children: Array<{
        type: string
        attributes?: { linkType?: string; url?: string; newTab?: boolean }
        children?: Array<{ text: string }>
      }>
    }
    const link = paragraph.children[0]
    expect(link.type).toBe('link')
    expect(link.attributes).toMatchObject({
      linkType: 'custom',
      url: 'https://example.com',
      newTab: true,
    })
    expect(link.children?.[0]).toMatchObject({ text: 'label' })
  })

  test('fenced code with language stores `language` and emits code-highlight + linebreak children', () => {
    const { state } = convert('```ts\nconst x = 1\nconst y = 2\n```')
    const code = state.root.children[0] as unknown as {
      type: string
      language: string
      children: Array<{ type: string; text?: string }>
    }
    expect(code).toMatchObject({ type: 'code', language: 'typescript' })
    expect(code.children[0]).toMatchObject({ type: 'code-highlight', text: 'const x = 1' })
    expect(code.children[1]).toMatchObject({ type: 'linebreak' })
    expect(code.children[2]).toMatchObject({ type: 'code-highlight', text: 'const y = 2' })
  })

  test('thematic break emits horizontalrule', () => {
    const { state } = convert('---')
    expect(state.root.children[0]).toMatchObject({ type: 'horizontalrule' })
  })

  test('blockquote flattens single paragraph into inline children', () => {
    const { state } = convert('> hello')
    const quote = state.root.children[0] as unknown as {
      type: string
      children: Array<{ type: string; text?: string }>
    }
    expect(quote.type).toBe('quote')
    expect(quote.children).toEqual([expect.objectContaining({ type: 'text', text: 'hello' })])
  })

  test('image at block level is dropped with a warning', () => {
    const { warnings, state } = convert('![alt](https://example.com/x.png)')
    expect(warnings.some((w) => w.kind === 'dropped-image')).toBe(true)
    // Paragraph survives as empty (image was its only child)
    expect(state.root.children[0]).toMatchObject({ type: 'paragraph' })
  })

  test('GFM table maps to table/tablerow/tablecell with first-row headerState', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |\n'
    const { state, warnings } = convert(md)
    expect(warnings).toEqual([])

    const table = state.root.children[0] as unknown as {
      type: string
      children: Array<{
        type: string
        children: Array<{
          type: string
          headerState: number
          children: Array<{ type: string; children: Array<{ text: string }> }>
        }>
      }>
    }
    expect(table.type).toBe('table')
    expect(table.children).toHaveLength(2)

    const [headerRow, bodyRow] = table.children
    expect(headerRow.type).toBe('tablerow')
    expect(bodyRow.type).toBe('tablerow')
    expect(headerRow.children[0]).toMatchObject({ type: 'tablecell', headerState: 1 })
    expect(headerRow.children[1]).toMatchObject({ type: 'tablecell', headerState: 1 })
    expect(bodyRow.children[0]).toMatchObject({ type: 'tablecell', headerState: 0 })
    expect(bodyRow.children[1]).toMatchObject({ type: 'tablecell', headerState: 0 })

    // Inline cell content is wrapped in a paragraph.
    const firstHeaderCell = headerRow.children[0]
    expect(firstHeaderCell.children[0].type).toBe('paragraph')
    expect(firstHeaderCell.children[0].children[0]).toMatchObject({ text: 'a' })
    expect(bodyRow.children[1].children[0].children[0]).toMatchObject({ text: '2' })
  })

  test('empty cell emits a paragraph with no children', () => {
    const md = '| a | b |\n| - | - |\n|   | 2 |\n'
    const { state } = convert(md)
    const table = state.root.children[0] as unknown as {
      children: Array<{
        children: Array<{ children: Array<{ type: string; children: unknown[] }> }>
      }>
    }
    const emptyCellParagraph = table.children[1].children[0].children[0]
    expect(emptyCellParagraph).toMatchObject({ type: 'paragraph', children: [] })
  })

  test('inline formatting inside cells is preserved', () => {
    const md = '| col |\n| - |\n| **bold** |\n'
    const { state } = convert(md)
    const table = state.root.children[0] as unknown as {
      children: Array<{
        children: Array<{
          children: Array<{ children: Array<{ text: string; format: number }> }>
        }>
      }>
    }
    const bodyCellInline = table.children[1].children[0].children[0].children[0]
    expect(bodyCellInline).toMatchObject({ text: 'bold', format: 1 })
  })

  test('code fence language is normalized to prism-known ids', () => {
    const cases: Array<[string, string]> = [
      ['ts', 'typescript'],
      ['js', 'javascript'],
      ['sh', 'bash'],
      ['yml', 'yaml'],
      ['tsx', 'tsx'], // already prism-known, passes through
    ]
    for (const [input, expected] of cases) {
      const { state } = convert(`\`\`\`${input}\nx\n\`\`\``)
      const code = state.root.children[0] as unknown as { language: string }
      expect(code.language).toBe(expected)
    }
  })

  test('hard-wrapped paragraph collapses internal newlines to spaces', () => {
    const md =
      'In a world where AI produces content fast,\ninto dozens of languages,\nwhy does a CMS matter?'
    const { state } = convert(md)
    const paragraph = state.root.children[0] as unknown as {
      children: Array<{ text: string }>
    }
    // Single text node with newlines collapsed to single spaces — no
    // <br> nodes and no embedded \n.
    expect(paragraph.children).toHaveLength(1)
    expect(paragraph.children[0].text).toBe(
      'In a world where AI produces content fast, into dozens of languages, why does a CMS matter?'
    )
  })

  describe('admonitions', () => {
    test('titled note becomes an admonition node with body paragraphs', () => {
      const md = [':::note[Heads up]', 'First line.', '', 'Second line.', ':::'].join('\n')
      const { state, warnings } = convert(md)
      expect(warnings).toEqual([])
      expect(state.root.children).toHaveLength(1)
      const adm = state.root.children[0] as unknown as {
        type: string
        admonitionType: string
        title: string
        children: Array<{ type: string; children: Array<{ text: string }> }>
      }
      expect(adm).toMatchObject({ type: 'admonition', admonitionType: 'note', title: 'Heads up' })
      expect(adm.children).toHaveLength(2)
      expect(adm.children[0]).toMatchObject({ type: 'paragraph' })
      expect(adm.children[0].children[0].text).toBe('First line.')
      expect(adm.children[1].children[0].text).toBe('Second line.')
    })

    test('inline formatting + links survive inside an admonition body', () => {
      const md = [
        ':::warning[Careful]',
        'This is **bold** and a [link](https://x.io).',
        ':::',
      ].join('\n')
      const { state } = convert(md)
      const adm = state.root.children[0] as unknown as {
        admonitionType: string
        children: Array<{ children: Array<{ type: string; text?: string; format?: number }> }>
      }
      expect(adm.admonitionType).toBe('warning')
      const inline = adm.children[0].children
      expect(inline).toContainEqual(expect.objectContaining({ text: 'bold', format: 1 }))
      expect(inline).toContainEqual(expect.objectContaining({ type: 'link' }))
    })

    test('untitled admonition carries an empty title', () => {
      const { state } = convert([':::tip', 'A quick tip.', ':::'].join('\n'))
      const adm = state.root.children[0] as unknown as { admonitionType: string; title: string }
      expect(adm).toMatchObject({ admonitionType: 'tip', title: '' })
    })

    test('an empty admonition body is seeded with one empty paragraph', () => {
      const { state } = convert([':::danger[Stop]', ':::'].join('\n'))
      const adm = state.root.children[0] as unknown as {
        admonitionType: string
        children: Array<{ type: string; children: unknown[] }>
      }
      expect(adm.admonitionType).toBe('danger')
      expect(adm.children).toEqual([expect.objectContaining({ type: 'paragraph', children: [] })])
    })

    test('admonitions sit alongside ordinary blocks in source order', () => {
      const md = ['# Title', '', ':::note[Note]', 'Body.', ':::', '', 'After.'].join('\n')
      const { state } = convert(md)
      expect(state.root.children.map((c) => (c as { type: string }).type)).toEqual([
        'heading',
        'admonition',
        'paragraph',
      ])
    })

    test('colon-bearing prose is never mistaken for a directive', () => {
      // The line scanner only matches the four container fences, so inline
      // colons (`9:30`, `1:2:3`, `note:foo`) pass through untouched.
      const { state, warnings } = convert('Run at 9:30 with a 1:2:3 ratio and note:foo.')
      expect(warnings).toEqual([])
      const paragraph = state.root.children[0] as unknown as { children: Array<{ text: string }> }
      expect(paragraph.children).toHaveLength(1)
      expect(paragraph.children[0].text).toBe('Run at 9:30 with a 1:2:3 ratio and note:foo.')
    })

    test('a `:::` fence inside a code block is treated as literal code', () => {
      const md = ['```', ':::note[Not an admonition]', 'still code', ':::', '```'].join('\n')
      const { state } = convert(md)
      expect(state.root.children).toHaveLength(1)
      expect(state.root.children[0]).toMatchObject({ type: 'code' })
    })
  })
})
