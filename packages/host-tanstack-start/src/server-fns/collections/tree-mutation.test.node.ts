import { describe, expect, it, vi } from 'vitest'

import { placeAdminTreeNode, removeAdminTreeNode } from './tree-mutation.js'

describe('admin tree mutations', () => {
  it('opts ordinary placement retries into lifecycle reconciliation', async () => {
    const placeTreeNode = vi
      .fn()
      .mockRejectedValueOnce(new Error('post-commit hook failed'))
      .mockResolvedValue({ orderKey: 'key-1' })

    const retry = () =>
      placeAdminTreeNode({ placeTreeNode } as any, 'doc-1', {
        parentDocumentId: 'parent-1',
        beforeDocumentId: 'left-1',
      })

    await expect(retry()).rejects.toThrow('post-commit hook failed')
    await expect(retry()).resolves.toEqual({ orderKey: 'key-1' })

    expect(placeTreeNode).toHaveBeenCalledTimes(2)
    expect(placeTreeNode).toHaveBeenNthCalledWith(
      2,
      'doc-1',
      expect.objectContaining({ reconcile: true })
    )
  })

  it('opts ordinary removal retries into lifecycle reconciliation', async () => {
    const removeFromTree = vi.fn().mockResolvedValue(undefined)

    await removeAdminTreeNode({ removeFromTree } as any, 'doc-1')

    expect(removeFromTree).toHaveBeenCalledWith('doc-1', { reconcile: true })
  })

  it('preserves an explicit reconciliation override', async () => {
    const placeTreeNode = vi.fn().mockResolvedValue({ orderKey: 'key-1' })
    const removeFromTree = vi.fn().mockResolvedValue(undefined)

    await placeAdminTreeNode({ placeTreeNode } as any, 'doc-1', {
      parentDocumentId: null,
      reconcile: false,
    })
    await removeAdminTreeNode({ removeFromTree } as any, 'doc-1', { reconcile: false })

    expect(placeTreeNode).toHaveBeenCalledWith('doc-1', {
      parentDocumentId: null,
      reconcile: false,
    })
    expect(removeFromTree).toHaveBeenCalledWith('doc-1', { reconcile: false })
  })
})
