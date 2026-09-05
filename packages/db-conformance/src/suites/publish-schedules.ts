/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext } from '@byline/auth'
import type { BylineCore, BylineLogger, DocumentLifecycleContext } from '@byline/core'
import {
  changeDocumentStatus,
  type DocumentPublishSchedule,
  deleteDocument,
  deleteLocale,
  type IDbAdapter,
  type MultiCollectionDefinition,
  type ScheduleDocumentPublishResult,
  unpublishDocument,
  updateDocument,
} from '@byline/core'
import { runScheduledPublicationSweep } from '@byline/core/scheduler'
import { v4 as uuidv4 } from 'uuid'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { ConformanceHooks, SchedulerContentionObserver } from '../index.js'

const noopLogger = {
  log: vi.fn(),
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
} satisfies BylineLogger

const timestamp = Date.now()

const PrimaryCollection: MultiCollectionDefinition = {
  path: `publish-schedules-primary-${timestamp}`,
  labels: { singular: 'Scheduled primary', plural: 'Scheduled primary' },
  fields: [{ name: 'title', type: 'text' }],
}

const SecondaryCollection: MultiCollectionDefinition = {
  path: `publish-schedules-secondary-${timestamp}`,
  labels: { singular: 'Scheduled secondary', plural: 'Scheduled secondary' },
  fields: [{ name: 'title', type: 'text' }],
}

const LocaleCollection: MultiCollectionDefinition = {
  path: `publish-schedules-locales-${timestamp}`,
  labels: { singular: 'Scheduled locale', plural: 'Scheduled locales' },
  fields: [{ name: 'title', type: 'text', localized: true }],
}

interface CollectionFixture {
  id: string
  definition: MultiCollectionDefinition
}

interface DocumentFixture {
  documentId: string
  versionId: string
  collection: CollectionFixture
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function scheduledOrThrow(result: ScheduleDocumentPublishResult): DocumentPublishSchedule {
  if (result.status !== 'scheduled') {
    throw new Error(`expected schedule write to succeed, got '${result.status}'`)
  }
  return result.schedule
}

/**
 * Backend-neutral contract for the document scheduled-publication protocol.
 * The suite reaches the implementation only through
 * `IDbAdapter.commands.documents.publishSchedules` and its query companion;
 * it never imports a schema table or adapter-internal class.
 */
export function publishSchedulesSuite(hooks: ConformanceHooks): void {
  let adapter: IDbAdapter
  let primary: CollectionFixture
  let secondary: CollectionFixture
  let localeCollection: CollectionFixture
  let observeContention: SchedulerContentionObserver
  let documentCounter = 0

  async function createDocument(
    collection: CollectionFixture,
    status = 'draft'
  ): Promise<DocumentFixture> {
    const label = `schedule-document-${documentCounter++}`
    const result = await adapter.commands.documents.createDocumentVersion({
      collectionId: collection.id,
      collectionVersion: 1,
      collectionConfig: collection.definition,
      action: 'create',
      documentData: { title: label },
      path: label,
      status,
    })
    return {
      documentId: result.document.document_id as string,
      versionId: result.document.id as string,
      collection,
    }
  }

  async function createNextVersion(document: DocumentFixture): Promise<DocumentFixture> {
    const label = `schedule-document-version-${documentCounter++}`
    const result = await adapter.commands.documents.createDocumentVersion({
      documentId: document.documentId,
      collectionId: document.collection.id,
      collectionVersion: 1,
      collectionConfig: document.collection.definition,
      action: 'update',
      documentData: { title: label },
      previousVersionId: document.versionId,
      status: 'draft',
    })
    return { ...document, versionId: result.document.id as string }
  }

  async function createLocalizedDocument(): Promise<DocumentFixture> {
    const label = `schedule-locale-document-${documentCounter++}`
    const first = await adapter.commands.documents.createDocumentVersion({
      collectionId: localeCollection.id,
      collectionVersion: 1,
      collectionConfig: localeCollection.definition,
      action: 'create',
      documentData: { title: `${label}-en` },
      locale: 'en',
      path: label,
      status: 'draft',
    })
    const second = await adapter.commands.documents.createDocumentVersion({
      documentId: first.document.document_id as string,
      collectionId: localeCollection.id,
      collectionVersion: 1,
      collectionConfig: localeCollection.definition,
      action: 'update',
      documentData: { title: `${label}-fr` },
      locale: 'fr',
      previousVersionId: first.document.id as string,
      status: 'draft',
    })
    return {
      documentId: second.document.document_id as string,
      versionId: second.document.id as string,
      collection: localeCollection,
    }
  }

  async function schedule(params: {
    document: DocumentFixture
    publishAt: Date
    actorId?: string | null
    expectedVersionId?: string
  }): Promise<ScheduleDocumentPublishResult> {
    return adapter.withTransaction(() =>
      adapter.commands.documents.publishSchedules.schedule({
        authorizedRevision: 1,
        documentId: params.document.documentId,
        collectionId: params.document.collection.id,
        expectedVersionId: params.expectedVersionId ?? params.document.versionId,
        publishAt: params.publishAt,
        actorId: params.actorId ?? null,
      })
    )
  }

  async function cancel(document: DocumentFixture): Promise<DocumentPublishSchedule | null> {
    return adapter.withTransaction(() =>
      adapter.commands.documents.publishSchedules.cancel({
        documentId: document.documentId,
        collectionId: document.collection.id,
      })
    )
  }

  async function get(document: DocumentFixture): Promise<DocumentPublishSchedule | null> {
    return adapter.queries.documents.publishSchedules.get({
      documentId: document.documentId,
      collectionId: document.collection.id,
    })
  }

  function lifecycleContext(
    collection: CollectionFixture,
    definition: MultiCollectionDefinition = collection.definition
  ): DocumentLifecycleContext {
    return {
      db: adapter,
      definition,
      collectionId: collection.id,
      collectionVersion: 1,
      collectionPath: definition.path,
      logger: noopLogger,
      defaultLocale: 'en',
      requestContext: createSuperAdminContext({ id: 'scheduled-publication-conformance' }),
    }
  }

  function sweepCore(definition: MultiCollectionDefinition = primary.definition): BylineCore {
    return {
      config: { i18n: { content: { defaultLocale: 'en' } } },
      collections: [definition],
      db: adapter,
      storage: undefined,
      logger: noopLogger,
      collectionRecords: new Map([
        [definition.path, { collectionId: primary.id, version: 1, schemaHash: 'conformance' }],
      ]),
    } as unknown as BylineCore
  }

  describe('document publish schedules (adapter conformance)', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([
        PrimaryCollection,
        SecondaryCollection,
        LocaleCollection,
      ])
      const observer = hooks.observePublishScheduleContention
      if (!observer) {
        throw new Error(
          'publishSchedulesSuite requires hooks.observePublishScheduleContention to prove real database contention'
        )
      }
      observeContention = observer

      const primaryRows = await adapter.commands.collections.create(
        PrimaryCollection.path,
        PrimaryCollection
      )
      const secondaryRows = await adapter.commands.collections.create(
        SecondaryCollection.path,
        SecondaryCollection
      )
      const localeRows = await adapter.commands.collections.create(
        LocaleCollection.path,
        LocaleCollection
      )
      const primaryRow = primaryRows[0]
      const secondaryRow = secondaryRows[0]
      const localeRow = localeRows[0]
      if (primaryRow == null || secondaryRow == null || localeRow == null) {
        throw new Error('failed to create publish-schedule conformance collections')
      }
      primary = { id: primaryRow.id as string, definition: PrimaryCollection }
      secondary = { id: secondaryRow.id as string, definition: SecondaryCollection }
      localeCollection = { id: localeRow.id as string, definition: LocaleCollection }
    })

    it('1. creates and reschedules one row, with ownership and database-time guards', async () => {
      const document = await createDocument(primary)
      const otherDocument = await createDocument(primary)
      const firstActor = uuidv4()
      const secondActor = uuidv4()
      const publishAt = new Date(Date.now() + 60_000)

      // Move only the process Date far beyond publishAt. A process-clock
      // validation would reject; the required database-time comparison still
      // accepts the future instant.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2200-01-01T00:00:00.000Z'))
      let created: ScheduleDocumentPublishResult
      try {
        created = await schedule({ document, publishAt, actorId: firstActor })
      } finally {
        vi.useRealTimers()
      }

      const first = scheduledOrThrow(created)
      expect(first.documentId).toBe(document.documentId)
      expect(first.targetVersionId).toBe(document.versionId)
      expect(first.state).toBe('armed')
      expect(first.scheduledBy).toBe(firstActor)
      expect(first.lastAuthorizedBy).toBe(firstActor)
      expect(first.publishAt).toBeInstanceOf(Date)
      expect(first.lastAuthorizedAt).toBeInstanceOf(Date)
      expect(first.scheduledAt).toBeInstanceOf(Date)
      expect(first.updatedAt).toBeInstanceOf(Date)
      expect(first.nextAttemptAt).toBeInstanceOf(Date)

      const replacementAt = new Date(Date.now() + 120_000)
      const replaced = await schedule({ document, publishAt: replacementAt, actorId: secondActor })
      expect(replaced.status).toBe('scheduled')
      if (replaced.status !== 'scheduled') throw new Error('reschedule unexpectedly rejected')
      expect(replaced.previous?.publishAt.getTime()).toBe(publishAt.getTime())
      expect(replaced.schedule.scheduledBy).toBe(firstActor)
      expect(replaced.schedule.lastAuthorizedBy).toBe(secondActor)
      expect(replaced.schedule.scheduledAt).toEqual(first.scheduledAt)
      expect(replaced.schedule.publishAt.getTime()).toBe(replacementAt.getTime())
      expect(replaced.schedule.attemptCount).toBe(0)
      expect(replaced.schedule.executionToken).toBeNull()

      await expect(
        schedule({ document: otherDocument, publishAt: new Date(0), actorId: firstActor })
      ).resolves.toEqual({ status: 'publish_at_not_future' })

      const newer = await createNextVersion(document)
      await expect(
        schedule({
          document: newer,
          expectedVersionId: document.versionId,
          publishAt: new Date(Date.now() + 60_000),
          actorId: firstActor,
        })
      ).resolves.toEqual({ status: 'version_mismatch' })
      await expect(
        schedule({
          document: newer,
          expectedVersionId: otherDocument.versionId,
          publishAt: new Date(Date.now() + 60_000),
          actorId: firstActor,
        })
      ).resolves.toEqual({ status: 'version_mismatch' })

      const missing: DocumentFixture = { ...document, documentId: uuidv4() }
      await expect(
        schedule({ document: missing, publishAt: new Date(Date.now() + 60_000) })
      ).resolves.toEqual({ status: 'document_not_found' })

      // This suite shares one database fixture across its numbered
      // behaviours. Remove the deliberately stale target created above so
      // the listing test that follows counts only its own rows.
      await cancel(document)
    })

    it('2. suspends edits and re-confirms only the reviewed current version at the original instant', async () => {
      const original = await createDocument(primary)
      const originalActor = uuidv4()
      const confirmingActor = uuidv4()
      const publishAt = new Date(Date.now() + 250)
      scheduledOrThrow(await schedule({ document: original, publishAt, actorId: originalActor }))

      const current = await createNextVersion(original)
      const suspended = await adapter.withTransaction(() =>
        adapter.commands.documents.publishSchedules.suspendForContentEdit({
          documentId: original.documentId,
          collectionId: primary.id,
        })
      )
      expect(suspended.status).toBe('suspended')
      if (suspended.status !== 'suspended') throw new Error('schedule was not suspended')
      expect(suspended.schedule.state).toBe('needs_reconfirm')
      expect(suspended.schedule.suspendedReason).toBe('content_edited')
      expect(suspended.schedule.suspendedAt).toBeInstanceOf(Date)
      expect(suspended.schedule.targetVersionId).toBe(original.versionId)
      expect(suspended.schedule.lastAuthorizedBy).toBe(originalActor)

      await expect(
        adapter.withTransaction(() =>
          adapter.commands.documents.publishSchedules.suspendForContentEdit({
            documentId: original.documentId,
            collectionId: primary.id,
          })
        )
      ).resolves.toEqual({ status: 'already_suspended' })

      await expect(
        adapter.withTransaction(() =>
          adapter.commands.documents.publishSchedules.confirm({
            authorizedRevision: 1,
            documentId: original.documentId,
            collectionId: primary.id,
            expectedVersionId: original.versionId,
            actorId: confirmingActor,
          })
        )
      ).resolves.toEqual({ status: 'version_mismatch' })

      await sleep(300)
      const confirmed = await adapter.withTransaction(() =>
        adapter.commands.documents.publishSchedules.confirm({
          authorizedRevision: 1,
          documentId: current.documentId,
          collectionId: primary.id,
          expectedVersionId: current.versionId,
          actorId: confirmingActor,
        })
      )
      expect(confirmed.status).toBe('confirmed')
      if (confirmed.status !== 'confirmed') throw new Error('schedule was not confirmed')
      expect(confirmed.previousTargetVersionId).toBe(original.versionId)
      expect(confirmed.schedule.targetVersionId).toBe(current.versionId)
      expect(confirmed.schedule.state).toBe('armed')
      expect(confirmed.schedule.publishAt.getTime()).toBe(publishAt.getTime())
      expect(confirmed.schedule.nextAttemptAt.getTime()).toBe(publishAt.getTime())
      expect(confirmed.schedule.scheduledBy).toBe(originalActor)
      expect(confirmed.schedule.lastAuthorizedBy).toBe(confirmingActor)

      await expect(
        adapter.withTransaction(() =>
          adapter.commands.documents.publishSchedules.confirm({
            authorizedRevision: 1,
            documentId: current.documentId,
            collectionId: primary.id,
            expectedVersionId: current.versionId,
            actorId: confirmingActor,
          })
        )
      ).resolves.toEqual({ status: 'not_suspended' })

      const [claimed] = await adapter.commands.documents.publishSchedules.claimDue({
        batchSize: 1,
        leaseMs: 60_000,
      })
      expect(claimed?.documentId).toBe(current.documentId)
      if (claimed) {
        await adapter.withTransaction(() =>
          adapter.commands.documents.publishSchedules.deleteClaim({
            documentId: claimed.documentId,
            executionToken: claimed.executionToken,
          })
        )
      }
    })

    it('3. enforces allowlisted, filterable, deterministic cross-collection listing', async () => {
      const actorA = uuidv4()
      const actorB = uuidv4()
      const first = await createDocument(primary)
      const second = await createDocument(primary)
      const hidden = await createDocument(secondary)
      const base = Date.now() + 60_000

      scheduledOrThrow(
        await schedule({ document: first, publishAt: new Date(base + 1_000), actorId: actorA })
      )
      scheduledOrThrow(
        await schedule({ document: second, publishAt: new Date(base + 2_000), actorId: actorB })
      )
      scheduledOrThrow(
        await schedule({ document: hidden, publishAt: new Date(base + 3_000), actorId: actorA })
      )
      await adapter.withTransaction(() =>
        adapter.commands.documents.publishSchedules.suspendForContentEdit({
          documentId: second.documentId,
          collectionId: primary.id,
        })
      )

      const firstPage = await adapter.queries.documents.publishSchedules.list({
        collectionIds: [primary.id],
        page: 1,
        pageSize: 1,
      })
      expect(firstPage.total).toBe(2)
      expect(firstPage.schedules.map((row) => row.documentId)).toEqual([first.documentId])

      const secondPage = await adapter.queries.documents.publishSchedules.list({
        collectionIds: [primary.id],
        page: 2,
        pageSize: 1,
      })
      expect(secondPage.total).toBe(2)
      expect(secondPage.schedules.map((row) => row.documentId)).toEqual([second.documentId])

      const suspended = await adapter.queries.documents.publishSchedules.list({
        collectionIds: [primary.id, secondary.id],
        states: ['needs_reconfirm'],
        page: 1,
        pageSize: 20,
      })
      expect(suspended.schedules.map((row) => row.documentId)).toEqual([second.documentId])

      const authorizedByA = await adapter.queries.documents.publishSchedules.list({
        collectionIds: [primary.id, secondary.id],
        lastAuthorizedBy: actorA,
        page: 1,
        pageSize: 20,
      })
      expect(authorizedByA.schedules.map((row) => row.documentId)).toEqual([
        first.documentId,
        hidden.documentId,
      ])

      await expect(
        adapter.queries.documents.publishSchedules.list({
          collectionIds: [],
          page: 1,
          pageSize: 20,
        })
      ).resolves.toEqual({ schedules: [], total: 0 })
      await expect(
        adapter.queries.documents.publishSchedules.list({
          collectionIds: [primary.id],
          states: [],
          page: 1,
          pageSize: 20,
        })
      ).resolves.toEqual({ schedules: [], total: 0 })
    })

    it('4. has one physical-connection winner for concurrent due claims', async () => {
      const document = await createDocument(primary)
      scheduledOrThrow(
        await schedule({ document, publishAt: new Date(Date.now() + 250), actorId: uuidv4() })
      )

      // The row is still future according to the database. Moving only the
      // process clock past it must not make the claim eligible.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2200-01-01T00:00:00.000Z'))
      try {
        await expect(
          adapter.commands.documents.publishSchedules.claimDue({
            batchSize: 1,
            leaseMs: 60_000,
          })
        ).resolves.toEqual([])
      } finally {
        vi.useRealTimers()
      }
      await sleep(300)

      const observation = await observeContention(() =>
        Promise.all(
          Array.from({ length: 8 }, () =>
            adapter.commands.documents.publishSchedules.claimDue({
              batchSize: 1,
              leaseMs: 60_000,
            })
          )
        )
      )
      expect(observation.maxConcurrentConnections).toBeGreaterThan(1)
      const winners = observation.result.flat()
      expect(winners).toHaveLength(1)
      const winner = winners[0]
      if (!winner) throw new Error('concurrent claim produced no winner')
      expect(winner.documentId).toBe(document.documentId)
      expect(winner.executionToken).toBeTruthy()
      expect(winner.executionExpiresAt).toBeInstanceOf(Date)
      expect(winner.lastAttemptAt).toBeInstanceOf(Date)
      expect(winner.databaseNow).toBeInstanceOf(Date)
      expect(winner.attemptCount).toBe(1)
      expect(winner.recoveredExpiredClaim).toBe(false)

      await expect(
        schedule({ document, publishAt: new Date(Date.now() + 60_000), actorId: uuidv4() })
      ).resolves.toEqual({ status: 'execution_in_progress' })
      await cancel(document)
    })

    it('5. claims oldest-first while never claiming suspended rows', async () => {
      const suspended = await createDocument(primary)
      const oldestArmed = await createDocument(primary)
      const newestArmed = await createDocument(primary)
      const base = Date.now() + 400

      scheduledOrThrow(
        await schedule({ document: suspended, publishAt: new Date(base), actorId: uuidv4() })
      )
      scheduledOrThrow(
        await schedule({ document: oldestArmed, publishAt: new Date(base + 50), actorId: uuidv4() })
      )
      scheduledOrThrow(
        await schedule({
          document: newestArmed,
          publishAt: new Date(base + 100),
          actorId: uuidv4(),
        })
      )
      await adapter.withTransaction(() =>
        adapter.commands.documents.publishSchedules.suspendForContentEdit({
          documentId: suspended.documentId,
          collectionId: primary.id,
        })
      )
      await sleep(550)

      await expect(
        adapter.commands.documents.publishSchedules.claimDue({ batchSize: 0, leaseMs: 60_000 })
      ).resolves.toEqual([])
      const firstBatch = await adapter.commands.documents.publishSchedules.claimDue({
        batchSize: 1,
        leaseMs: 60_000,
      })
      expect(firstBatch.map((row) => row.documentId)).toEqual([oldestArmed.documentId])
      const oldestClaim = firstBatch[0]
      if (!oldestClaim) throw new Error('expected oldest armed schedule to be claimed')
      await expect(
        adapter.commands.documents.publishSchedules.suspendClaimForContentEdit({
          documentId: oldestClaim.documentId,
          executionToken: oldestClaim.executionToken,
        })
      ).resolves.toBe(true)
      expect((await get(oldestArmed))?.state).toBe('needs_reconfirm')
      expect((await get(oldestArmed))?.executionToken).toBeNull()
      const secondBatch = await adapter.commands.documents.publishSchedules.claimDue({
        batchSize: 10,
        leaseMs: 60_000,
      })
      expect(secondBatch.map((row) => row.documentId)).toEqual([newestArmed.documentId])

      await cancel(suspended)
      await cancel(oldestArmed)
      await cancel(newestArmed)
    })

    it('6. recovers expiry while stale and malformed tokens cannot mutate the newer claim', async () => {
      const document = await createDocument(primary)
      const expiredReschedule = await createDocument(primary)
      const dueAt = Date.now() + 300
      scheduledOrThrow(await schedule({ document, publishAt: new Date(dueAt), actorId: uuidv4() }))
      scheduledOrThrow(
        await schedule({
          document: expiredReschedule,
          publishAt: new Date(dueAt + 25),
          actorId: uuidv4(),
        })
      )
      await sleep(375)

      const initialClaims = await adapter.commands.documents.publishSchedules.claimDue({
        batchSize: 2,
        leaseMs: 100,
      })
      const first = initialClaims.find((claim) => claim.documentId === document.documentId)
      const rescheduleClaim = initialClaims.find(
        (claim) => claim.documentId === expiredReschedule.documentId
      )
      if (!first) throw new Error('expected initial due claim')
      if (!rescheduleClaim) throw new Error('expected expired-reschedule claim')
      await sleep(150)

      const afterExpiredReschedule = await schedule({
        document: expiredReschedule,
        publishAt: new Date(Date.now() + 60_000),
        actorId: uuidv4(),
      })
      expect(afterExpiredReschedule.status).toBe('scheduled')
      if (afterExpiredReschedule.status !== 'scheduled') {
        throw new Error('expired execution claim incorrectly blocked rescheduling')
      }
      expect(afterExpiredReschedule.schedule.executionToken).toBeNull()
      expect(afterExpiredReschedule.schedule.attemptCount).toBe(0)

      // Expiry invalidates publication authority even before a replacement claim.
      const lateGuard = await adapter.withTransaction(() =>
        adapter.commands.documents.publishSchedules.lockClaim({
          documentId: document.documentId,
          executionToken: first.executionToken,
        })
      )
      expect(lateGuard).toBeNull()

      const [recovered] = await adapter.commands.documents.publishSchedules.claimDue({
        batchSize: 1,
        leaseMs: 60_000,
      })
      if (!recovered) throw new Error('expected expired claim recovery')
      expect(recovered.executionToken).not.toBe(first.executionToken)
      expect(recovered.recoveredExpiredClaim).toBe(true)
      expect(recovered.attemptCount).toBe(2)

      const beforeStale = await get(document)
      const malformed = 'not-a-uuid-at-all'
      await expect(
        adapter.withTransaction(() =>
          adapter.commands.documents.publishSchedules.lockClaim({
            documentId: document.documentId,
            executionToken: malformed,
          })
        )
      ).resolves.toBeNull()
      await expect(
        adapter.commands.documents.publishSchedules.deleteClaim({
          documentId: document.documentId,
          executionToken: malformed,
        })
      ).resolves.toBe(false)
      await expect(
        adapter.commands.documents.publishSchedules.releaseClaim({
          documentId: document.documentId,
          executionToken: first.executionToken,
          error: 'stale failure',
        })
      ).resolves.toBe(false)
      await expect(
        adapter.commands.documents.publishSchedules.suspendClaimForContentEdit({
          documentId: document.documentId,
          executionToken: first.executionToken,
        })
      ).resolves.toBe(false)
      expect(await get(document)).toEqual(beforeStale)

      await expect(
        adapter.commands.documents.publishSchedules.releaseClaim({
          documentId: document.documentId,
          executionToken: recovered.executionToken,
          error: `  ${'x'.repeat(3_000)}  `,
        })
      ).resolves.toBe(true)
      const released = await get(document)
      expect(released?.executionToken).toBeNull()
      expect(released?.executionExpiresAt).toBeNull()
      expect(released?.lastError).toBe('x'.repeat(2_048))
      expect(released?.attemptCount).toBe(2)
      expect((released?.nextAttemptAt.getTime() ?? 0) - (released?.updatedAt.getTime() ?? 0)).toBe(
        120_000
      )
      await expect(
        adapter.commands.documents.publishSchedules.claimDue({
          batchSize: 1,
          leaseMs: 60_000,
        })
      ).resolves.toEqual([])

      const stackDocument = await createDocument(primary)
      scheduledOrThrow(
        await schedule({
          document: stackDocument,
          publishAt: new Date(Date.now() + 250),
          actorId: uuidv4(),
        })
      )
      await sleep(300)
      const [stackClaim] = await adapter.commands.documents.publishSchedules.claimDue({
        batchSize: 1,
        leaseMs: 60_000,
      })
      if (!stackClaim) throw new Error('expected stack-sanitization claim')
      await adapter.commands.documents.publishSchedules.releaseClaim({
        documentId: stackDocument.documentId,
        executionToken: stackClaim.executionToken,
        error: 'safe message\n    at secret stack frame',
      })
      expect((await get(stackDocument))?.lastError).toBe('safe message')

      await cancel(document)
      await cancel(expiredReschedule)
      await cancel(stackDocument)
    })

    it('7. cancellation and token-guarded publication have exactly one committed row-lock winner', async () => {
      const publicationWins = await createDocument(primary)
      scheduledOrThrow(
        await schedule({
          document: publicationWins,
          publishAt: new Date(Date.now() + 250),
          actorId: uuidv4(),
        })
      )
      await sleep(300)
      const [publicationClaim] = await adapter.commands.documents.publishSchedules.claimDue({
        batchSize: 1,
        leaseMs: 60_000,
      })
      if (!publicationClaim) throw new Error('expected publication-winner claim')

      let signalPublicationLock: (() => void) | undefined
      let releasePublication: (() => void) | undefined
      const publicationLocked = new Promise<void>((resolve) => {
        signalPublicationLock = resolve
      })
      const holdPublication = new Promise<void>((resolve) => {
        releasePublication = resolve
      })
      const publicationObservation = await observeContention(async () => {
        const publication = adapter.withTransaction(async () => {
          const guarded = await adapter.commands.documents.publishSchedules.lockClaim({
            documentId: publicationWins.documentId,
            executionToken: publicationClaim.executionToken,
          })
          expect(guarded).not.toBeNull()
          signalPublicationLock?.()
          await holdPublication
          return adapter.commands.documents.publishSchedules.deleteClaim({
            documentId: publicationWins.documentId,
            executionToken: publicationClaim.executionToken,
          })
        })

        await publicationLocked
        let signalCancellationTransaction: (() => void) | undefined
        const cancellationTransactionStarted = new Promise<void>((resolve) => {
          signalCancellationTransaction = resolve
        })
        const losingCancellation = adapter.withTransaction(() => {
          signalCancellationTransaction?.()
          return adapter.commands.documents.publishSchedules.cancel({
            documentId: publicationWins.documentId,
            collectionId: primary.id,
          })
        })
        await cancellationTransactionStarted
        releasePublication?.()
        await expect(publication).resolves.toBe(true)
        await expect(losingCancellation).resolves.toBeNull()
      })
      expect(publicationObservation.maxConcurrentConnections).toBeGreaterThan(1)

      const cancellationWins = await createDocument(primary)
      scheduledOrThrow(
        await schedule({
          document: cancellationWins,
          publishAt: new Date(Date.now() + 250),
          actorId: uuidv4(),
        })
      )
      await sleep(300)
      const [cancelledClaim] = await adapter.commands.documents.publishSchedules.claimDue({
        batchSize: 1,
        leaseMs: 60_000,
      })
      if (!cancelledClaim) throw new Error('expected cancellation-winner claim')

      let signalCancellationLock: (() => void) | undefined
      let releaseCancellation: (() => void) | undefined
      const cancellationLocked = new Promise<void>((resolve) => {
        signalCancellationLock = resolve
      })
      const holdCancellation = new Promise<void>((resolve) => {
        releaseCancellation = resolve
      })
      const cancellationObservation = await observeContention(async () => {
        const cancellation = adapter.withTransaction(async () => {
          const deleted = await adapter.commands.documents.publishSchedules.cancel({
            documentId: cancellationWins.documentId,
            collectionId: primary.id,
          })
          signalCancellationLock?.()
          await holdCancellation
          return deleted
        })

        await cancellationLocked
        let signalPublicationTransaction: (() => void) | undefined
        const publicationTransactionStarted = new Promise<void>((resolve) => {
          signalPublicationTransaction = resolve
        })
        const losingPublication = adapter.withTransaction(() => {
          signalPublicationTransaction?.()
          return adapter.commands.documents.publishSchedules.lockClaim({
            documentId: cancellationWins.documentId,
            executionToken: cancelledClaim.executionToken,
          })
        })
        await publicationTransactionStarted
        releaseCancellation?.()
        await expect(cancellation).resolves.toMatchObject({
          documentId: cancellationWins.documentId,
        })
        await expect(losingPublication).resolves.toBeNull()
      })
      expect(cancellationObservation.maxConcurrentConnections).toBeGreaterThan(1)
    })

    it('8. every lifecycle-facing write enlists in and rolls back with the ambient transaction', async () => {
      const rolledBackCreate = await createDocument(primary)
      const boom = new Error('forced ambient rollback')
      await expect(
        adapter.withTransaction(async () => {
          const result = await adapter.commands.documents.publishSchedules.schedule({
            authorizedRevision: 1,
            documentId: rolledBackCreate.documentId,
            collectionId: primary.id,
            expectedVersionId: rolledBackCreate.versionId,
            publishAt: new Date(Date.now() + 60_000),
            actorId: uuidv4(),
          })
          expect(result.status).toBe('scheduled')
          throw boom
        })
      ).rejects.toThrow(boom.message)
      await expect(get(rolledBackCreate)).resolves.toBeNull()

      const retained = await createDocument(primary)
      scheduledOrThrow(
        await schedule({
          document: retained,
          publishAt: new Date(Date.now() + 60_000),
          actorId: uuidv4(),
        })
      )

      await expect(
        adapter.withTransaction(async () => {
          const result = await adapter.commands.documents.publishSchedules.suspendForContentEdit({
            documentId: retained.documentId,
            collectionId: primary.id,
          })
          expect(result.status).toBe('suspended')
          throw boom
        })
      ).rejects.toThrow(boom.message)
      expect((await get(retained))?.state).toBe('armed')

      await expect(
        adapter.withTransaction(async () => {
          const result = await adapter.commands.documents.publishSchedules.cancel({
            documentId: retained.documentId,
            collectionId: primary.id,
          })
          expect(result).not.toBeNull()
          throw boom
        })
      ).rejects.toThrow(boom.message)
      expect(await get(retained)).not.toBeNull()

      const guardedDelete = await createDocument(primary)
      scheduledOrThrow(
        await schedule({
          document: guardedDelete,
          publishAt: new Date(Date.now() + 250),
          actorId: uuidv4(),
        })
      )
      await sleep(300)
      const [claim] = await adapter.commands.documents.publishSchedules.claimDue({
        batchSize: 1,
        leaseMs: 60_000,
      })
      if (!claim) throw new Error('expected token-delete rollback claim')
      await expect(
        adapter.withTransaction(async () => {
          const deleted = await adapter.commands.documents.publishSchedules.deleteClaim({
            documentId: guardedDelete.documentId,
            executionToken: claim.executionToken,
          })
          expect(deleted).toBe(true)
          throw boom
        })
      ).rejects.toThrow(boom.message)
      expect((await get(guardedDelete))?.executionToken).toBe(claim.executionToken)

      await cancel(retained)
      await cancel(guardedDelete)
    })

    it('9. deletion through a lifecycle foreign-key parent cascades the schedule', async () => {
      const collectionRows = await adapter.commands.collections.create(
        `publish-schedules-cascade-${timestamp}`,
        {
          path: `publish-schedules-cascade-${timestamp}`,
          labels: { singular: 'Cascade', plural: 'Cascades' },
          fields: [{ name: 'title', type: 'text' }],
        }
      )
      const row = collectionRows[0]
      if (row == null) throw new Error('failed to create cascade collection')
      const collection: CollectionFixture = {
        id: row.id as string,
        definition: {
          path: `publish-schedules-cascade-${timestamp}`,
          labels: { singular: 'Cascade', plural: 'Cascades' },
          fields: [{ name: 'title', type: 'text' }],
        },
      }
      const document = await createDocument(collection)
      scheduledOrThrow(
        await schedule({ document, publishAt: new Date(Date.now() + 60_000), actorId: uuidv4() })
      )
      await adapter.commands.collections.delete(collection.id)
      await expect(get(document)).resolves.toBeNull()
    })

    it('10. lifecycle invalidations reject outer transactions and commit their schedule effect', async () => {
      const boom = new Error('forced outer lifecycle rollback')

      const statusDocument = await createDocument(primary)
      scheduledOrThrow(
        await schedule({
          document: statusDocument,
          publishAt: new Date(Date.now() + 60_000),
          actorId: uuidv4(),
        })
      )
      await expect(
        adapter.withTransaction(async () => {
          await changeDocumentStatus(lifecycleContext(primary), {
            expectedRevision: 1,
            documentId: statusDocument.documentId,
            nextStatus: 'published',
          })
          await expect(
            adapter.commands.documents.publishSchedules.cancel({
              documentId: statusDocument.documentId,
              collectionId: primary.id,
            })
          ).resolves.toBeNull()
          throw boom
        })
      ).rejects.toMatchObject({
        code: 'ERR_VALIDATION',
        details: { reason: 'external_lifecycle_transaction' },
      })
      expect((await get(statusDocument))?.state).toBe('armed')
      expect(
        (
          await adapter.queries.documents.getCurrentVersionMetadata({
            collection_id: primary.id,
            document_id: statusDocument.documentId,
          })
        )?.status
      ).toBe('draft')
      await changeDocumentStatus(lifecycleContext(primary), {
        expectedRevision: 1,
        documentId: statusDocument.documentId,
        nextStatus: 'published',
      })
      await expect(get(statusDocument)).resolves.toBeNull()

      const unpublishDocumentFixture = await createDocument(primary)
      scheduledOrThrow(
        await schedule({
          document: unpublishDocumentFixture,
          publishAt: new Date(Date.now() + 60_000),
          actorId: uuidv4(),
        })
      )
      await expect(
        adapter.withTransaction(async () => {
          await unpublishDocument(lifecycleContext(primary), {
            expectedRevision: 1,
            documentId: unpublishDocumentFixture.documentId,
          })
          await expect(
            adapter.commands.documents.publishSchedules.cancel({
              documentId: unpublishDocumentFixture.documentId,
              collectionId: primary.id,
            })
          ).resolves.toBeNull()
          throw boom
        })
      ).rejects.toMatchObject({
        code: 'ERR_VALIDATION',
        details: { reason: 'external_lifecycle_transaction' },
      })
      expect((await get(unpublishDocumentFixture))?.state).toBe('armed')
      await unpublishDocument(lifecycleContext(primary), {
        expectedRevision: 1,
        documentId: unpublishDocumentFixture.documentId,
      })
      await expect(get(unpublishDocumentFixture)).resolves.toBeNull()

      const deletedDocument = await createDocument(primary)
      scheduledOrThrow(
        await schedule({
          document: deletedDocument,
          publishAt: new Date(Date.now() + 60_000),
          actorId: uuidv4(),
        })
      )
      await expect(
        adapter.withTransaction(async () => {
          await deleteDocument(lifecycleContext(primary), {
            expectedRevision: 1,
            documentId: deletedDocument.documentId,
          })
          await expect(
            adapter.commands.documents.publishSchedules.cancel({
              documentId: deletedDocument.documentId,
              collectionId: primary.id,
            })
          ).resolves.toBeNull()
          throw boom
        })
      ).rejects.toMatchObject({
        code: 'ERR_VALIDATION',
        details: { reason: 'external_lifecycle_transaction' },
      })
      expect((await get(deletedDocument))?.state).toBe('armed')
      expect(
        await adapter.queries.documents.getCurrentVersionMetadata({
          collection_id: primary.id,
          document_id: deletedDocument.documentId,
        })
      ).not.toBeNull()
      await deleteDocument(lifecycleContext(primary), {
        expectedRevision: 1,
        documentId: deletedDocument.documentId,
      })
      await expect(get(deletedDocument)).resolves.toBeNull()

      const editedDocument = await createDocument(primary)
      scheduledOrThrow(
        await schedule({
          document: editedDocument,
          publishAt: new Date(Date.now() + 60_000),
          actorId: uuidv4(),
        })
      )
      await expect(
        adapter.withTransaction(() =>
          updateDocument(lifecycleContext(primary), {
            documentId: editedDocument.documentId,
            expectedRevision: 1,
            data: { title: 'rejected ambient edit' },
          })
        )
      ).rejects.toMatchObject({
        code: 'ERR_VALIDATION',
        details: { reason: 'external_lifecycle_transaction' },
      })
      expect((await get(editedDocument))?.state).toBe('armed')
      expect(
        (
          await adapter.queries.documents.getCurrentVersionMetadata({
            collection_id: primary.id,
            document_id: editedDocument.documentId,
          })
        )?.document_version_id
      ).toBe(editedDocument.versionId)
      await updateDocument(lifecycleContext(primary), {
        documentId: editedDocument.documentId,
        expectedRevision: 1,
        data: { title: 'committed edit' },
      })
      expect((await get(editedDocument))?.state).toBe('needs_reconfirm')

      await cancel(editedDocument)

      const localeDocument = await createLocalizedDocument()
      scheduledOrThrow(
        await schedule({
          document: localeDocument,
          publishAt: new Date(Date.now() + 60_000),
          actorId: uuidv4(),
        })
      )
      await expect(
        adapter.withTransaction(async () => {
          await deleteLocale(lifecycleContext(localeCollection), {
            expectedRevision: 1,
            documentId: localeDocument.documentId,
            locale: 'fr',
          })
          await expect(
            adapter.commands.documents.publishSchedules.suspendForContentEdit({
              documentId: localeDocument.documentId,
              collectionId: localeCollection.id,
            })
          ).resolves.toEqual({ status: 'already_suspended' })
          throw boom
        })
      ).rejects.toMatchObject({
        code: 'ERR_VALIDATION',
        details: { reason: 'external_lifecycle_transaction' },
      })
      expect((await get(localeDocument))?.state).toBe('armed')
      expect(
        (
          await adapter.queries.documents.getCurrentVersionMetadata({
            collection_id: localeCollection.id,
            document_id: localeDocument.documentId,
          })
        )?.document_version_id
      ).toBe(localeDocument.versionId)
      await deleteLocale(lifecycleContext(localeCollection), {
        expectedRevision: 1,
        documentId: localeDocument.documentId,
        locale: 'fr',
      })
      expect((await get(localeDocument))?.state).toBe('needs_reconfirm')

      await cancel(localeDocument)
    })

    it('11. the sweep rolls status and audit back on fence failure, then publishes through hooks', async () => {
      const rollbackDocument = await createDocument(primary)
      const companionDocument = await createDocument(primary)
      scheduledOrThrow(
        await schedule({
          document: rollbackDocument,
          publishAt: new Date(Date.now() + 250),
          actorId: uuidv4(),
        })
      )
      scheduledOrThrow(
        await schedule({
          document: companionDocument,
          publishAt: new Date(Date.now() + 250),
          actorId: uuidv4(),
        })
      )
      await sleep(300)

      const scheduleCommands = adapter.commands.documents.publishSchedules
      const deleteClaim = scheduleCommands.deleteClaim
      scheduleCommands.deleteClaim = vi.fn(async (params) => {
        if (params.documentId === rollbackDocument.documentId) {
          throw new Error('forced delete-claim failure')
        }
        return deleteClaim.call(scheduleCommands, params)
      })
      try {
        await expect(
          runScheduledPublicationSweep(sweepCore(), { batchSize: 10, budgetMs: 5_000 })
        ).resolves.toEqual({ published: 1, failed: 1, workRemaining: false })
      } finally {
        scheduleCommands.deleteClaim = deleteClaim
      }

      expect(
        (
          await adapter.queries.documents.getCurrentVersionMetadata({
            collection_id: primary.id,
            document_id: rollbackDocument.documentId,
          })
        )?.status
      ).toBe('draft')
      const retained = await get(rollbackDocument)
      expect(retained?.state).toBe('armed')
      expect(retained?.executionToken).toBeNull()
      expect(retained?.lastError).toBe('forced delete-claim failure')
      const rolledBackAudit = await adapter.queries.audit.getDocumentAuditLog({
        document_id: rollbackDocument.documentId,
      })
      expect(
        rolledBackAudit.entries.some((entry) => entry.action === 'document.status.changed')
      ).toBe(false)
      expect(
        (
          await adapter.queries.documents.getCurrentVersionMetadata({
            collection_id: primary.id,
            document_id: companionDocument.documentId,
          })
        )?.status
      ).toBe('published')
      await expect(get(companionDocument)).resolves.toBeNull()
      await cancel(rollbackDocument)

      const beforeStatusChange = vi.fn()
      const afterStatusChange = vi.fn(async () => {
        throw new Error('post-commit hook failure')
      })
      const definitionWithHooks: MultiCollectionDefinition = {
        ...primary.definition,
        hooks: { beforeStatusChange, afterStatusChange },
      }
      const publishedDocument = await createDocument(primary)
      scheduledOrThrow(
        await schedule({
          document: publishedDocument,
          publishAt: new Date(Date.now() + 250),
          actorId: uuidv4(),
        })
      )
      await sleep(300)

      await expect(
        runScheduledPublicationSweep(sweepCore(definitionWithHooks), {
          batchSize: 10,
          budgetMs: 5_000,
        })
      ).resolves.toEqual({ published: 1, failed: 0, workRemaining: false })
      expect(beforeStatusChange).toHaveBeenCalledOnce()
      expect(afterStatusChange).toHaveBeenCalledOnce()
      expect(
        (
          await adapter.queries.documents.getCurrentVersionMetadata({
            collection_id: primary.id,
            document_id: publishedDocument.documentId,
          })
        )?.status
      ).toBe('published')
      await expect(get(publishedDocument)).resolves.toBeNull()
      const audit = await adapter.queries.audit.getDocumentAuditLog({
        document_id: publishedDocument.documentId,
      })
      expect(audit.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'document.status.changed',
            actorRealm: 'system',
            before: 'draft',
            after: 'published',
          }),
        ])
      )
    })
  })
}
