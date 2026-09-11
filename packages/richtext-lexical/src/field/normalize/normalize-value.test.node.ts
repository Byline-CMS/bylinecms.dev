import { describe, expect, it } from 'vitest'

import { normalizeValue } from './normalize-value'

const text = (value: string, format = 0) => ({
  detail: 0,
  format,
  mode: 'normal',
  style: '',
  text: value,
  type: 'text',
  version: 1,
})
const para = (...children: unknown[]) => ({
  children,
  direction: null,
  format: '',
  indent: 0,
  type: 'paragraph',
  version: 1,
})
const heading = (tag: string, ...children: unknown[]) => ({
  children,
  direction: null,
  format: '',
  indent: 0,
  type: 'heading',
  version: 1,
  tag,
})
// biome-ignore lint/suspicious/noExplicitAny: serialized fixtures are structural
const doc = (...children: unknown[]): any => ({
  root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 },
})

const SUPPORTED = new Set(['root', 'paragraph', 'text', 'linebreak', 'tab'])

describe('normalizeValue', () => {
  it('reports unchanged when every type is supported', () => {
    expect(normalizeValue(doc(para(text('hi'))), SUPPORTED).status).toBe('unchanged')
  })

  it('never mutates its input', () => {
    const input = doc(heading('h1', text('Title')))
    const snapshot = JSON.stringify(input)
    normalizeValue(input, SUPPORTED)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('converts a heading to a paragraph and preserves inline formats exactly', () => {
    const result = normalizeValue(doc(heading('h1', text('Bold title', 1))), SUPPORTED)
    expect(result.status).toBe('adapted')
    if (result.status !== 'adapted') return
    // biome-ignore lint/suspicious/noExplicitAny: structural assertion
    const first = result.value.root.children[0] as any
    expect(first.type).toBe('paragraph')
    expect(first.tag).toBeUndefined()
    // A JSON rewrite carries text formats as data, so bold survives
    // exactly rather than being reconstructed through markup.
    expect(first.children[0].format).toBe(1)
    expect(result.convertedTypes).toEqual(['heading'])
  })

  it('keeps a supported sibling byte-for-byte identical', () => {
    const survivor = para(text('body'))
    const result = normalizeValue(doc(heading('h1', text('T')), survivor), SUPPORTED)
    if (result.status !== 'adapted') throw new Error('expected adapted')
    expect(result.value.root.children[1]).toEqual(survivor)
  })

  it('inspects children of a supported parent', () => {
    const supported = new Set([...SUPPORTED, 'quote'])
    const quote = {
      children: [heading('h2', text('inner'))],
      direction: null,
      format: '',
      indent: 0,
      type: 'quote',
      version: 1,
    }
    const result = normalizeValue(doc(quote), supported)
    if (result.status !== 'adapted') throw new Error('expected adapted')
    // biome-ignore lint/suspicious/noExplicitAny: structural assertion
    const out = result.value.root.children[0] as any
    expect(out.type).toBe('quote')
    expect(out.children[0].type).toBe('paragraph')
    expect(out.children[0].children[0].text).toBe('inner')
  })

  it('keeps adjacent headings as separate paragraphs', () => {
    const result = normalizeValue(
      doc(heading('h1', text('First')), heading('h2', text('Second'))),
      SUPPORTED
    )
    if (result.status !== 'adapted') throw new Error('expected adapted')
    // biome-ignore lint/suspicious/noExplicitAny: structural assertion
    const kids = result.value.root.children as any[]
    expect(kids).toHaveLength(2)
    expect(kids[0].children[0].text).toBe('First')
    expect(kids[1].children[0].text).toBe('Second')
  })

  it('keeps an empty heading as an empty paragraph', () => {
    const result = normalizeValue(doc(heading('h1'), para(text('after'))), SUPPORTED)
    if (result.status !== 'adapted') throw new Error('expected adapted')
    // biome-ignore lint/suspicious/noExplicitAny: structural assertion
    const kids = result.value.root.children as any[]
    expect(kids).toHaveLength(2)
    expect(kids[0].type).toBe('paragraph')
    expect(kids[0].children).toEqual([])
  })

  it('keeps a supported link inside its paragraph rather than at root', () => {
    const link = {
      children: [text('link text')],
      direction: null,
      format: '',
      indent: 0,
      type: 'link',
      version: 2,
      attributes: { url: 'https://x.test' },
    }
    const result = normalizeValue(doc(heading('h1', link)), new Set([...SUPPORTED, 'link']))
    if (result.status !== 'adapted') throw new Error('expected adapted')
    // biome-ignore lint/suspicious/noExplicitAny: structural assertion
    const kids = result.value.root.children as any[]
    expect(kids[0].type).toBe('paragraph')
    expect(kids[0].children[0].type).toBe('link')
  })

  it('flattens a nested table to one paragraph per cell', () => {
    const cell = {
      children: [para(text('cell text'))],
      direction: null,
      format: '',
      indent: 0,
      type: 'tablecell',
      version: 1,
      colSpan: 1,
      rowSpan: 1,
      headerState: 0,
    }
    const row = {
      children: [cell],
      direction: null,
      format: '',
      indent: 0,
      type: 'tablerow',
      version: 1,
    }
    const table = {
      children: [row],
      direction: null,
      format: '',
      indent: 0,
      type: 'table',
      version: 1,
    }
    const result = normalizeValue(doc(table), SUPPORTED)
    if (result.status !== 'adapted') throw new Error('expected adapted')
    // biome-ignore lint/suspicious/noExplicitAny: structural assertion
    const kids = result.value.root.children as any[]
    expect(kids.map((child) => child.type)).toEqual(['paragraph'])
    expect(kids[0].children[0].text).toBe('cell text')
  })

  it('appends the link URL to its text when links are unsupported', () => {
    const link = {
      children: [text('link text')],
      direction: null,
      format: '',
      indent: 0,
      type: 'link',
      version: 2,
      attributes: { url: 'https://x.test/a' },
    }
    const result = normalizeValue(doc(para(link)), SUPPORTED)
    if (result.status !== 'adapted') throw new Error('expected adapted')
    // biome-ignore lint/suspicious/noExplicitAny: structural assertion
    const p = result.value.root.children[0] as any
    expect(p.type).toBe('paragraph')
    const joined = p.children.map((child: { text: string }) => child.text).join('')
    expect(joined).toContain('link text')
    expect(joined).toContain('https://x.test/a')
  })

  it('emits the admonition title as the first line, not appended', () => {
    const admonition = {
      children: [para(text('body copy'))],
      direction: null,
      format: '',
      indent: 0,
      type: 'admonition',
      version: 1,
      title: 'Note title',
    }
    const result = normalizeValue(doc(admonition), SUPPORTED)
    if (result.status !== 'adapted') throw new Error('expected adapted')
    // biome-ignore lint/suspicious/noExplicitAny: structural assertion
    const kids = result.value.root.children as any[]
    expect(kids[0].children[0].text).toBe('Note title')
    expect(kids[1].children[0].text).toBe('body copy')
  })

  it('drops a horizontal rule and keeps its neighbours', () => {
    const result = normalizeValue(
      doc(para(text('before')), { type: 'horizontalrule', version: 1 }, para(text('after'))),
      SUPPORTED
    )
    if (result.status !== 'adapted') throw new Error('expected adapted')
    // biome-ignore lint/suspicious/noExplicitAny: structural assertion
    const kids = result.value.root.children as any[]
    expect(kids.map((child) => child.type)).toEqual(['paragraph', 'paragraph'])
    expect(kids[0].children[0].text).toBe('before')
    expect(kids[1].children[0].text).toBe('after')
  })

  it('never leaves the root empty when conversion removes everything', () => {
    // Lexical rejects an empty root outright: "setEditorState: the editor
    // state is empty."
    const result = normalizeValue(doc({ type: 'horizontalrule', version: 1 }), SUPPORTED)
    if (result.status !== 'adapted') throw new Error('expected adapted')
    // biome-ignore lint/suspicious/noExplicitAny: structural assertion
    const kids = result.value.root.children as any[]
    expect(kids).toHaveLength(1)
    expect(kids[0].type).toBe('paragraph')
    expect(kids[0].children).toEqual([])
  })

  it('lifts a nested list out of its item rather than nesting a block in a paragraph', () => {
    // A listitem may hold a list, not only inline content.
    const inner = {
      children: [
        {
          children: [text('inner')],
          direction: null,
          format: '',
          indent: 1,
          type: 'listitem',
          version: 1,
          value: 1,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      type: 'list',
      version: 1,
      listType: 'bullet',
      start: 1,
      tag: 'ul',
    }
    const outer = {
      children: [
        {
          children: [text('outer')],
          direction: null,
          format: '',
          indent: 0,
          type: 'listitem',
          version: 1,
          value: 1,
        },
        {
          children: [inner],
          direction: null,
          format: '',
          indent: 0,
          type: 'listitem',
          version: 1,
          value: 2,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      type: 'list',
      version: 1,
      listType: 'bullet',
      start: 1,
      tag: 'ul',
    }

    const result = normalizeValue(doc(outer), SUPPORTED)
    if (result.status !== 'adapted') throw new Error('expected adapted')
    // biome-ignore lint/suspicious/noExplicitAny: structural assertion
    const kids = result.value.root.children as any[]
    expect(kids.every((child) => child.type === 'paragraph')).toBe(true)
    // No paragraph contains a block child.
    for (const kid of kids) {
      for (const grandchild of kid.children ?? []) {
        expect(grandchild.type).toBe('text')
      }
    }
    const joined = JSON.stringify(result.value)
    expect(joined).toContain('outer')
    expect(joined).toContain('inner')
  })

  it('keeps a still-supported nested list as a block beside the converted text', () => {
    // Only the item is unsupported here, so its nested list must survive
    // as a sibling block rather than be wrapped into a paragraph.
    const supportedList = {
      children: [
        {
          children: [text('kept')],
          direction: null,
          format: '',
          indent: 1,
          type: 'listitem',
          version: 1,
          value: 1,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      type: 'list',
      version: 1,
      listType: 'bullet',
      start: 1,
      tag: 'ul',
    }
    const item = {
      children: [text('label'), supportedList],
      direction: null,
      format: '',
      indent: 0,
      type: 'listitem',
      version: 1,
      value: 1,
    }
    const result = normalizeValue(doc(item), new Set([...SUPPORTED, 'list']))
    if (result.status !== 'adapted') throw new Error('expected adapted')
    // biome-ignore lint/suspicious/noExplicitAny: structural assertion
    const kids = result.value.root.children as any[]
    expect(kids.map((child) => child.type)).toEqual(['paragraph', 'list'])
    expect(kids[0].children[0].text).toBe('label')
  })

  it('converts highlighted code tokens to text, preserving inline formats', () => {
    // CodeHighlightNode is a TextNode subclass owned by the same
    // extension as CodeNode, so removing code-highlight unregisters both.
    const code = {
      children: [
        {
          detail: 0,
          format: 1,
          mode: 'normal',
          style: '',
          text: 'const',
          type: 'code-highlight',
          version: 1,
          highlightType: 'keyword',
        },
        {
          detail: 0,
          format: 0,
          mode: 'normal',
          style: '',
          text: ' x = 1',
          type: 'code-highlight',
          version: 1,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      type: 'code',
      version: 1,
      language: 'js',
    }
    const result = normalizeValue(doc(code), SUPPORTED)
    expect(result.status).toBe('adapted')
    if (result.status !== 'adapted') return
    // biome-ignore lint/suspicious/noExplicitAny: structural assertion
    const paragraph = result.value.root.children[0] as any
    expect(paragraph.type).toBe('paragraph')
    expect(paragraph.children.every((child: { type: string }) => child.type === 'text')).toBe(true)
    expect(paragraph.children.map((child: { text: string }) => child.text).join('')).toBe(
      'const x = 1'
    )
    // The bold format on the first token survived the conversion.
    expect(paragraph.children[0].format).toBe(1)
  })

  it('refuses a document containing an inline image', () => {
    const result = normalizeValue(
      doc(para({ type: 'inline-image', version: 1, src: '/cat.png' })),
      SUPPORTED
    )
    expect(result.status).toBe('refused')
    if (result.status !== 'refused') return
    expect(result.unsupportedTypes).toContain('inline-image')
  })

  it('refuses for an unknown custom node rather than unwrapping it', () => {
    const custom = { children: [para(text('inner'))], type: 'acme-callout', version: 1 }
    expect(normalizeValue(doc(custom), SUPPORTED).status).toBe('refused')
  })

  it('does not refuse when the custom node is supported', () => {
    const custom = { children: [para(text('inner'))], type: 'acme-callout', version: 1 }
    expect(normalizeValue(doc(custom), new Set([...SUPPORTED, 'acme-callout'])).status).toBe(
      'unchanged'
    )
  })

  it('refusal wins over a conversion elsewhere in the document', () => {
    const result = normalizeValue(
      doc(heading('h1', text('convertible')), para({ type: 'youtube', version: 1, videoID: 'a' })),
      SUPPORTED
    )
    expect(result.status).toBe('refused')
  })

  it('preserves a supported image nested inside an unsupported container', () => {
    // The whole point of converting only what is unsupported: a
    // document-wide re-encode would strip this image's relation and
    // caption as collateral of converting the layout around it.
    const image = {
      type: 'inline-image',
      version: 1,
      src: '/cat.png',
      altText: 'a cat',
      relation: { targetDocumentId: 'doc-1', targetCollectionPath: 'media' },
    }
    const item = {
      children: [para(image)],
      direction: null,
      format: '',
      indent: 0,
      type: 'layout-item',
      version: 1,
    }
    const container = {
      children: [item],
      direction: null,
      format: '',
      indent: 0,
      type: 'layout-container',
      version: 1,
      templateColumns: '1fr',
    }
    const result = normalizeValue(doc(container), new Set([...SUPPORTED, 'inline-image']))
    if (result.status !== 'adapted') throw new Error('expected adapted')
    const json = JSON.stringify(result.value)
    expect(json).toContain('/cat.png')
    expect(json).toContain('a cat')
    expect(json).toContain('doc-1')
  })
})
