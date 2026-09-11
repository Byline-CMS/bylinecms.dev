import { $generateNodesFromDOM } from '@lexical/html'
import { $isElementNode, type LexicalEditor, type LexicalNode } from 'lexical'
import { describe, expect, it } from 'vitest'

import { $isLinkNode } from '../extensions/link'
import {
  buildFullEditor,
  buildRestrictedEditor,
  parseHtmlToTypes,
} from '../test-support/build-test-editor'
import { supportsNodeType } from './registered-node-types'

/**
 * Import `html` and report what the tree contains. Node methods only
 * work inside an editor context, so everything is extracted in here
 * rather than returning live nodes to the caller.
 */
function importedTree(editor: LexicalEditor, html: string): { linkUrls: string[]; text: string } {
  const dom = new DOMParser().parseFromString(html, 'text/html')
  const linkUrls: string[] = []
  let text = ''
  editor.update(
    () => {
      const walk = (nodes: LexicalNode[]) => {
        for (const node of nodes) {
          if ($isLinkNode(node)) linkUrls.push(node.getAttributes().url ?? '')
          if ($isElementNode(node)) walk(node.getChildren())
        }
      }
      const roots = $generateNodesFromDOM(editor, dom)
      walk(roots)
      text = roots.map((node) => node.getTextContent()).join('')
    },
    { discrete: true }
  )
  return { linkUrls, text }
}

describe('node registration follows the extensions list', () => {
  it('registers nothing structural in a fully stripped editor', () => {
    const editor = buildRestrictedEditor()
    for (const type of ['heading', 'quote', 'table', 'link', 'list', 'code']) {
      expect(supportsNodeType(editor, type), `${type} must not be registered`).toBe(false)
    }
    editor.dispose()
  })

  it('degrades every structural paste and keeps the text', () => {
    const editor = buildRestrictedEditor()
    const cases: Array<[string, string, string]> = [
      ['<h1>Pasted title</h1>', 'paragraph', 'Pasted title'],
      ['<blockquote>Quoted words</blockquote>', 'paragraph', 'Quoted words'],
      ['<ul><li>one</li></ul>', 'paragraph', 'one'],
      ['<pre>const x = 1</pre>', 'paragraph', 'const x = 1'],
    ]
    for (const [html, type, text] of cases) {
      const result = parseHtmlToTypes(editor, html)
      expect(result.types, html).toEqual([type])
      expect(result.text, html).toContain(text)
    }
    editor.dispose()
  })

  it('does not regress the full default set', () => {
    const editor = buildFullEditor()
    expect(parseHtmlToTypes(editor, '<h1>Title</h1>').types).toEqual(['heading'])
    expect(parseHtmlToTypes(editor, '<ul><li>one</li></ul>').types).toEqual(['list'])
    expect(parseHtmlToTypes(editor, '<table><tr><td>cell</td></tr></table>').types).toEqual([
      'table',
    ])
    // Inspect the link node itself, not the surrounding text: text
    // survives even when the link is dropped, so a text assertion would
    // pass in exactly the case this is meant to catch.
    const tree = importedTree(editor, '<p>see <a href="https://x.com/a">link</a></p>')
    expect(tree.linkUrls).toEqual(['https://x.com/a'])
    editor.dispose()
  })

  it('drops the link node, but keeps its text, when the link extension is removed', () => {
    const editor = buildRestrictedEditor()
    const tree = importedTree(editor, '<p>see <a href="https://x.com/a">link</a></p>')
    expect(tree.linkUrls).toEqual([])
    expect(tree.text).toContain('link')
    editor.dispose()
  })
})
