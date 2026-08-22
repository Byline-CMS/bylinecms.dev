/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { resolveScheduledPublicationWallTime } from './scheduled-publication-time.js'

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
