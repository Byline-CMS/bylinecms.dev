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

describe('runLexicalPopulate failed refresh', () => {
  it('rejects without applying, so a stale snapshot is never returned as a live resolution', async () => {
    const node = { type: 'x', document: { title: 'Stale' } }
    const apply = vi.fn()
    const applyMissing = vi.fn()
    const visitor: LexicalNodeVisitor = {
      match: (candidate) =>
        candidate.type === 'x'
          ? { node: candidate, collectionPath: 'pages', documentId: 'doc-1', apply, applyMissing }
          : null,
    }

    await expect(
      runLexicalPopulate({
        readContext: createReadContext(),
        readDocuments: vi.fn().mockRejectedValue(new Error('database unavailable')),
        visitors: [visitor],
        values: [{ root: { type: 'root', children: [node] } }],
      })
    ).rejects.toThrow('database unavailable')
    expect(apply).not.toHaveBeenCalled()
    expect(applyMissing).not.toHaveBeenCalled()
  })
})
