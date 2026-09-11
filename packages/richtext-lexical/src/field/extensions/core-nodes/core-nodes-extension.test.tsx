import { describe, expect, it } from 'vitest'

import { supportsNodeType } from '../../capabilities/registered-node-types'
import { buildRestrictedEditor } from '../../test-support/build-test-editor'

describe('CoreNodesExtension', () => {
  it('keeps mark and overflow registered even in a fully stripped editor', () => {
    const editor = buildRestrictedEditor()
    expect(supportsNodeType(editor, 'mark')).toBe(true)
    expect(supportsNodeType(editor, 'overflow')).toBe(true)
    editor.dispose()
  })
})
