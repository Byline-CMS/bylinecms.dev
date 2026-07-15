import { createReadContext } from '@byline/core'
import { describe, expect, it, vi } from 'vitest'

import { type LexicalNodeVisitor, runLexicalPopulate } from './lexical-populate-shared.js'

describe('runLexicalPopulate secure reader', () => {
  it('uses the framework reader instead of direct adapter access', async () => {
    const apply = vi.fn()
    const visitor: LexicalNodeVisitor = {
      match: (node) =>
        node.type === 'target' ? { node, collectionPath: 'media', documentId: 'm1', apply } : null,
    }
    const readDocuments = vi
      .fn()
      .mockResolvedValue([
        { document_id: 'm1', path: 'asset', status: 'published', fields: { title: 'Asset' } },
      ])

    await runLexicalPopulate({
      readContext: createReadContext(),
      readDocuments,
      visitors: [visitor],
      values: [{ root: { type: 'root', children: [{ type: 'target' }] } }],
    })

    expect(readDocuments).toHaveBeenCalledWith({
      collectionPath: 'media',
      documentIds: ['m1'],
    })
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm1', fields: { title: 'Asset' } })
    )
  })
})
