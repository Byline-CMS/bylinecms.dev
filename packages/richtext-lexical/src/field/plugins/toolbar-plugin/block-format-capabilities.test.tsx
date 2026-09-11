import { describe, expect, it } from 'vitest'

import { builtInExtensions } from '../../config/built-in-extension-names'
import { buildFullEditor, buildRestrictedEditor } from '../../test-support/build-test-editor'
import { availableBlockFormats } from './index'

describe('availableBlockFormats', () => {
  it('offers every format when the full set is present', () => {
    const editor = buildFullEditor()
    const formats = availableBlockFormats(editor, true)
    for (const format of ['h1', 'h2', 'h3', 'h4', 'bullet', 'number', 'check', 'quote', 'code']) {
      expect(formats, format).toContain(format)
    }
    editor.dispose()
  })

  it('offers only paragraph when everything structural is removed', () => {
    const editor = buildRestrictedEditor()
    expect(availableBlockFormats(editor, false)).toEqual(['paragraph'])
    editor.dispose()
  })

  it('drops heading entries when the heading extension is removed', () => {
    const editor = buildRestrictedEditor([builtInExtensions.Heading])
    const formats = availableBlockFormats(editor, true)
    expect(formats).not.toContain('h1')
    expect(formats).toContain('quote')
    editor.dispose()
  })

  it('drops the quote entry when the quote extension is removed', () => {
    const editor = buildRestrictedEditor([builtInExtensions.Quote])
    const formats = availableBlockFormats(editor, true)
    expect(formats).not.toContain('quote')
    expect(formats).toContain('h1')
    editor.dispose()
  })

  it('offers bullets but not check lists when only CheckListExtension is removed', () => {
    // The list NODES are still registered — ListExtension owns them — so a
    // node-only rule would keep offering a control whose behaviour is gone.
    const editor = buildRestrictedEditor([builtInExtensions.CheckList])
    const formats = availableBlockFormats(editor, false)
    expect(formats).toContain('bullet')
    expect(formats).toContain('number')
    expect(formats).not.toContain('check')
    editor.dispose()
  })

  it('never offers a format whose node the editor cannot create', () => {
    const editor = buildRestrictedEditor()
    for (const format of availableBlockFormats(editor, true)) {
      expect(format).toBe('paragraph')
    }
    editor.dispose()
  })
})
