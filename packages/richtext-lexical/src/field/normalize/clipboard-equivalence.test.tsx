import { $insertDataTransferForRichText } from '@lexical/clipboard'
import { registerRichText } from '@lexical/rich-text'
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical'
import { describe, expect, it, vi } from 'vitest'

import { registeredNodeTypes } from '../capabilities/registered-node-types'
import { builtInExtensions } from '../config/built-in-extension-names'
import { buildRestrictedEditor } from '../test-support/build-test-editor'
import { normalizeValue } from './normalize-value'

const NAMESPACE = 'LexicalRichText'

const text = (value: string) => ({
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text: value,
  type: 'text',
  version: 1,
})
// biome-ignore lint/suspicious/noExplicitAny: serialized fixtures are structural
const doc = (...children: unknown[]): any => ({
  root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 },
})

function snapshot(editor: LexicalEditor): { types: string[]; text: string } {
  let types: string[] = []
  let content = ''
  editor.getEditorState().read(() => {
    types = $getRoot()
      .getChildren()
      .map((node) => node.getType())
    content = $getRoot().getTextContent()
  })
  return { types, text: content }
}

/** Load `saved` through the normalizer and commit it. */
function viaStorage(removals: string[] | undefined, saved: SerializedEditorState) {
  const editor = buildRestrictedEditor(removals)
  const result = normalizeValue(saved, registeredNodeTypes(editor))
  if (result.status !== 'adapted') throw new Error(`expected adapted, got ${result.status}`)
  editor.setEditorState(editor.parseEditorState(JSON.stringify(result.value)))
  const out = snapshot(editor)
  editor.dispose()
  return out
}

const stubDataTransfer = (data: Record<string, string>) => ({
  types: Object.keys(data),
  getData: (type: string) => data[type] ?? '',
})

/** Paste a real clipboard payload through registerRichText's handler. */
function pasteClipboard(
  removals: string[] | undefined,
  data: Record<string, string>
): { types: string[]; text: string; threw: string; consoleErrors: string[] } {
  const editor = buildRestrictedEditor(removals)
  const consoleErrors: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    consoleErrors.push(String((args[0] as Error)?.message ?? args[0]))
  })

  registerRichText(editor)
  editor.update(
    () => {
      $getRoot().clear().append($createParagraphNode())
      $getRoot().selectEnd()
    },
    { discrete: true }
  )

  let threw = 'none'
  try {
    editor.update(
      () => {
        // biome-ignore lint/suspicious/noExplicitAny: stub data transfer
        $insertDataTransferForRichText(stubDataTransfer(data) as any, $getSelection()!, editor)
      },
      { discrete: true }
    )
  } catch (error) {
    threw = (error as Error).message
  }
  spy.mockRestore()

  const out = snapshot(editor)
  editor.dispose()
  return { ...out, threw, consoleErrors }
}

/** Paste HTML the way a real paste does: through insertion, not parsing. */
function viaClipboardHtml(removals: string[] | undefined, html: string) {
  return pasteClipboard(removals, { 'text/html': html, 'text/plain': '' })
}

const block = (type: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
  children,
  direction: null,
  format: '',
  indent: 0,
  type,
  version: 1,
  ...extra,
})

describe('clipboard and storage reach equivalent outcomes', () => {
  // Every structure the specification lists as convertible, compared
  // across both routes. Both go through real insertion — inspecting
  // imported nodes before insertion would not evidence what a paste
  // actually leaves in the document.
  const cases: Array<{
    name: string
    saved: SerializedEditorState
    html: string
    /**
     * The ordered block structure BOTH routes must produce. Pinned
     * explicitly rather than compared route-to-route as sets: a set
     * comparison treats one paragraph and three as equal, which is
     * exactly the boundary loss this work fixed — two adjacent headings
     * merging into a single paragraph would pass unnoticed.
     */
    expectedTypes: string[]
    expectedText: string
  }> = [
    {
      name: 'heading',
      saved: doc(block('heading', [text('Title')], { tag: 'h1' })),
      html: '<h1>Title</h1>',
      expectedTypes: ['paragraph'],
      expectedText: 'Title',
    },
    {
      name: 'quote',
      saved: doc(block('quote', [text('Quoted words')])),
      html: '<blockquote>Quoted words</blockquote>',
      expectedTypes: ['paragraph'],
      expectedText: 'Quoted words',
    },
    {
      name: 'code block',
      saved: doc(block('code', [text('const x = 1')], { language: 'js' })),
      html: '<pre>const x = 1</pre>',
      expectedTypes: ['paragraph'],
      expectedText: 'const x = 1',
    },
    {
      name: 'bullet list',
      saved: doc(
        block(
          'list',
          [
            block('listitem', [text('item one')], { value: 1 }),
            block('listitem', [text('item two')], { value: 2 }),
          ],
          { listType: 'bullet', start: 1, tag: 'ul' }
        )
      ),
      html: '<ul><li>item one</li><li>item two</li></ul>',
      // TWO paragraphs, not one: each item keeps its own boundary.
      expectedTypes: ['paragraph', 'paragraph'],
      expectedText: 'item one\n\nitem two',
    },
    {
      name: 'table',
      saved: doc(
        block(
          'table',
          [
            block('tablerow', [
              block('tablecell', [block('paragraph', [text('cell text')])], {
                colSpan: 1,
                rowSpan: 1,
                headerState: 0,
              }),
            ]),
          ],
          {}
        )
      ),
      html: '<table><tr><td>cell text</td></tr></table>',
      expectedTypes: ['paragraph'],
      expectedText: 'cell text',
    },
  ]

  for (const { name, saved, html, expectedTypes, expectedText } of cases) {
    it(`degrades a ${name} equivalently by either route`, () => {
      const storage = viaStorage(undefined, saved)
      const clipboard = viaClipboardHtml(undefined, html)

      expect(clipboard.threw).toBe('none')
      // Ordered structure, pinned — block count and order both matter.
      expect(storage.types, `${name} via storage`).toEqual(expectedTypes)
      expect(clipboard.types, `${name} via clipboard`).toEqual(expectedTypes)
      expect(storage.text, `${name} via storage`).toBe(expectedText)
      expect(clipboard.text, `${name} via clipboard`).toBe(expectedText)
    })
  }

  it('drops a horizontal rule on both routes and keeps its neighbours', () => {
    const storage = viaStorage(
      undefined,
      doc(
        block('paragraph', [text('before')]),
        { type: 'horizontalrule', version: 1 },
        block('paragraph', [text('after')])
      )
    )
    const clipboard = viaClipboardHtml(undefined, '<p>before</p><hr /><p>after</p>')

    // Exactly the two neighbours, in order — the rule is gone and took
    // nothing with it.
    expect(storage.types).toEqual(['paragraph', 'paragraph'])
    expect(clipboard.types).toEqual(['paragraph', 'paragraph'])
    expect(storage.text).toBe('before\n\nafter')
    expect(clipboard.text).toBe('before\n\nafter')
  })

  it('preserves the link URL on the storage route only, by design', () => {
    const link = block('link', [text('link text')], {
      version: 2,
      attributes: { url: 'https://example.test/a' },
    })
    const storage = viaStorage([builtInExtensions.Link], doc(block('paragraph', [link])))
    const clipboard = viaClipboardHtml(
      [builtInExtensions.Link],
      '<p><a href="https://example.test/a">link text</a></p>'
    )

    // Equivalent structure and text — NOT identical content.
    expect(storage.types).toEqual(['paragraph'])
    expect(clipboard.types).toEqual(['paragraph'])
    expect(storage.text).toContain('link text')
    expect(clipboard.text).toContain('link text')

    // The intended difference, asserted from both sides so it cannot
    // drift into either a "bug" or a silent regression.
    expect(storage.text).toContain('https://example.test/a')
    expect(clipboard.text).not.toContain('https://example.test/a')
  })

  it('preserves the admonition title on the storage route only', () => {
    const storage = viaStorage(
      [builtInExtensions.Admonition],
      doc(block('admonition', [block('paragraph', [text('body copy')])], { title: 'Note title' }))
    )
    const clipboard = viaClipboardHtml(
      [builtInExtensions.Admonition],
      '<div data-type="note" data-title="Note title" class="admonition"><p>body copy</p></div>'
    )

    expect(clipboard.threw).toBe('none')
    // Both keep the body...
    expect(storage.text).toContain('body copy')
    expect(clipboard.text).toContain('body copy')

    // ...and only storage keeps the title, as its own leading line.
    expect(storage.text).toContain('Note title')
    expect(storage.text.indexOf('Note title')).toBeLessThan(storage.text.indexOf('body copy'))
    expect(clipboard.text).not.toContain('Note title')
  })
})

describe('Lexical-to-Lexical paste', () => {
  const headingPayload = JSON.stringify({
    namespace: NAMESPACE,
    nodes: [
      {
        children: [text('Copied title')],
        direction: null,
        format: '',
        indent: 0,
        type: 'heading',
        version: 1,
        tag: 'h1',
      },
    ],
  })

  it('falls through to the HTML handler and degrades', () => {
    // application/x-lexical-editor is tried FIRST (priority 0, ahead of
    // text/html at 10) and does not use importDOM at all — it calls the
    // same $parseSerializedNode that throws on an unregistered type.
    // Byline gives every field the same namespace, so a copy between two
    // Byline fields takes this branch.
    const result = pasteClipboard(undefined, {
      'application/x-lexical-editor': headingPayload,
      'text/html': '<h1>Copied title</h1>',
      'text/plain': 'Copied title',
    })

    expect(result.threw).toBe('none')
    expect(result.types).toEqual(['paragraph'])
    expect(result.text).toContain('Copied title')
    // The fallthrough is internal, not a fault — assert it rather than
    // suppress it, so a future Lexical change that makes it fatal is
    // caught here.
    expect(result.consoleErrors.join(' ')).toContain('not found')
  })

  it('survives a clipboard with no text/html at all', () => {
    // A source application may offer only Lexical JSON and plain text.
    // The guarantee must not depend on HTML being present.
    const result = pasteClipboard(undefined, {
      'application/x-lexical-editor': headingPayload,
      'text/plain': 'Copied title',
    })

    expect(result.threw).toBe('none')
    expect(result.types).toEqual(['paragraph'])
    // Text preservation is the guarantee on this route; inline formatting
    // is not, because plain text carries none.
    expect(result.text).toContain('Copied title')
  })

  it('pastes plain text normally when that is all the clipboard holds', () => {
    const result = pasteClipboard(undefined, { 'text/plain': 'just words' })
    expect(result.threw).toBe('none')
    expect(result.text).toContain('just words')
  })
})
