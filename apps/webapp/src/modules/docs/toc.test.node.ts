import { formatTextValue } from '@byline/core'
import { describe, expect, it } from 'vitest'

import { extractDocHeadings } from './toc.js'
import type { PopulatedContentBlock } from '@/lib/content-types'

/** Minimal Lexical text node. */
function text(value: string) {
  return { type: 'text', text: value, version: 1 }
}

/** Minimal Lexical heading node. */
function heading(tag: string, children: unknown[]) {
  return { type: 'heading', tag, version: 1, children }
}

/** Wrap heading nodes in the richTextBlock shape `extractDocHeadings` reads. */
function richTextBlock(children: unknown[]): PopulatedContentBlock {
  return {
    _id: 'block-1',
    _type: 'richTextBlock',
    richText: { root: { children } },
  } as unknown as PopulatedContentBlock
}

describe('extractDocHeadings', () => {
  it('collects h2 and h3 in document order with serializer-matching ids', () => {
    const blocks = [
      richTextBlock([
        heading('h2', [text('Getting started')]),
        { type: 'paragraph', version: 1, children: [text('body')] },
        heading('h3', [text('Install the CLI')]),
        heading('h2', [text('Configuration')]),
      ]),
    ]

    expect(extractDocHeadings(blocks)).toEqual([
      { id: 'getting-started', text: 'Getting started', level: 2 },
      { id: 'install-the-cli', text: 'Install the CLI', level: 3 },
      { id: 'configuration', text: 'Configuration', level: 2 },
    ])
  })

  it('flattens nested formatting so the id matches the rendered anchor', () => {
    // The regression this guards: a heading whose text is split across nested
    // nodes (bold, inline code) once yielded only its first top-level segment,
    // producing a fragment that pointed nowhere.
    const blocks = [
      richTextBlock([
        heading('h2', [
          text('Using '),
          { type: 'text', text: 'defineBlock', format: 16, version: 1 },
          { type: 'link', version: 1, children: [text(' safely')] },
        ]),
      ]),
    ]

    const [entry] = extractDocHeadings(blocks)
    expect(entry.text).toBe('Using defineBlock safely')
    expect(entry.id).toBe(formatTextValue('Using defineBlock safely'))
  })

  it('ignores h1 and h4-h6, which render without anchors', () => {
    const blocks = [
      richTextBlock([
        heading('h1', [text('Page title')]),
        heading('h2', [text('Real section')]),
        heading('h4', [text('Aside')]),
        heading('h6', [text('Footnote')]),
      ]),
    ]

    expect(extractDocHeadings(blocks)).toEqual([
      { id: 'real-section', text: 'Real section', level: 2 },
    ])
  })

  it('collects headings across multiple richText blocks, skipping other types', () => {
    const blocks = [
      richTextBlock([heading('h2', [text('First')])]),
      {
        _id: 'b2',
        _type: 'codeBlock',
        code: '## Not a heading',
      } as unknown as PopulatedContentBlock,
      richTextBlock([heading('h2', [text('Second')])]),
    ]

    expect(extractDocHeadings(blocks).map((h) => h.id)).toEqual(['first', 'second'])
  })

  it('finds headings nested inside a container node', () => {
    const blocks = [
      richTextBlock([
        { type: 'admonition', version: 1, children: [heading('h3', [text('Take care')])] },
      ]),
    ]

    expect(extractDocHeadings(blocks)).toEqual([{ id: 'take-care', text: 'Take care', level: 3 }])
  })

  it('drops duplicate slugs, which would all resolve to the first occurrence', () => {
    const blocks = [
      richTextBlock([heading('h2', [text('Options')]), heading('h2', [text('Options')])]),
    ]

    expect(extractDocHeadings(blocks)).toHaveLength(1)
  })

  it('skips headings with no text', () => {
    const blocks = [richTextBlock([heading('h2', []), heading('h2', [text('   ')])])]
    expect(extractDocHeadings(blocks)).toEqual([])
  })

  it('returns an empty list for missing or empty content', () => {
    expect(extractDocHeadings(undefined)).toEqual([])
    expect(extractDocHeadings(null)).toEqual([])
    expect(extractDocHeadings([])).toEqual([])
  })
})
