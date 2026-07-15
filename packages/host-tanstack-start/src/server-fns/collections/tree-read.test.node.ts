import { describe, expect, it, vi } from 'vitest'

import { getAdminTreeParent, getAdminUnplacedTreeDocuments } from './tree-read.js'

describe('getAdminTreeParent', () => {
  it('explicitly selects status:any', async () => {
    const getTreeParent = vi.fn().mockResolvedValue({
      placed: false,
      parentDocumentId: null,
      parentVisibility: 'none',
    })

    await getAdminTreeParent({ getTreeParent } as any, 'doc-1')

    expect(getTreeParent).toHaveBeenCalledWith('doc-1', { status: 'any' })
  })
})

describe('getAdminUnplacedTreeDocuments', () => {
  it('uses scoped any-mode reads so hidden unplaced nodes cannot reappear', async () => {
    const visible = { id: 'visible-unplaced' }
    const hidden = { id: 'hidden-unplaced' }
    const find = vi.fn(async (options: Record<string, unknown>) => ({
      docs: options._bypassBeforeRead === true ? [visible, hidden] : [visible],
      meta: { total: 1, page: 1, pageSize: 1000, totalPages: 1 },
    }))

    const result = await getAdminUnplacedTreeDocuments(
      { find } as any,
      new Set(['visible-placed']),
      'en'
    )

    expect(find).toHaveBeenCalledWith({
      status: 'any',
      locale: 'en',
      pageSize: 1000,
    })
    expect(result.map((doc) => doc.id)).toEqual(['visible-unplaced'])
    expect(result).not.toContain(hidden)
  })
})
