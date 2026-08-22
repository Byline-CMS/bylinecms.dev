/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import type { DocumentPublishScheduleInfo } from '@byline/client'
import { getAdminBylineClient, getAdminRequestContext } from '@byline/client/server'
import {
  type DocumentPublishSchedule,
  type DocumentPublishScheduleState,
  ERR_NOT_FOUND,
  ERR_VALIDATION,
  type RecurringTaskHealth,
} from '@byline/core'
import { listDocumentPublishSchedules } from '@byline/core/services'

import { bylineCore } from '../../integrations/byline-core.js'
import { omitScheduleExecutionState } from './scheduled-publication-response.js'
import { serialise } from './utils.js'

const TASK_NAME = 'documents.publish-scheduled'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ScheduledPublicationRuntime {
  enabled: boolean
  health: {
    status: 'healthy' | 'failed' | 'stale' | 'not_started'
    task: SerializedRecurringTaskHealth | null
  } | null
}

type SerializedRecurringTaskHealth = Omit<
  RecurringTaskHealth,
  'nextRunAt' | 'lastStartedAt' | 'lastSucceededAt' | 'lastFailedAt' | 'databaseNow'
> & {
  nextRunAt: string
  lastStartedAt: string | null
  lastSucceededAt: string | null
  lastFailedAt: string | null
  databaseNow: string
}

export type SerializedDocumentPublishSchedule = Omit<
  DocumentPublishScheduleInfo,
  | 'publishAt'
  | 'suspendedAt'
  | 'lastAuthorizedAt'
  | 'scheduledAt'
  | 'updatedAt'
  | 'lastAttemptAt'
  | 'nextAttemptAt'
> & {
  publishAt: string
  suspendedAt: string | null
  lastAuthorizedAt: string
  scheduledAt: string
  updatedAt: string
  lastAttemptAt: string | null
  nextAttemptAt: string
}

export interface ScheduledPublicationListItem extends SerializedDocumentPublishSchedule {
  collectionPath: string
  collectionLabel: string
  documentPath: string | null
}

export interface ScheduledPublicationListResponse {
  schedules: ScheduledPublicationListItem[]
  meta: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  runtime: ScheduledPublicationRuntime
}

function assertFeatureEnabled(): void {
  if (bylineCore().config.scheduledPublication?.enabled === true) return
  throw ERR_NOT_FOUND({ message: 'Scheduled publication is not enabled for this installation' })
}

function serializeSchedule(
  schedule: DocumentPublishScheduleInfo | DocumentPublishSchedule
): SerializedDocumentPublishSchedule {
  return serialise(
    omitScheduleExecutionState(schedule)
  ) as unknown as SerializedDocumentPublishSchedule
}

async function scheduledPublicationRuntime(): Promise<ScheduledPublicationRuntime> {
  const core = bylineCore()
  if (core.config.scheduledPublication?.enabled !== true) {
    return { enabled: false, health: null }
  }

  const scheduler = core.db.scheduler
  if (scheduler == null) {
    return { enabled: true, health: { status: 'not_started', task: null } }
  }
  const [task] = await scheduler.health([TASK_NAME])
  if (task == null) {
    return { enabled: true, health: { status: 'not_started', task: null } }
  }

  const staleAfter = task.nextRunAt.getTime() + task.intervalMs * 2
  const status = task.leaseExpired
    ? 'stale'
    : task.lastStatus === 'failed'
      ? 'failed'
      : staleAfter < task.databaseNow.getTime()
        ? 'stale'
        : 'healthy'
  return {
    enabled: true,
    health: {
      status,
      task: serialise(task) as unknown as SerializedRecurringTaskHealth,
    },
  }
}

/** Authenticated feature discovery for the admin shell and health warning. */
export const getScheduledPublicationRuntime = createServerFn({ method: 'GET' }).handler(
  async () => {
    await getAdminRequestContext()
    return scheduledPublicationRuntime()
  }
)

export const scheduleCollectionDocumentPublish = createServerFn({ method: 'POST' })
  .validator(
    (input: { collection: string; id: string; publishAt: string; expectedVersionId: string }) =>
      input
  )
  .handler(async ({ data }) => {
    assertFeatureEnabled()
    const schedule = await getAdminBylineClient()
      .collection(data.collection)
      .schedulePublish(data.id, {
        publishAt: data.publishAt,
        expectedVersionId: data.expectedVersionId,
      })
    return serializeSchedule(schedule)
  })

export const confirmCollectionDocumentScheduledPublish = createServerFn({ method: 'POST' })
  .validator((input: { collection: string; id: string; expectedVersionId: string }) => input)
  .handler(async ({ data }) => {
    assertFeatureEnabled()
    const schedule = await getAdminBylineClient()
      .collection(data.collection)
      .confirmScheduledPublish(data.id, { expectedVersionId: data.expectedVersionId })
    return serializeSchedule(schedule)
  })

export const cancelCollectionDocumentScheduledPublish = createServerFn({ method: 'POST' })
  .validator((input: { collection: string; id: string }) => input)
  .handler(async ({ data }) => {
    assertFeatureEnabled()
    const schedule = await getAdminBylineClient()
      .collection(data.collection)
      .cancelScheduledPublish(data.id)
    return schedule == null
      ? { status: 'not_found' as const }
      : { status: 'cancelled' as const, schedule: serializeSchedule(schedule) }
  })

export const listScheduledPublications = createServerFn({ method: 'GET' })
  .validator(
    (input: {
      states?: readonly DocumentPublishScheduleState[]
      lastAuthorizedBy?: string
      page?: number
      pageSize?: number
    }) => input
  )
  .handler(async ({ data }) => {
    assertFeatureEnabled()
    if (data.states?.some((state) => state !== 'armed' && state !== 'needs_reconfirm') === true) {
      throw ERR_VALIDATION({ message: 'state must be armed or needs_reconfirm' })
    }
    if (data.lastAuthorizedBy != null && !UUID_RE.test(data.lastAuthorizedBy)) {
      throw ERR_VALIDATION({ message: 'lastAuthorizedBy must be a UUID' })
    }
    const core = bylineCore()
    const page = data.page ?? 1
    const pageSize = data.pageSize ?? 25
    const requestContext = await getAdminRequestContext()
    const result = await listDocumentPublishSchedules(core, requestContext, {
      states: data.states,
      lastAuthorizedBy: data.lastAuthorizedBy,
      page,
      pageSize,
    })
    const collections = new Map(
      core.collections.map((definition) => {
        const record = core.getCollectionRecord(definition.path)
        return [record.collectionId, definition] as const
      })
    )
    const schedules = await Promise.all(
      result.schedules.map(async (schedule): Promise<ScheduledPublicationListItem> => {
        const definition = collections.get(schedule.collectionId)
        const documentPath = await core.db.queries.documents.getCurrentPath({
          collection_id: schedule.collectionId,
          document_id: schedule.documentId,
        })
        return {
          ...serializeSchedule(schedule),
          collectionPath: definition?.path ?? schedule.collectionId,
          collectionLabel: definition?.labels.plural ?? definition?.path ?? schedule.collectionId,
          documentPath,
        }
      })
    )

    return {
      schedules,
      meta: {
        page,
        pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
      },
      runtime: await scheduledPublicationRuntime(),
    } satisfies ScheduledPublicationListResponse
  })
