/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { exclusionState } from './outcomes.js'
import type { ProjectionOutcome } from '../@types/extraction-types.js'

const written: ProjectionOutcome = { kind: 'written' }
const pending = (reason: 'write-failed' | 'not-attempted' | 'stale-write'): ProjectionOutcome => ({
  kind: 'pending',
  reason,
})

describe('exclusionState', () => {
  it.each([
    ['written', written],
    ['pending', pending('write-failed')],
    ['not attempted', undefined],
  ])('is not-required when no update was required and projection is %s', (_label, projection) => {
    expect(exclusionState({ kind: 'not-required' }, projection)).toEqual({ state: 'not-required' })
  })

  it('reports pending when the eligibility mark failed and the search write succeeded', () => {
    // The regression this rule exists for: the join still includes the old text, so
    // a successful write leaves it searchable.
    expect(exclusionState({ kind: 'failed' }, written)).toEqual({
      state: 'pending',
      reason: 'eligibility-update-failed',
    })
  })

  it.each([
    ['pending', pending('write-failed')],
    ['not attempted', undefined],
  ])('reports pending when the mark failed and projection is %s', (_label, projection) => {
    expect(exclusionState({ kind: 'failed' }, projection)).toEqual({
      state: 'pending',
      reason: 'eligibility-update-failed',
    })
  })

  it('reports excluded when the mark was recorded and the write acknowledged', () => {
    expect(exclusionState({ kind: 'recorded' }, written)).toEqual({ state: 'excluded' })
  })

  it.each(['write-failed', 'not-attempted', 'stale-write'] as const)(
    'carries the %s reason when the mark was recorded',
    (reason) => {
      expect(exclusionState({ kind: 'recorded' }, pending(reason))).toEqual({
        state: 'pending',
        reason,
      })
    }
  )

  it('reports not-attempted when the mark was recorded and no write followed', () => {
    expect(exclusionState({ kind: 'recorded' }, undefined)).toEqual({
      state: 'pending',
      reason: 'not-attempted',
    })
  })
})
