import { describe, expect, it, vi } from 'vitest'

import { deletePendingUploadsUnderPath } from './pending-uploads'

describe('deletePendingUploadsUnderPath', () => {
  it('removes and revokes only uploads beneath the removed item', () => {
    const uploads = new Map([
      ['content[id=a].image', { previewUrl: 'blob:a' }],
      ['content[id=b].image', { previewUrl: 'blob:b' }],
      ['content[id=b].gallery[id=x].image', { previewUrl: 'blob:nested' }],
    ])
    const revoke = vi.fn()

    expect(deletePendingUploadsUnderPath(uploads, 'content[id=b]', revoke)).toBe(true)
    expect([...uploads.keys()]).toEqual(['content[id=a].image'])
    expect(revoke.mock.calls).toEqual([['blob:b'], ['blob:nested']])
  })

  it('reports when no pending upload matched', () => {
    const uploads = new Map([['content[id=a].image', { previewUrl: 'blob:a' }]])
    expect(deletePendingUploadsUnderPath(uploads, 'content[id=b]', vi.fn())).toBe(false)
  })
})
