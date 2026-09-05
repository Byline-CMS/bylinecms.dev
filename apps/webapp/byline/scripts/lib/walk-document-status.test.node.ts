import { describe, expect, it, vi } from 'vitest'

import { walkToStatus } from './walk-document-status.js'

const statuses = [{ name: 'draft' }, { name: 'review' }, { name: 'published' }]

describe('import workflow revision propagation', () => {
  it('uses each committed revision and returns the final observation for tree placement', async () => {
    const changeStatus = vi.fn(
      async (_id: string, status: string, options: { expectedRevision: number }) => ({
        documentId: 'doc',
        revision: options.expectedRevision + 1,
        previousStatus: 'draft',
        newStatus: status,
      })
    )
    expect(await walkToStatus({ changeStatus }, 'doc', statuses, 'draft', 'published', 4)).toBe(6)
    expect(changeStatus.mock.calls).toEqual([
      ['doc', 'review', { expectedRevision: 4 }],
      ['doc', 'published', { expectedRevision: 5 }],
    ])
  })
  it('preserves the observation when no transition is needed', async () => {
    const changeStatus = vi.fn()
    expect(await walkToStatus({ changeStatus }, 'doc', statuses, 'published', 'published', 6)).toBe(
      6
    )
    expect(changeStatus).not.toHaveBeenCalled()
  })
  it('stops on conflict without retrying or returning a replacement observation', async () => {
    const error = new Error('stale')
    const changeStatus = vi.fn().mockRejectedValue(error)
    await expect(
      walkToStatus({ changeStatus }, 'doc', statuses, 'draft', 'published', 4)
    ).rejects.toBe(error)
    expect(changeStatus).toHaveBeenCalledTimes(1)
  })
})
