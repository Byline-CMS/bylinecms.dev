/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  joinWallTime,
  resolveScheduledPublicationWallTime,
  wallTimeInZone,
} from './scheduled-publication-time.js'

describe('resolveScheduledPublicationWallTime', () => {
  it('rejects a calendar date that the Date constructor would normalize', () => {
    expect(resolveScheduledPublicationWallTime('2026-02-30T12:00', 'UTC')).toEqual({
      status: 'invalid',
    })
  })

  it('resolves an ordinary wall time to one ISO instant', () => {
    expect(resolveScheduledPublicationWallTime('2026-08-23T12:00', 'America/New_York')).toEqual({
      status: 'valid',
      choices: [{ iso: '2026-08-23T16:00:00.000Z', offsetLabel: 'UTC-04:00' }],
    })
  })

  it('rejects a daylight-saving gap instead of silently shifting it', () => {
    expect(resolveScheduledPublicationWallTime('2026-03-08T02:30', 'America/New_York')).toEqual({
      status: 'nonexistent',
    })
  })

  it('returns both instants in a daylight-saving overlap', () => {
    expect(resolveScheduledPublicationWallTime('2026-11-01T01:30', 'America/New_York')).toEqual({
      status: 'valid',
      choices: [
        { iso: '2026-11-01T05:30:00.000Z', offsetLabel: 'UTC-04:00' },
        { iso: '2026-11-01T06:30:00.000Z', offsetLabel: 'UTC-05:00' },
      ],
    })
  })
})

describe('wallTimeInZone', () => {
  it('splits an instant into the day and clock reading shown in the zone', () => {
    expect(wallTimeInZone(new Date('2026-08-23T16:00:00.000Z'), 'America/New_York')).toEqual({
      date: '2026-08-23',
      time: '12:00',
    })
  })

  it('reports the previous day when the zone is behind the instant', () => {
    expect(wallTimeInZone(new Date('2026-08-24T02:00:00.000Z'), 'America/New_York')).toEqual({
      date: '2026-08-23',
      time: '22:00',
    })
  })

  it('round-trips an overlap instant back to the wall time that produced it', () => {
    // The second 01:30 of the fall-back overlap. Both instants share a wall
    // time, so re-opening the modal must show 01:30 rather than a UTC spelling.
    expect(wallTimeInZone(new Date('2026-11-01T06:30:00.000Z'), 'America/New_York')).toEqual({
      date: '2026-11-01',
      time: '01:30',
    })
  })
})

describe('joinWallTime', () => {
  it('joins the two halves into the resolver grammar', () => {
    expect(joinWallTime({ date: '2026-08-23', time: '12:00' })).toBe('2026-08-23T12:00')
  })

  it('drops the seconds a native time input may append', () => {
    expect(joinWallTime({ date: '2026-08-23', time: '12:00:00' })).toBe('2026-08-23T12:00')
  })

  it('returns null while either half is still blank', () => {
    expect(joinWallTime({ date: '', time: '12:00' })).toBeNull()
    expect(joinWallTime({ date: '2026-08-23', time: '' })).toBeNull()
  })
})

describe('the wall time the picker reports survives to an instant', () => {
  // These pin the contract between DatePicker's `onWallTimeChange` and the
  // resolver: whatever the editor picks in the grid must reach
  // `resolveScheduledPublicationWallTime` unchanged, so the two daylight-saving
  // cases are still decidable at that point. Going through `onDateChange`'s
  // `Date` instead would have destroyed both distinctions before this call.
  const gridSelection = (date: string, time: string) => ({ date, time })

  it('refuses a grid selection that lands in a spring-forward gap', () => {
    const wall = gridSelection('2026-03-08', '02:30')

    expect(
      resolveScheduledPublicationWallTime(joinWallTime(wall) as string, 'America/New_York')
    ).toEqual({ status: 'nonexistent' })
  })

  it('offers both instants for a grid selection inside an autumn overlap', () => {
    const wall = gridSelection('2026-11-01', '01:30')
    const resolution = resolveScheduledPublicationWallTime(
      joinWallTime(wall) as string,
      'America/New_York'
    )

    expect(resolution.status).toBe('valid')
    expect(resolution.status === 'valid' && resolution.choices).toHaveLength(2)
  })

  it('resolves an ordinary grid selection to exactly one instant', () => {
    const wall = gridSelection('2026-08-23', '09:15')
    const resolution = resolveScheduledPublicationWallTime(
      joinWallTime(wall) as string,
      'America/New_York'
    )

    expect(resolution).toEqual({
      status: 'valid',
      choices: [{ iso: '2026-08-23T13:15:00.000Z', offsetLabel: 'UTC-04:00' }],
    })
  })
})
