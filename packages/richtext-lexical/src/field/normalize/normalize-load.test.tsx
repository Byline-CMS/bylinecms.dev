import { $getRoot } from 'lexical'
import { describe, expect, it } from 'vitest'

import { registeredNodeTypes } from '../capabilities/registered-node-types'
import { builtInExtensions } from '../config/built-in-extension-names'
import { buildRestrictedEditor } from '../test-support/build-test-editor'
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

/**
 * Normalize for this editor and actually load the result.
 *
 * Structural assertions on the JSON are not enough: only Lexical can say
 * whether the tree it produced is one it will accept, and an invalid
 * parent/child arrangement throws here rather than in a unit assertion.
 */
function normalizeAndLoad(
  /** Undefined means the default fully-stripped editor. */
  removals: string[] | undefined,
  // biome-ignore lint/suspicious/noExplicitAny: serialized fixtures are structural
  value: any
): { types: string[]; text: string; formats: number[] } {
  const editor = buildRestrictedEditor(removals)
  const result = normalizeValue(value, registeredNodeTypes(editor))
  if (result.status !== 'adapted') throw new Error(`expected adapted, got ${result.status}`)

  // Actually COMMIT the state. Parsing alone does not exercise
  // setEditorState's own validation — an empty root parses happily and
  // then throws "setEditorState: the editor state is empty" on commit.
  const state = editor.parseEditorState(JSON.stringify(result.value))
  editor.setEditorState(state)

  let types: string[] = []
  let content = ''
  let formats: number[] = []
  editor.getEditorState().read(() => {
    types = $getRoot()
      .getChildren()
      .map((node) => node.getType())
    content = $getRoot().getTextContent()
    formats = $getRoot()
      .getAllTextNodes()
      .map((node) => node.getFormat())
  })
  editor.dispose()
  return { types, text: content, formats }
}

describe('normalized output loads into a real editor', () => {
  it('commits a document whose only node was dropped', () => {
    const result = normalizeAndLoad(undefined, doc({ type: 'horizontalrule', version: 1 }))
    expect(result.types).toEqual(['paragraph'])
    expect(result.text).toBe('')
  })

  it('commits highlighted code as plain text with formats intact', () => {
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
    const result = normalizeAndLoad([builtInExtensions.CodeHighlight], doc(code))
    expect(result.types).toEqual(['paragraph'])
    expect(result.text).toBe('const x = 1')
    expect(result.formats).toContain(1)
  })

  it('commits a nested list flattened to paragraphs', () => {
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
    const result = normalizeAndLoad(undefined, doc(outer))
    expect(new Set(result.types)).toEqual(new Set(['paragraph']))
    expect(result.text).toContain('outer')
    expect(result.text).toContain('inner')
  })

  it('loads mixed content — adjacent headings, an empty one, a table and a list', () => {
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
    const table = {
      children: [
        {
          children: [cell],
          direction: null,
          format: '',
          indent: 0,
          type: 'tablerow',
          version: 1,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      type: 'table',
      version: 1,
    }
    const list = {
      children: [
        {
          children: [text('item one')],
          direction: null,
          format: '',
          indent: 0,
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

    const result = normalizeAndLoad(
      undefined,
      doc(
        heading('h1', text('First')),
        heading('h2'),
        heading('h2', text('Second')),
        table,
        list,
        para(text('tail'))
      )
    )

    // Every block came back as a paragraph and Lexical accepted the tree.
    expect(new Set(result.types)).toEqual(new Set(['paragraph']))
    for (const fragment of ['First', 'Second', 'cell text', 'item one', 'tail']) {
      expect(result.text, fragment).toContain(fragment)
    }
    // Adjacent headings did not merge into one paragraph.
    expect(result.text).not.toContain('FirstSecond')
  })

  it('preserves bold through the load, not just through the rewrite', () => {
    const result = normalizeAndLoad(undefined, doc(heading('h1', text('Bold title', 1))))
    expect(result.types).toEqual(['paragraph'])
    expect(result.text).toBe('Bold title')
    expect(result.formats).toContain(1)
  })

  it('loads a preserved link URL as readable text', () => {
    const link = {
      children: [text('link text')],
      direction: null,
      format: '',
      indent: 0,
      type: 'link',
      version: 2,
      attributes: { url: 'https://x.test/a' },
    }
    const result = normalizeAndLoad([builtInExtensions.Link], doc(para(link)))
    expect(result.types).toEqual(['paragraph'])
    expect(result.text).toContain('link text')
    expect(result.text).toContain('https://x.test/a')
  })

  it('loads a preserved admonition title as the first line', () => {
    const admonition = {
      children: [para(text('body copy'))],
      direction: null,
      format: '',
      indent: 0,
      type: 'admonition',
      version: 1,
      title: 'Note title',
    }
    const result = normalizeAndLoad([builtInExtensions.Admonition], doc(admonition))
    expect(result.types).toEqual(['paragraph', 'paragraph'])
    expect(result.text.indexOf('Note title')).toBeLessThan(result.text.indexOf('body copy'))
  })

  it('loads a layout that still contains its supported image', () => {
    // Shaped as InlineImageNode.exportJSON writes it: the relation is
    // spread at the top level, and `caption` is a whole nested editor
    // state — which is exactly why an inline image has no safe
    // structural conversion and must take the refusal path instead.
    const image = {
      type: 'inline-image',
      version: 1,
      targetDocumentId: 'doc-1',
      targetCollectionPath: 'media',
      src: '/cat.png',
      position: 'full',
      altText: 'a cat',
      width: 10,
      height: 10,
      showCaption: false,
      caption: {
        editorState: {
          root: {
            children: [para(text('caption words'))],
            direction: null,
            format: '',
            indent: 0,
            type: 'root',
            version: 1,
          },
        },
      },
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
    // Layout removed, inline image KEPT: the image must survive intact.
    const editor = buildRestrictedEditor([builtInExtensions.Layout])
    const result = normalizeValue(doc(container), registeredNodeTypes(editor))
    if (result.status !== 'adapted') throw new Error('expected adapted')
    const state = editor.parseEditorState(JSON.stringify(result.value))
    const types: string[] = []
    let sources = ''
    state.read(() => {
      const walk = (
        nodes: ReturnType<typeof $getRoot>['getChildren'] extends () => infer R ? R : never
      ) => {
        for (const node of nodes as Array<{
          getType: () => string
          getChildren?: () => unknown[]
        }>) {
          types.push(node.getType())
          if (typeof node.getChildren === 'function') {
            // biome-ignore lint/suspicious/noExplicitAny: structural walk
            walk(node.getChildren() as any)
          }
        }
      }
      // biome-ignore lint/suspicious/noExplicitAny: structural walk
      walk($getRoot().getChildren() as any)
      sources = JSON.stringify(result.value)
    })
    // The layout wrapper is gone, the image it held is still there.
    expect(types).not.toContain('layout-container')
    expect(types).toContain('inline-image')
    expect(sources).toContain('/cat.png')
    expect(sources).toContain('doc-1')
    // The caption's nested editor state survived untouched.
    expect(sources).toContain('caption words')
    editor.dispose()
  })
})
