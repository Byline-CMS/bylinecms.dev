import { ERR_CONFLICT, ERR_TREE_HOOK_COMMITTED } from '@byline/core'
import { describe, expect, it } from 'vitest'

import { bylineCodedErrorAdapter } from './start-errors.js'

describe('Byline coded error serialization', () => {
  it.each([
    ERR_CONFLICT({ message: 'stale tree' }),
    ERR_TREE_HOOK_COMMITTED({ message: 'tree committed; hook failed' }),
  ])('preserves core BylineError code $code', (error) => {
    expect(bylineCodedErrorAdapter.test(error)).toBe(true)

    const payload = bylineCodedErrorAdapter.toSerializable(error)
    const restored = bylineCodedErrorAdapter.fromSerializable(payload)

    expect(restored).toMatchObject({
      name: 'BylineError',
      code: error.code,
      message: error.message,
    })
  })
})
