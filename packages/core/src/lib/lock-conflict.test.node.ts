import { describe, expect, it } from 'vitest'

import { ERR_LOCK_CONFLICT, getLockConflictDetails } from './errors.js'

describe('confirmed lock conflict transport', () => {
  it('preserves the contract through reports and message-only Error reconstruction', () => {
    const cause = Object.assign(new Error('secret driver SQL'), { code: '40P01' })
    const error = ERR_LOCK_CONFLICT({ cause, message: cause.message })
    expect(error.cause).toBe(cause)
    for (const transported of [
      error,
      JSON.parse(JSON.stringify(error.report())),
      new Error(error.message),
    ]) {
      expect(getLockConflictDetails(transported)).toEqual({
        reason: 'lock_conflict',
        rolledBack: true,
        retryable: true,
      })
    }
    expect(JSON.stringify(error.report())).not.toContain('secret driver SQL')
  })
  it('rejects stale state, driver failures, and incomplete rollback claims', () => {
    for (const error of [
      null,
      { code: 'ERR_DOCUMENT_STALE' },
      { code: '40P01' },
      { code: 'ERR_LOCK_CONFLICT' },
      { code: 'ERR_LOCK_CONFLICT', details: { rolledBack: false } },
    ])
      expect(getLockConflictDetails(error)).toBeNull()
  })
})
