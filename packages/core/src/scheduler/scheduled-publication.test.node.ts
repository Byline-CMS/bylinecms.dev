/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import { runScheduledPublicationSweep } from './scheduled-publication.js'
import type { ClaimedDocumentPublishSchedule } from '../@types/index.js'
import type { BylineCore } from '../core.js'
import type { BylineLogger } from '../lib/logger.js'

const logger = {
  log: vi.fn(),
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
} satisfies BylineLogger

function emptyCore(): {
  core: BylineCore
  claimDue: ReturnType<typeof vi.fn>
} {
  const claimDue = vi.fn().mockResolvedValue([])
  return {
    core: {
      db: { commands: { documents: { publishSchedules: { claimDue } } } },
      logger,
    } as unknown as BylineCore,
    claimDue,
  }
}

function claim(documentId: string): ClaimedDocumentPublishSchedule {
  const now = new Date('2026-08-22T12:00:00.000Z')
  return {
    documentId,
    collectionId: 'unregistered-collection',
    targetVersionId: `version-${documentId}`,
    authorizedRevision: 1,
    publishAt: now,
    state: 'armed',
    suspendedAt: null,
    suspendedReason: null,
    scheduledBy: null,
    lastAuthorizedBy: null,
    lastAuthorizedAt: now,
    scheduledAt: now,
    updatedAt: now,
    executionToken: `token-${documentId}`,
    executionExpiresAt: new Date(now.getTime() + 60_000),
    lastAttemptAt: now,
    nextAttemptAt: now,
    attemptCount: 1,
    lastError: null,
    databaseNow: now,
    recoveredExpiredClaim: false,
  }
}

describe('runScheduledPublicationSweep', () => {
  it('returns a drained summary when no schedules are due', async () => {
    const { core, claimDue } = emptyCore()

    await expect(
      runScheduledPublicationSweep(core, { batchSize: 10, budgetMs: 5_000 })
    ).resolves.toEqual({ published: 0, failed: 0, workRemaining: false })
    expect(claimDue).toHaveBeenCalledWith({ batchSize: 10, leaseMs: 300_000 })
  })

  it.each([
    [{ batchSize: 0 }, 'batchSize'],
    [{ batchSize: 1.5 }, 'batchSize'],
    [{ budgetMs: -1 }, 'budgetMs'],
    [{ budgetMs: Number.POSITIVE_INFINITY }, 'budgetMs'],
  ])('rejects invalid operational limits: %o', async (options, expected) => {
    const { core, claimDue } = emptyCore()

    await expect(runScheduledPublicationSweep(core, options)).rejects.toThrow(expected)
    expect(claimDue).not.toHaveBeenCalled()
  })

  it('honours an already-aborted signal before claiming work', async () => {
    const { core, claimDue } = emptyCore()
    const controller = new AbortController()
    controller.abort(new Error('stopping'))

    await expect(runScheduledPublicationSweep(core, { signal: controller.signal })).rejects.toThrow(
      'stopping'
    )
    expect(claimDue).not.toHaveBeenCalled()
  })

  it('continues the batch when both cleanup and claim release fail for one item', async () => {
    const first = claim('first')
    const second = claim('second')
    const claimDue = vi.fn().mockResolvedValue([first, second])
    const lockClaim = vi.fn(async ({ documentId }: { documentId: string }) => {
      if (documentId === first.documentId) throw new Error('cleanup unavailable')
      return second
    })
    const deleteClaim = vi.fn().mockResolvedValue(true)
    const releaseClaim = vi.fn(async () => {
      throw new Error('release unavailable')
    })
    const core = {
      collections: [],
      collectionRecords: new Map(),
      db: {
        withTransaction: async <T>(fn: () => Promise<T>) => fn(),
        withReadSnapshot: async (
          fn: (queries: {
            documents: {
              getCurrentVersionMetadata: () => Promise<null>
              getDocumentRevision: () => Promise<number>
            }
          }) => Promise<unknown>
        ) =>
          fn({
            documents: {
              getCurrentVersionMetadata: async () => null,
              getDocumentRevision: async () => 1,
            },
          }),
        commands: {
          collections: { lockCollectionRegistration: vi.fn(async () => {}) },
          audit: { append: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
          documents: {
            publishSchedules: { claimDue, lockClaim, deleteClaim, releaseClaim },
          },
        },
      },
      logger,
    } as unknown as BylineCore

    await expect(
      runScheduledPublicationSweep(core, { batchSize: 10, budgetMs: 5_000 })
    ).resolves.toEqual({ published: 0, failed: 1, workRemaining: false })
    expect(releaseClaim).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: first.documentId })
    )
    expect(deleteClaim).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: second.documentId })
    )
  })
})
