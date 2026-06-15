/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { WorkflowStatus } from '@byline/core'
import { describe, expect, it } from 'vitest'

import { computeStatusTransitions } from './status-transitions'

const draft: WorkflowStatus = { name: 'draft', label: 'Draft' }
const review: WorkflowStatus = { name: 'review', label: 'Review' }
const published: WorkflowStatus = { name: 'published', label: 'Published' }
const flow = [draft, review, published]

describe('computeStatusTransitions', () => {
  it('falls back to nextStatus when there is no workflow or no current status', () => {
    expect(computeStatusTransitions(undefined, undefined, published)).toEqual({
      primaryStatus: published,
      secondaryStatuses: [],
      isTerminal: false,
    })
    expect(computeStatusTransitions('draft', [], published)).toEqual({
      primaryStatus: published,
      secondaryStatuses: [],
      isTerminal: false,
    })
    expect(computeStatusTransitions(undefined, flow, published)).toEqual({
      primaryStatus: published,
      secondaryStatuses: [],
      isTerminal: false,
    })
  })

  it('exposes no transitions for a single-status workflow', () => {
    expect(computeStatusTransitions('draft', [draft], undefined)).toEqual({
      primaryStatus: undefined,
      secondaryStatuses: [],
      isTerminal: false,
    })
  })

  it('falls back to nextStatus when the current status is not in the workflow', () => {
    expect(computeStatusTransitions('archived', flow, review)).toEqual({
      primaryStatus: review,
      secondaryStatuses: [],
      isTerminal: false,
    })
  })

  it('at the first step: primary is the forward step, no back-steps', () => {
    const result = computeStatusTransitions('draft', flow, review)
    expect(result.primaryStatus).toBe(review)
    expect(result.isTerminal).toBe(false)
    // Forward step is the primary, so it is filtered out of the dropdown.
    expect(result.secondaryStatuses).toEqual([])
  })

  it('in the middle: primary is forward, dropdown offers reset-to-first', () => {
    const result = computeStatusTransitions('review', flow, published)
    expect(result.primaryStatus).toBe(published)
    expect(result.isTerminal).toBe(false)
    // Reset-to-first (draft) is surfaced; the forward step (published) is the
    // primary and filtered out. The "back one step" is draft itself here, so
    // it is not duplicated.
    expect(result.secondaryStatuses).toEqual([draft])
  })

  it('at the terminal step: primary is the current status, back-steps in dropdown', () => {
    const result = computeStatusTransitions('published', flow, undefined)
    expect(result.primaryStatus).toBe(published)
    expect(result.isTerminal).toBe(true)
    // Both reset-to-first (draft) and back-one-step (review) are offered.
    expect(result.secondaryStatuses).toEqual([draft, review])
  })

  it('terminal back-one-step is omitted when the previous is already the first', () => {
    const twoStep = [draft, published]
    const result = computeStatusTransitions('published', twoStep, undefined)
    expect(result.isTerminal).toBe(true)
    // Only reset-to-first (draft); no separate back-one-step since prev === first.
    expect(result.secondaryStatuses).toEqual([draft])
  })
})
