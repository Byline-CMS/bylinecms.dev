import { describe, expect, it } from 'vitest'

import { buildFullEditor, buildRestrictedEditor, parseHtmlToTypes } from './build-test-editor'

describe('test harness', () => {
  it('builds the full default extension set', () => {
    const editor = buildFullEditor()
    expect(parseHtmlToTypes(editor, '<p>hello</p>').types).toEqual(['paragraph'])
    editor.dispose()
  })

  it('builds a restricted editor', () => {
    const editor = buildRestrictedEditor()
    expect(parseHtmlToTypes(editor, '<p>hello</p>').types).toEqual(['paragraph'])
    editor.dispose()
  })
})
