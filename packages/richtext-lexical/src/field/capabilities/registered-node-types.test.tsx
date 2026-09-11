import { HeadingNode } from '@lexical/rich-text'
import { describe, expect, it } from 'vitest'

import { buildFullEditor, buildRestrictedEditor } from '../test-support/build-test-editor'
import { registeredNodeTypes, supportsNodeType } from './registered-node-types'

describe('registeredNodeTypes', () => {
  it('always reports the core types', () => {
    const editor = buildRestrictedEditor()
    const types = registeredNodeTypes(editor)
    expect(types.has('root')).toBe(true)
    expect(types.has('paragraph')).toBe(true)
    expect(types.has('text')).toBe(true)
    editor.dispose()
  })

  it('agrees with hasNode for a class the editor registers', () => {
    const editor = buildFullEditor()
    expect(editor.hasNode(HeadingNode)).toBe(supportsNodeType(editor, 'heading'))
    editor.dispose()
  })

  it('reports a type as unsupported once its extension is removed', () => {
    const editor = buildRestrictedEditor()
    expect(supportsNodeType(editor, 'table')).toBe(false)
    expect(supportsNodeType(editor, 'link')).toBe(false)
    editor.dispose()
  })
})
