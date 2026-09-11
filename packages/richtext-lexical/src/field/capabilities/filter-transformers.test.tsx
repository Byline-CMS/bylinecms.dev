import { $convertFromMarkdownString, registerMarkdownShortcuts } from '@lexical/markdown'
import { $getRoot } from 'lexical'
import { describe, expect, it } from 'vitest'

import { ADMONITION_BODY_TRANSFORMERS, BYLINE_TRANSFORMERS } from '../markdown/transformers'
import { buildFullEditor, buildRestrictedEditor } from '../test-support/build-test-editor'
import { transformersFor } from './filter-transformers'

describe('transformersFor', () => {
  it('lets Markdown shortcuts register in a restricted editor', () => {
    const editor = buildRestrictedEditor()
    expect(() => {
      registerMarkdownShortcuts(editor, transformersFor(editor, BYLINE_TRANSFORMERS))
    }).not.toThrow()
    editor.dispose()
  })

  it('throws without the filter, which is why it exists', () => {
    const editor = buildRestrictedEditor()
    expect(() => {
      registerMarkdownShortcuts(editor, [...BYLINE_TRANSFORMERS])
    }).toThrow(/missing dependency/)
    editor.dispose()
  })

  it('keeps every transformer when nothing is removed', () => {
    const editor = buildFullEditor()
    expect(transformersFor(editor, BYLINE_TRANSFORMERS)).toHaveLength(BYLINE_TRANSFORMERS.length)
    editor.dispose()
  })

  it('drops a transformer whose node is unregistered', () => {
    const editor = buildRestrictedEditor()
    expect(transformersFor(editor, BYLINE_TRANSFORMERS).length).toBeLessThan(
      BYLINE_TRANSFORMERS.length
    )
    editor.dispose()
  })

  it('survives a Markdown import in a restricted editor', () => {
    const editor = buildRestrictedEditor()
    const active = transformersFor(editor, BYLINE_TRANSFORMERS)
    expect(() => {
      editor.update(
        () => {
          $convertFromMarkdownString(
            '# heading\n\n| a | b |\n| - | - |\n\nplain text',
            active,
            undefined,
            true
          )
        },
        { discrete: true }
      )
    }).not.toThrow()
    let text = ''
    editor.read(() => {
      text = $getRoot().getTextContent()
    })
    expect(text).toContain('plain text')
    editor.dispose()
  })

  it('filters the admonition body list, which carries LINK', () => {
    const editor = buildRestrictedEditor()
    expect(transformersFor(editor, ADMONITION_BODY_TRANSFORMERS).length).toBeLessThan(
      ADMONITION_BODY_TRANSFORMERS.length
    )
    editor.dispose()
  })
})
