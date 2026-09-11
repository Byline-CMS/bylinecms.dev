import { $convertFromMarkdownString, registerMarkdownShortcuts } from '@lexical/markdown'
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from 'lexical'
import { describe, expect, it } from 'vitest'

import { builtInExtensions } from '../config/built-in-extension-names'
import { ADMONITION_BODY_TRANSFORMERS, BYLINE_TRANSFORMERS } from '../markdown/transformers'
import { buildFullEditor, buildRestrictedEditor } from '../test-support/build-test-editor'
import { transformersFor } from './filter-transformers'

/** Block types and full text of the editor's current state. */
function snapshot(editor: LexicalEditor): { types: string[]; text: string } {
  let types: string[] = []
  let text = ''
  editor.read(() => {
    types = $getRoot()
      .getChildren()
      .map((node) => node.getType())
    text = $getRoot().getTextContent()
  })
  return { types, text }
}

function importMarkdown(editor: LexicalEditor, markdown: string): void {
  editor.update(
    () => {
      $convertFromMarkdownString(
        markdown,
        transformersFor(editor, BYLINE_TRANSFORMERS),
        undefined,
        true
      )
    },
    { discrete: true }
  )
}

describe('Markdown import produces no disabled structures', () => {
  it('keeps heading text as a paragraph when headings are removed', () => {
    const editor = buildRestrictedEditor([builtInExtensions.Heading])
    importMarkdown(editor, '# Heading text\n\nBody text')
    const result = snapshot(editor)
    expect(result.types).not.toContain('heading')
    expect(result.text).toContain('Heading text')
    expect(result.text).toContain('Body text')
    editor.dispose()
  })

  it('still produces headings with the default configuration', () => {
    const editor = buildFullEditor()
    importMarkdown(editor, '# Heading text')
    expect(snapshot(editor).types).toContain('heading')
    editor.dispose()
  })

  it('keeps table cell text as paragraphs when tables are removed', () => {
    const editor = buildRestrictedEditor([builtInExtensions.Table])
    importMarkdown(editor, '| a | b |\n| - | - |\n| one | two |')
    const result = snapshot(editor)
    expect(result.types).not.toContain('table')
    expect(result.text).toContain('one')
    expect(result.text).toContain('two')
    editor.dispose()
  })

  it('keeps list item text when lists are removed', () => {
    const editor = buildRestrictedEditor([builtInExtensions.List, builtInExtensions.CheckList])
    importMarkdown(editor, '- item one\n- item two')
    const result = snapshot(editor)
    expect(result.types).not.toContain('list')
    expect(result.text).toContain('item one')
    expect(result.text).toContain('item two')
    editor.dispose()
  })

  it('keeps link text when links are removed', () => {
    const editor = buildRestrictedEditor([builtInExtensions.Link])
    importMarkdown(editor, 'see [link text](https://example.com) here')
    const result = snapshot(editor)
    expect(JSON.stringify(editor.getEditorState().toJSON())).not.toContain('"type":"link"')
    expect(result.text).toContain('link text')
    editor.dispose()
  })
})

describe('nested Markdown imports follow the same rule', () => {
  it('imports a table cell with headings and links removed', () => {
    // Tables are KEPT here: the point is that the cell's own nested
    // $convertFromMarkdownString must be filtered too, so the table
    // survives while the unsupported link inside it degrades.
    const editor = buildRestrictedEditor([builtInExtensions.Heading, builtInExtensions.Link])
    expect(() => {
      importMarkdown(editor, '| a | b |\n| - | - |\n| [link text](https://e.com) | plain |')
    }).not.toThrow()
    const result = snapshot(editor)
    const json = JSON.stringify(editor.getEditorState().toJSON())

    expect(result.types).toContain('table')
    expect(json).not.toContain('"type":"link"')
    // The degraded cell keeps its text, not just its untouched neighbour.
    expect(result.text).toContain('link text')
    expect(result.text).toContain('plain')
    editor.dispose()
  })

  it('imports an admonition body with links removed', () => {
    // ADMONITION_BODY_TRANSFORMERS carries LINK, so this is the case that
    // breaks without filtering.
    //
    // The directive syntax is `:::type[Title]` — the start regex is
    // /^:::(note|tip|warning|danger)(?:\[([^\]]*)\])?\s*$/, so
    // `:::note Title` silently fails to match and no admonition is ever
    // created. Assert the node exists so this fixture cannot rot back
    // into testing nothing.
    const editor = buildRestrictedEditor([builtInExtensions.Link])
    const active = transformersFor(editor, ADMONITION_BODY_TRANSFORMERS)
    expect(active.length).toBeLessThan(ADMONITION_BODY_TRANSFORMERS.length)

    expect(() => {
      importMarkdown(editor, ':::note[Note title]\nbody with [a link](https://e.com)\n:::')
    }).not.toThrow()

    const result = snapshot(editor)
    const json = JSON.stringify(editor.getEditorState().toJSON())
    expect(result.types).toContain('admonition')
    expect(json).not.toContain('"type":"link"')
    expect(result.text).toContain('body with')
    expect(result.text).toContain('a link')
    editor.dispose()
  })
})

/** Type `input` at the caret, the way the shortcut listener sees it. */
function typeText(editor: LexicalEditor, input: string): void {
  editor.update(
    () => {
      $getRoot().clear().append($createParagraphNode())
      $getRoot().selectEnd()
    },
    { discrete: true }
  )
  for (const char of input) {
    editor.update(
      () => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) selection.insertText(char)
      },
      { discrete: true }
    )
  }
}

describe('keyboard Markdown shortcuts', () => {
  it('POSITIVE CONTROL: "# " creates a heading in the default editor', () => {
    // Without this the negative case below could pass simply because the
    // typing simulation never triggers a shortcut at all.
    const editor = buildFullEditor()
    registerMarkdownShortcuts(editor, transformersFor(editor, BYLINE_TRANSFORMERS))
    typeText(editor, '# Title')
    expect(snapshot(editor).types).toEqual(['heading'])
    editor.dispose()
  })

  it('"# " creates no heading when headings are removed, and keeps the text', () => {
    const editor = buildRestrictedEditor([builtInExtensions.Heading])
    registerMarkdownShortcuts(editor, transformersFor(editor, BYLINE_TRANSFORMERS))
    typeText(editor, '# Title')
    const result = snapshot(editor)
    expect(result.types).toEqual(['paragraph'])
    expect(result.text).toContain('Title')
    editor.dispose()
  })

  it('"- " creates no list when lists are removed', () => {
    const editor = buildRestrictedEditor([builtInExtensions.List, builtInExtensions.CheckList])
    registerMarkdownShortcuts(editor, transformersFor(editor, BYLINE_TRANSFORMERS))
    typeText(editor, '- item')
    const result = snapshot(editor)
    expect(result.types).toEqual(['paragraph'])
    expect(result.text).toContain('item')
    editor.dispose()
  })
})
