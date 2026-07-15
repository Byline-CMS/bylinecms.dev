import type { CollectionHandle } from '@byline/client'
import { describe, expect, it, vi } from 'vitest'

import { resolveDocTreeBySplat } from './resolve.server.js'

const doc = {
  id: 'leaf',
  versionId: 'v1',
  path: 'leaf',
  status: 'published',
  createdAt: new Date(),
  updatedAt: new Date(),
  fields: { title: 'Leaf' },
}

describe('resolveDocTreeBySplat reachability', () => {
  it('rejects a redacted hidden parent as a broken public spine', async () => {
    const handle = {
      findByPath: vi.fn().mockResolvedValue(doc),
      getAncestors: vi.fn().mockResolvedValue([]),
      getTreeParent: vi.fn().mockResolvedValue({
        placed: true,
        parentDocumentId: null,
        parentVisibility: 'redacted',
      }),
    } as unknown as CollectionHandle

    await expect(
      resolveDocTreeBySplat(handle, {
        splat: 'leaf',
        locale: 'en',
        status: 'published',
        enforceSpine: true,
      })
    ).resolves.toBeNull()
    expect(handle.getTreeParent).toHaveBeenCalledWith('leaf', {
      status: 'published',
      locale: 'en',
    })
  })

  it('accepts an actual visible root', async () => {
    const handle = {
      findByPath: vi.fn().mockResolvedValue(doc),
      getAncestors: vi.fn().mockResolvedValue([]),
      getTreeParent: vi.fn().mockResolvedValue({
        placed: true,
        parentDocumentId: null,
        parentVisibility: 'none',
      }),
    } as unknown as CollectionHandle

    await expect(
      resolveDocTreeBySplat(handle, {
        splat: 'leaf',
        locale: 'en',
        status: 'published',
        enforceSpine: true,
      })
    ).resolves.toMatchObject({ chainSegments: ['leaf'] })
  })
})
