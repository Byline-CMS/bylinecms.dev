import { describe, expect, it, vi } from 'vitest'

import { retryDeadlock } from '../src/modules/admin/retry-deadlock.js'

describe('sign-in deadlock retry', () => {
  it('retries the whole rolled-back operation, including wrapped driver errors', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ cause: { errno: 1213, sqlState: '40001' } })
      .mockResolvedValue(true)
    expect(await retryDeadlock(operation)).toBe(true)
    expect(operation).toHaveBeenCalledTimes(2)
  })
  it('bounds retries', async () => {
    const error = { errno: 1213 }
    const operation = vi.fn().mockRejectedValue(error)
    await expect(retryDeadlock(operation)).rejects.toBe(error)
    expect(operation).toHaveBeenCalledTimes(3)
  })
  it.each([{ code: 'ECONNRESET' }, { errno: 1205 }, { sqlState: '40001' }])(
    'does not retry ambiguous or unclassified failures: %j',
    async (error) => {
      const operation = vi.fn().mockRejectedValue(error)
      await expect(retryDeadlock(operation)).rejects.toBe(error)
      expect(operation).toHaveBeenCalledTimes(1)
    }
  )
})
