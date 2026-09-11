import { describe, expect, it } from 'vitest'

import { builtInExtensions } from '../../config/built-in-extension-names'
import {
  buildFullEditor,
  buildRestrictedEditor,
  parseHtmlToTypes,
} from '../../test-support/build-test-editor'

describe('heading and quote ownership', () => {
  it('imports headings and quotes when both extensions are present', () => {
    const editor = buildFullEditor()
    expect(parseHtmlToTypes(editor, '<h1>Title</h1>').types).toEqual(['heading'])
    expect(parseHtmlToTypes(editor, '<blockquote>Quoted</blockquote>').types).toEqual(['quote'])
    editor.dispose()
  })

  it('degrades a pasted heading to a paragraph and keeps the text', () => {
    const editor = buildRestrictedEditor([builtInExtensions.Heading])
    const result = parseHtmlToTypes(editor, '<h1>Pasted title</h1>')
    expect(result.types).toEqual(['paragraph'])
    expect(result.text).toBe('Pasted title')
    editor.dispose()
  })

  it('keeps headings while quotes are removed', () => {
    const editor = buildRestrictedEditor([builtInExtensions.Quote])
    expect(parseHtmlToTypes(editor, '<h1>Title</h1>').types).toEqual(['heading'])
    expect(parseHtmlToTypes(editor, '<blockquote>Quoted</blockquote>').types).toEqual(['paragraph'])
    editor.dispose()
  })
})
