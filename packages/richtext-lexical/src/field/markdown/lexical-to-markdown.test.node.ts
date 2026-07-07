/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Contract tests for the one-way Lexical → markdown export serializer.
 * The expected strings below ARE the format contract — agents build on
 * this shape, so a change here is a consumer-visible format change and
 * should be deliberate (see TODO-INTERNAL.md → "The output is a contract
 * surface").
 */

import { describe, expect, it } from 'vitest'

import { lexicalToMarkdown } from './lexical-to-markdown'

// ---------------------------------------------------------------------------
// Fixture helpers — minimal stored-JSON shapes
// ---------------------------------------------------------------------------

const text = (t: string, format = 0) => ({
  type: 'text',
  text: t,
  format,
  detail: 0,
  mode: 'normal',
  style: '',
  version: 1,
})

const paragraph = (...children: unknown[]) => ({
  type: 'paragraph',
  children,
  direction: 'ltr',
  format: '',
  indent: 0,
  version: 1,
})

const root = (...children: unknown[]) => ({
  root: { type: 'root', children, direction: 'ltr', format: '', indent: 0, version: 1 },
})

const md = (state: unknown) => lexicalToMarkdown(state).markdown

// ---------------------------------------------------------------------------

describe('lexicalToMarkdown — blocks', () => {
  it('serializes paragraphs separated by blank lines', () => {
    expect(md(root(paragraph(text('First.')), paragraph(text('Second.'))))).toBe(
      'First.\n\nSecond.'
    )
  })

  it('serializes headings h1–h6 from the tag property', () => {
    const state = root(
      { type: 'heading', tag: 'h2', children: [text('Title')], version: 1 },
      { type: 'heading', tag: 'h4', children: [text('Sub')], version: 1 }
    )
    expect(md(state)).toBe('## Title\n\n#### Sub')
  })

  it('serializes bullet, numbered, and check lists', () => {
    const item = (t: string, extra: Record<string, unknown> = {}) => ({
      type: 'listitem',
      children: [text(t)],
      version: 1,
      ...extra,
    })
    expect(
      md(root({ type: 'list', listType: 'bullet', children: [item('a'), item('b')], version: 1 }))
    ).toBe('- a\n- b')
    expect(
      md(root({ type: 'list', listType: 'number', children: [item('a'), item('b')], version: 1 }))
    ).toBe('1. a\n2. b')
    expect(
      md(
        root({
          type: 'list',
          listType: 'check',
          children: [item('done', { checked: true }), item('todo')],
          version: 1,
        })
      )
    ).toBe('- [x] done\n- [ ] todo')
  })

  it('serializes nested lists with indentation', () => {
    const state = root({
      type: 'list',
      listType: 'bullet',
      version: 1,
      children: [
        {
          type: 'listitem',
          version: 1,
          children: [
            text('outer'),
            {
              type: 'list',
              listType: 'bullet',
              version: 1,
              children: [{ type: 'listitem', children: [text('inner')], version: 1 }],
            },
          ],
        },
      ],
    })
    expect(md(state)).toBe('- outer\n  - inner')
  })

  it('serializes blockquotes', () => {
    expect(md(root({ type: 'quote', children: [text('wise words')], version: 1 }))).toBe(
      '> wise words'
    )
  })

  it('serializes code blocks with language and code-highlight children', () => {
    const state = root({
      type: 'code',
      language: 'ts',
      version: 1,
      children: [
        { type: 'code-highlight', text: 'const a = 1', version: 1 },
        { type: 'linebreak', version: 1 },
        { type: 'code-highlight', text: 'const b = 2', version: 1 },
      ],
    })
    expect(md(state)).toBe('```ts\nconst a = 1\nconst b = 2\n```')
  })

  it('serializes tables as GFM pipes with the first row as header', () => {
    const cell = (t: string, headerState = 0) => ({
      type: 'tablecell',
      headerState,
      children: [paragraph(text(t))],
      version: 1,
    })
    const row = (...cells: unknown[]) => ({ type: 'tablerow', children: cells, version: 1 })
    const state = root({
      type: 'table',
      version: 1,
      children: [row(cell('Name', 1), cell('Age', 1)), row(cell('Ada'), cell('36'))],
    })
    expect(md(state)).toBe('| Name | Age |\n| --- | --- |\n| Ada | 36 |')
  })

  it('serializes horizontal rules', () => {
    expect(md(root(paragraph(text('a')), { type: 'horizontalrule', version: 1 }))).toBe('a\n\n---')
  })

  it('serializes admonitions as GFM alerts with bold title', () => {
    const state = root({
      type: 'admonition',
      admonitionType: 'warning',
      title: 'Careful',
      version: 1,
      children: [paragraph(text('Hot surface.'))],
    })
    expect(md(state)).toBe('> [!WARNING]\n>\n> **Careful**\n>\n> Hot surface.')
  })

  it('maps danger to CAUTION and omits an absent title', () => {
    const state = root({
      type: 'admonition',
      admonitionType: 'danger',
      title: '',
      version: 1,
      children: [paragraph(text('Boom.'))],
    })
    expect(md(state)).toBe('> [!CAUTION]\n>\n> Boom.')
  })

  it('serializes video embeds as links', () => {
    expect(md(root({ type: 'youtube', videoID: 'abc123', version: 1 }))).toBe(
      '[YouTube video](https://www.youtube.com/watch?v=abc123)'
    )
    expect(md(root({ type: 'vimeo', videoID: '987', version: 1 }))).toBe(
      '[Vimeo video](https://vimeo.com/987)'
    )
  })

  it('flattens layout columns to stacked sections', () => {
    const state = root({
      type: 'layout-container',
      templateColumns: '1fr 1fr',
      version: 1,
      children: [
        { type: 'layout-item', children: [paragraph(text('left'))], version: 1 },
        { type: 'layout-item', children: [paragraph(text('right'))], version: 1 },
      ],
    })
    expect(md(state)).toBe('left\n\nright')
  })

  it('serializes unknown block nodes via their children with a warning', () => {
    const result = lexicalToMarkdown(
      root({ type: 'future-node', children: [paragraph(text('still here'))], version: 1 })
    )
    expect(result.markdown).toBe('still here')
    expect(result.warnings).toContainEqual(expect.objectContaining({ kind: 'unknown-node' }))
  })
})

describe('lexicalToMarkdown — inline', () => {
  it('decodes the format bitmask', () => {
    expect(md(root(paragraph(text('bold', 1))))).toBe('**bold**')
    expect(md(root(paragraph(text('italic', 2))))).toBe('*italic*')
    expect(md(root(paragraph(text('both', 3))))).toBe('***both***')
    expect(md(root(paragraph(text('struck', 4))))).toBe('~~struck~~')
    expect(md(root(paragraph(text('code()', 16))))).toBe('`code()`')
  })

  it('drops underline/highlight wrappers but keeps the text (lossy-OK)', () => {
    expect(md(root(paragraph(text('plain', 8))))).toBe('plain')
    expect(md(root(paragraph(text('plain', 128))))).toBe('plain')
  })

  it('merges consecutive text nodes sharing a format', () => {
    expect(md(root(paragraph(text('bo', 1), text('ld', 1), text(' plain'))))).toBe('**bold** plain')
  })

  it('hoists whitespace outside emphasis markers', () => {
    expect(md(root(paragraph(text('a'), text(' spaced ', 1), text('b'))))).toBe('a **spaced** b')
  })

  it('escapes markdown-significant characters in plain text', () => {
    expect(md(root(paragraph(text('2 * 3 [not a link]'))))).toBe('2 \\* 3 \\[not a link\\]')
  })

  it('does not escape inside inline code', () => {
    expect(md(root(paragraph(text('a * b', 16))))).toBe('`a * b`')
  })

  it('serializes custom links', () => {
    const link = {
      type: 'link',
      attributes: { linkType: 'custom', url: 'https://example.com' },
      children: [text('Example')],
      version: 1,
    }
    expect(md(root(paragraph(link)))).toBe('[Example](https://example.com)')
  })

  it('composes internal link URLs from the embedded document envelope', () => {
    const link = {
      type: 'link',
      attributes: {
        linkType: 'internal',
        targetDocumentId: 'doc-1',
        targetCollectionPath: 'news',
        document: { title: 'A Post', path: 'a-post', _resolved: true },
      },
      children: [text('A Post')],
      version: 1,
    }
    expect(md(root(paragraph(link)))).toBe('[A Post](/news/a-post)')
  })

  it('prefers the resolveInternalUrl callback for internal links', () => {
    const link = {
      type: 'link',
      attributes: {
        linkType: 'internal',
        targetCollectionPath: 'news',
        document: { path: 'a-post', _resolved: true },
      },
      children: [text('A Post')],
      version: 1,
    }
    const result = lexicalToMarkdown(root(paragraph(link)), {
      resolveInternalUrl: ({ targetCollectionPath, documentPath }) =>
        `https://example.org/${targetCollectionPath}/${documentPath}.md`,
    })
    expect(result.markdown).toBe('[A Post](https://example.org/news/a-post.md)')
  })

  it('keeps the text and drops the link when an internal target is unresolved', () => {
    const link = {
      type: 'link',
      attributes: {
        linkType: 'internal',
        targetDocumentId: 'gone',
        document: { _resolved: false },
      },
      children: [text('Missing')],
      version: 1,
    }
    const result = lexicalToMarkdown(root(paragraph(link)))
    expect(result.markdown).toBe('Missing')
    expect(result.warnings).toContainEqual(expect.objectContaining({ kind: 'unresolved-link' }))
  })

  it('serializes inline images with alt text and flattened caption', () => {
    const image = {
      type: 'inline-image',
      src: '/uploads/media/photo.avif',
      altText: 'A photo',
      showCaption: true,
      caption: { editorState: root(paragraph(text('Taken in 2026.'))) },
      version: 1,
    }
    expect(md(root(paragraph(image)))).toBe(
      '![A photo](/uploads/media/photo.avif)\n*Taken in 2026.*'
    )
  })

  it('serializes hard line breaks', () => {
    expect(
      md(root(paragraph(text('line one'), { type: 'linebreak', version: 1 }, text('line two'))))
    ).toBe('line one\\\nline two')
  })
})

describe('lexicalToMarkdown — robustness', () => {
  it('returns empty for null, non-richtext shapes, and bad JSON strings', () => {
    expect(md(null)).toBe('')
    expect(md({ not: 'lexical' })).toBe('')
    expect(md('not json')).toBe('')
  })

  it('accepts a stringified editor state', () => {
    expect(md(JSON.stringify(root(paragraph(text('parsed')))))).toBe('parsed')
  })

  it('skips empty paragraphs', () => {
    expect(md(root(paragraph(), paragraph(text('only')), paragraph()))).toBe('only')
  })
})
