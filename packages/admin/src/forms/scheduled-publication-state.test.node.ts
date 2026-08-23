/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { deriveScheduledPublicationState } from './scheduled-publication-state.js'
import type { ScheduledPublicationInfo } from './scheduled-publication-state.js'

const NOW = Date.parse('2026-08-22T12:00:00.000Z')

const ALL_CAPABILITIES = { canSchedule: true, canConfirm: true, canCancel: true }
const NO_CAPABILITIES = { canSchedule: false, canConfirm: false, canCancel: false }

function schedule(overrides: Partial<ScheduledPublicationInfo> = {}): ScheduledPublicationInfo {
  return {
    publishAt: '2026-08-24T09:00:00.000Z',
    targetVersionId: '019f0000-0000-7000-8000-000000000001',
    state: 'armed',
    lastAuthorizedBy: '019e3daa-42dd-70bb-9be3-5f18b1594b0a',
    lastError: null,
    nextAttemptAt: '2026-08-24T09:00:00.000Z',
    attemptCount: 0,
    ...overrides,
  }
}

describe('deriveScheduledPublicationState', () => {
  describe('with no schedule', () => {
    it('offers only the schedule action', () => {
      const state = deriveScheduledPublicationState(null, ALL_CAPABILITIES, NOW)

      expect(state.kind).toBe('none')
      expect(state.isExceptional).toBe(false)
      expect(state.actions).toEqual({
        schedule: true,
        reschedule: false,
        confirm: false,
        cancel: false,
      })
    })

    it('offers nothing at all to an actor without the abilities', () => {
      const state = deriveScheduledPublicationState(null, NO_CAPABILITIES, NOW)

      expect(state.actions.schedule).toBe(false)
    })
  })

  describe('armed', () => {
    it('reads as a quiet, non-exceptional state', () => {
      const state = deriveScheduledPublicationState(schedule(), ALL_CAPABILITIES, NOW)

      expect(state.kind).toBe('armed')
      expect(state.tone).toBe('info')
      expect(state.isExceptional).toBe(false)
      expect(state.isPastDue).toBe(false)
      expect(state.publishAt?.toISOString()).toBe('2026-08-24T09:00:00.000Z')
    })

    it('offers reschedule and cancel but never confirm', () => {
      const state = deriveScheduledPublicationState(schedule(), ALL_CAPABILITIES, NOW)

      expect(state.actions).toEqual({
        schedule: false,
        reschedule: true,
        confirm: false,
        cancel: true,
      })
    })

    it('becomes overdue the instant the authorized time is reached', () => {
      const due = Date.parse('2026-08-24T09:00:00.000Z')

      expect(deriveScheduledPublicationState(schedule(), ALL_CAPABILITIES, due - 1).kind).toBe(
        'armed'
      )
      expect(deriveScheduledPublicationState(schedule(), ALL_CAPABILITIES, due).kind).toBe(
        'overdue'
      )
    })
  })

  describe('needs re-confirmation', () => {
    it('escalates and offers confirm alongside reschedule and cancel', () => {
      const state = deriveScheduledPublicationState(
        schedule({ state: 'needs_reconfirm' }),
        ALL_CAPABILITIES,
        NOW
      )

      expect(state.kind).toBe('needs_reconfirm')
      expect(state.tone).toBe('warning')
      expect(state.isExceptional).toBe(true)
      expect(state.actions).toEqual({
        schedule: false,
        reschedule: true,
        confirm: true,
        cancel: true,
      })
    })

    it('stays suspended rather than overdue once its instant has passed', () => {
      const state = deriveScheduledPublicationState(
        schedule({ state: 'needs_reconfirm' }),
        ALL_CAPABILITIES,
        Date.parse('2026-08-25T09:00:00.000Z')
      )

      // The reason it did not publish is the suspension, not the clock — but
      // the elapsed instant still has to be reportable to the editor.
      expect(state.kind).toBe('needs_reconfirm')
      expect(state.isPastDue).toBe(true)
    })

    it('withholds confirm from an actor who cannot confirm', () => {
      const state = deriveScheduledPublicationState(
        schedule({ state: 'needs_reconfirm' }),
        { canSchedule: false, canConfirm: false, canCancel: true },
        NOW
      )

      expect(state.actions.confirm).toBe(false)
      expect(state.actions.reschedule).toBe(false)
      expect(state.actions.cancel).toBe(true)
    })
  })

  describe('overdue', () => {
    const overdueNow = Date.parse('2026-08-24T09:05:00.000Z')

    it('escalates and exposes the retry count', () => {
      const state = deriveScheduledPublicationState(
        schedule({ attemptCount: 3 }),
        ALL_CAPABILITIES,
        overdueNow
      )

      expect(state.kind).toBe('overdue')
      expect(state.isExceptional).toBe(true)
      expect(state.attemptCount).toBe(3)
    })

    it('raises the tone to danger when the sweep reported an error', () => {
      const state = deriveScheduledPublicationState(
        schedule({ attemptCount: 2, lastError: 'workflow transition rejected' }),
        ALL_CAPABILITIES,
        overdueNow
      )

      expect(state.tone).toBe('danger')
      expect(state.lastError).toBe('workflow transition rejected')
    })

    it('raises the tone to danger even while still armed and not yet due', () => {
      const state = deriveScheduledPublicationState(
        schedule({ lastError: 'transient database error' }),
        ALL_CAPABILITIES,
        NOW
      )

      expect(state.kind).toBe('armed')
      expect(state.tone).toBe('danger')
    })

    it('still offers cancel so a stuck schedule can be cleared', () => {
      const state = deriveScheduledPublicationState(
        schedule({ attemptCount: 5, lastError: 'boom' }),
        { canSchedule: false, canConfirm: false, canCancel: true },
        overdueNow
      )

      expect(state.actions.cancel).toBe(true)
    })
  })

  it('accepts a Date instant as readily as an ISO string', () => {
    const state = deriveScheduledPublicationState(
      schedule({ publishAt: new Date('2026-08-24T09:00:00.000Z') }),
      ALL_CAPABILITIES,
      NOW
    )

    expect(state.publishAt?.toISOString()).toBe('2026-08-24T09:00:00.000Z')
  })
})
