/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { DocumentPublishSchedule } from '@byline/core'
import { describe, expect, it } from 'vitest'

import { omitScheduleExecutionState } from './scheduled-publication-response.js'

describe('scheduled-publication transport response', () => {
  it('does not expose the execution fencing token or its lease', () => {
    const now = new Date('2026-08-22T12:00:00.000Z')
    const schedule: DocumentPublishSchedule = {
      documentId: 'doc-1',
      collectionId: 'collection-1',
      targetVersionId: 'version-1',
      publishAt: now,
      state: 'armed',
      suspendedAt: null,
      suspendedReason: null,
      scheduledBy: null,
      lastAuthorizedBy: null,
      lastAuthorizedAt: now,
      scheduledAt: now,
      updatedAt: now,
      executionToken: 'sweep-fencing-secret',
      executionExpiresAt: new Date('2026-08-22T12:05:00.000Z'),
      lastAttemptAt: now,
      nextAttemptAt: now,
      attemptCount: 1,
      lastError: null,
    }

    const response = omitScheduleExecutionState(schedule)

    expect(response).not.toHaveProperty('executionToken')
    expect(response).not.toHaveProperty('executionExpiresAt')
    expect(JSON.stringify(response)).not.toContain('sweep-fencing-secret')
    expect(response).toMatchObject({ documentId: 'doc-1', state: 'armed', attemptCount: 1 })
  })
})
