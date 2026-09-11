import { describe, expect, it } from 'vitest'

import { supportsNodeType } from '../capabilities/registered-node-types'
import {
  buildFullEditor,
  buildRestrictedEditor,
  parseHtmlToTypes,
} from '../test-support/build-test-editor'
import { builtInExtensions } from './built-in-extension-names'

describe('list removal', () => {
  it('exposes the upstream list names so a site need not import @lexical/list', () => {
    expect(builtInExtensions.List).toBe('@lexical/list/List')
    expect(builtInExtensions.CheckList).toBe('@lexical/list/CheckList')
  })

  it('degrades bullet and check lists to paragraphs', () => {
    const editor = buildRestrictedEditor([builtInExtensions.List, builtInExtensions.CheckList])
    expect(supportsNodeType(editor, 'list')).toBe(false)
    expect(supportsNodeType(editor, 'listitem')).toBe(false)

    const bullet = parseHtmlToTypes(editor, '<ul><li>item one</li><li>item two</li></ul>')
    expect(bullet.types).toEqual(['paragraph', 'paragraph'])
    expect(bullet.text).toContain('item one')
    expect(bullet.text).toContain('item two')
    editor.dispose()
  })

  it('keeps bullet lists when only the check-list extension is removed', () => {
    // CheckListExtension contributes behaviour, not nodes — ListExtension
    // owns both node classes, so removing the check list must not take
    // ordinary lists with it.
    const editor = buildRestrictedEditor([builtInExtensions.CheckList])
    expect(supportsNodeType(editor, 'list')).toBe(true)
    expect(parseHtmlToTypes(editor, '<ul><li>one</li></ul>').types).toEqual(['list'])
    editor.dispose()
  })

  it('still imports lists with the default configuration', () => {
    const editor = buildFullEditor()
    expect(parseHtmlToTypes(editor, '<ul><li>one</li></ul>').types).toEqual(['list'])
    editor.dispose()
  })
})
