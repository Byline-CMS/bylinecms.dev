/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { randomUUID } from 'node:crypto'

import type {
  ClaimedDocumentPublishSchedule,
  ConfirmDocumentPublishScheduleResult,
  DocumentPublishSchedule,
  DocumentPublishSchedulePage,
  DocumentPublishScheduleState,
  IDocumentPublishScheduleCommands,
  IDocumentPublishScheduleQueries,
  ScheduleDocumentPublishResult,
  SuspendDocumentPublishScheduleResult,
} from '@byline/core'
import { sql } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'

import { affectedRowCount, toDate } from './storage-utils.js'
import type * as schema from '../../database/schema/index.js'
import type { DBManager } from '../../lib/db-manager.js'

type DatabaseConnection = MySql2Database<typeof schema>

const LAST_ERROR_MAX_LENGTH = 2_048

type ScheduleRow = {
  document_id: string
  collection_id: string
  target_version_id: string
  publish_at: string | Date
  state: DocumentPublishScheduleState
  suspended_at: string | Date | null
  suspended_reason: 'content_edited' | null
  scheduled_by: string | null
  last_authorized_by: string | null
  last_authorized_at: string | Date
  scheduled_at: string | Date
  updated_at: string | Date
  execution_token: string | null
  execution_expires_at: string | Date | null
  last_attempt_at: string | Date | null
  next_attempt_at: string | Date
  attempt_count: number | string
  last_error: string | null
}

type ClaimCandidate = {
  document_id: string
  execution_token: string | null
}

function requiredDate(value: string | Date, column: string): Date {
  const date = toDate(value, column)
  if (date === null) throw new Error(`publish schedules: ${column} unexpectedly returned null`)
  return date
}

function toSchedule(row: ScheduleRow): DocumentPublishSchedule {
  return {
    documentId: row.document_id,
    collectionId: row.collection_id,
    targetVersionId: row.target_version_id,
    publishAt: requiredDate(row.publish_at, 'publish_at'),
    state: row.state,
    suspendedAt: toDate(row.suspended_at, 'suspended_at'),
    suspendedReason: row.suspended_reason,
    scheduledBy: row.scheduled_by,
    lastAuthorizedBy: row.last_authorized_by,
    lastAuthorizedAt: requiredDate(row.last_authorized_at, 'last_authorized_at'),
    scheduledAt: requiredDate(row.scheduled_at, 'scheduled_at'),
    updatedAt: requiredDate(row.updated_at, 'updated_at'),
    executionToken: row.execution_token,
    executionExpiresAt: toDate(row.execution_expires_at, 'execution_expires_at'),
    lastAttemptAt: toDate(row.last_attempt_at, 'last_attempt_at'),
    nextAttemptAt: requiredDate(row.next_attempt_at, 'next_attempt_at'),
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error,
  }
}

function resultRows<T>(result: unknown): T[] {
  return (result as [T[], unknown])[0]
}

function firstRow<T>(result: unknown): T | undefined {
  return resultRows<T>(result)[0]
}

function sanitizedError(error: string): string {
  return error
    .replace(/\r?\n[\s\S]*$/, '')
    .trim()
    .slice(0, LAST_ERROR_MAX_LENGTH)
}

/** MySQL scheduled-publication writes on the ambient document transaction. */
export class DocumentPublishScheduleCommands implements IDocumentPublishScheduleCommands {
  constructor(private dbManager: DBManager) {}

  private get db(): DatabaseConnection {
    return this.dbManager.get()
  }

  private async lockCurrentVersion(params: {
    documentId: string
    collectionId: string
  }): Promise<string | null> {
    const document = await this.db.execute(sql`
      SELECT id
      FROM byline_documents
      WHERE id = ${params.documentId}
        AND collection_id = ${params.collectionId}
      FOR UPDATE
    `)
    if (resultRows<{ id: string }>(document).length === 0) return null

    const current = await this.db.execute(sql`
      SELECT id
      FROM byline_document_versions
      WHERE document_id = ${params.documentId}
        AND collection_id = ${params.collectionId}
        AND is_deleted = false
      ORDER BY id DESC
      LIMIT 1
    `)
    return firstRow<{ id: string }>(current)?.id ?? null
  }

  private async lockSchedule(documentId: string): Promise<DocumentPublishSchedule | null> {
    const result = await this.db.execute(sql`
      SELECT *
      FROM byline_document_publish_schedules
      WHERE document_id = ${documentId}
      FOR UPDATE
    `)
    const row = firstRow<ScheduleRow>(result)
    return row === undefined ? null : toSchedule(row)
  }

  private async readSchedule(documentId: string): Promise<DocumentPublishSchedule> {
    const result = await this.db.execute(sql`
      SELECT * FROM byline_document_publish_schedules WHERE document_id = ${documentId}
    `)
    const row = firstRow<ScheduleRow>(result)
    if (row === undefined) throw new Error('publish schedules: schedule row disappeared')
    return toSchedule(row)
  }

  async schedule(params: {
    documentId: string
    collectionId: string
    expectedVersionId: string
    publishAt: Date
    actorId: string | null
  }): Promise<ScheduleDocumentPublishResult> {
    const currentVersionId = await this.lockCurrentVersion(params)
    if (currentVersionId === null) return { status: 'document_not_found' }
    if (currentVersionId !== params.expectedVersionId) return { status: 'version_mismatch' }

    const previous = await this.lockSchedule(params.documentId)
    const validation = await this.db.execute(sql`
      SELECT
        (${params.publishAt} > CURRENT_TIMESTAMP(6)) AS publish_at_is_future,
        (${previous?.executionToken ?? null} IS NOT NULL
          AND ${previous?.executionExpiresAt ?? null} > CURRENT_TIMESTAMP(6)) AS execution_is_live
    `)
    const flags = firstRow<{ publish_at_is_future: number; execution_is_live: number }>(validation)
    if (!flags?.publish_at_is_future) return { status: 'publish_at_not_future' }
    if (flags.execution_is_live) return { status: 'execution_in_progress' }

    if (previous === null) {
      await this.db.execute(sql`
        INSERT INTO byline_document_publish_schedules (
          document_id, collection_id, target_version_id, publish_at,
          state, suspended_at, suspended_reason,
          scheduled_by, last_authorized_by, last_authorized_at,
          execution_token, execution_expires_at, last_attempt_at,
          next_attempt_at, attempt_count, last_error, updated_at
        ) VALUES (
          ${params.documentId},
          ${params.collectionId},
          ${params.expectedVersionId},
          ${params.publishAt},
          'armed', NULL, NULL,
          ${params.actorId}, ${params.actorId}, CURRENT_TIMESTAMP(6),
          NULL, NULL, NULL,
          ${params.publishAt}, 0, NULL, CURRENT_TIMESTAMP(6)
        )
      `)
    } else {
      await this.db.execute(sql`
        UPDATE byline_document_publish_schedules SET
          target_version_id = ${params.expectedVersionId},
          publish_at = ${params.publishAt},
          state = 'armed',
          suspended_at = NULL,
          suspended_reason = NULL,
          last_authorized_by = ${params.actorId},
          last_authorized_at = CURRENT_TIMESTAMP(6),
          execution_token = NULL,
          execution_expires_at = NULL,
          last_attempt_at = NULL,
          next_attempt_at = ${params.publishAt},
          attempt_count = 0,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP(6)
        WHERE document_id = ${params.documentId}
      `)
    }

    return { status: 'scheduled', schedule: await this.readSchedule(params.documentId), previous }
  }

  async confirm(params: {
    documentId: string
    collectionId: string
    expectedVersionId: string
    actorId: string | null
  }): Promise<ConfirmDocumentPublishScheduleResult> {
    const currentVersionId = await this.lockCurrentVersion(params)
    if (currentVersionId === null || currentVersionId !== params.expectedVersionId) {
      return { status: 'version_mismatch' }
    }

    const previous = await this.lockSchedule(params.documentId)
    if (previous === null || previous.collectionId !== params.collectionId) {
      return { status: 'schedule_not_found' }
    }
    if (previous.state !== 'needs_reconfirm') return { status: 'not_suspended' }

    await this.db.execute(sql`
      UPDATE byline_document_publish_schedules SET
        target_version_id = ${params.expectedVersionId},
        state = 'armed',
        suspended_at = NULL,
        suspended_reason = NULL,
        last_authorized_by = ${params.actorId},
        last_authorized_at = CURRENT_TIMESTAMP(6),
        execution_token = NULL,
        execution_expires_at = NULL,
        last_attempt_at = NULL,
        next_attempt_at = publish_at,
        attempt_count = 0,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP(6)
      WHERE document_id = ${params.documentId}
    `)
    return {
      status: 'confirmed',
      schedule: await this.readSchedule(params.documentId),
      previousTargetVersionId: previous.targetVersionId,
    }
  }

  async cancel(params: {
    documentId: string
    collectionId: string
  }): Promise<DocumentPublishSchedule | null> {
    const locked = await this.lockSchedule(params.documentId)
    if (locked === null || locked.collectionId !== params.collectionId) return null
    const result = await this.db.execute(sql`
      DELETE FROM byline_document_publish_schedules
      WHERE document_id = ${params.documentId}
        AND collection_id = ${params.collectionId}
    `)
    return affectedRowCount(result) === 1 ? locked : null
  }

  async suspendForContentEdit(params: {
    documentId: string
    collectionId: string
  }): Promise<SuspendDocumentPublishScheduleResult> {
    const locked = await this.lockSchedule(params.documentId)
    if (locked === null || locked.collectionId !== params.collectionId) {
      return { status: 'schedule_not_found' }
    }
    if (locked.state === 'needs_reconfirm') return { status: 'already_suspended' }

    await this.db.execute(sql`
      UPDATE byline_document_publish_schedules SET
        state = 'needs_reconfirm',
        suspended_at = CURRENT_TIMESTAMP(6),
        suspended_reason = 'content_edited',
        execution_token = NULL,
        execution_expires_at = NULL,
        updated_at = CURRENT_TIMESTAMP(6)
      WHERE document_id = ${params.documentId}
    `)
    return { status: 'suspended', schedule: await this.readSchedule(params.documentId) }
  }

  async claimDue(params: {
    batchSize: number
    leaseMs: number
  }): Promise<ClaimedDocumentPublishSchedule[]> {
    const batchSize = Math.max(0, Math.trunc(params.batchSize))
    if (batchSize === 0) return []

    return this.db.transaction(
      async (tx) => {
        const selected = await tx.execute(sql`
          SELECT document_id, execution_token
          FROM byline_document_publish_schedules
          WHERE state = 'armed'
            AND publish_at <= CURRENT_TIMESTAMP(6)
            AND next_attempt_at <= CURRENT_TIMESTAMP(6)
            AND (execution_expires_at IS NULL OR execution_expires_at <= CURRENT_TIMESTAMP(6))
          ORDER BY publish_at, document_id
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        `)
        const candidates = resultRows<ClaimCandidate>(selected)
        const claimed: ClaimedDocumentPublishSchedule[] = []

        for (const candidate of candidates) {
          const token = randomUUID()
          const update = await tx.execute(sql`
            UPDATE byline_document_publish_schedules SET
              execution_token = ${token},
              execution_expires_at = TIMESTAMPADD(
                MICROSECOND,
                ${params.leaseMs} * 1000,
                CURRENT_TIMESTAMP(6)
              ),
              last_attempt_at = CURRENT_TIMESTAMP(6),
              attempt_count = attempt_count + 1,
              updated_at = CURRENT_TIMESTAMP(6)
            WHERE document_id = ${candidate.document_id}
          `)
          if (affectedRowCount(update) !== 1) {
            throw new Error(`publish schedules: locked row '${candidate.document_id}' disappeared`)
          }

          const reread = await tx.execute(sql`
            SELECT *
            FROM byline_document_publish_schedules
            WHERE document_id = ${candidate.document_id}
          `)
          const row = firstRow<ScheduleRow>(reread)
          if (row === undefined) {
            throw new Error(`publish schedules: claimed row '${candidate.document_id}' disappeared`)
          }
          const schedule = toSchedule(row)
          if (
            schedule.executionToken === null ||
            schedule.executionExpiresAt === null ||
            schedule.lastAttemptAt === null
          ) {
            throw new Error('publish schedules: claimed row returned without its execution fence')
          }
          claimed.push({
            ...schedule,
            executionToken: schedule.executionToken,
            executionExpiresAt: schedule.executionExpiresAt,
            lastAttemptAt: schedule.lastAttemptAt,
            databaseNow: schedule.lastAttemptAt,
            recoveredExpiredClaim: candidate.execution_token !== null,
          })
        }

        return claimed
      },
      { isolationLevel: 'read committed' }
    )
  }

  async lockClaim(params: {
    documentId: string
    executionToken: string
  }): Promise<DocumentPublishSchedule | null> {
    const result = await this.db.execute(sql`
      SELECT *
      FROM byline_document_publish_schedules
      WHERE document_id = ${params.documentId}
        AND execution_token = ${params.executionToken}
      FOR UPDATE
    `)
    const row = firstRow<ScheduleRow>(result)
    return row === undefined ? null : toSchedule(row)
  }

  async deleteClaim(params: { documentId: string; executionToken: string }): Promise<boolean> {
    const result = await this.db.execute(sql`
      DELETE FROM byline_document_publish_schedules
      WHERE document_id = ${params.documentId}
        AND execution_token = ${params.executionToken}
    `)
    return affectedRowCount(result) === 1
  }

  async suspendClaimForContentEdit(params: {
    documentId: string
    executionToken: string
  }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE byline_document_publish_schedules SET
        state = 'needs_reconfirm',
        suspended_at = CURRENT_TIMESTAMP(6),
        suspended_reason = 'content_edited',
        execution_token = NULL,
        execution_expires_at = NULL,
        last_attempt_at = NULL,
        next_attempt_at = publish_at,
        attempt_count = 0,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP(6)
      WHERE document_id = ${params.documentId}
        AND execution_token = ${params.executionToken}
    `)
    return affectedRowCount(result) === 1
  }

  /**
   * `attempt_count` is read but not assigned, so MySQL's left-to-right SET
   * evaluation cannot shift the backoff sequence. If it is ever assigned in
   * this statement, keep `next_attempt_at` before that assignment.
   */
  async releaseClaim(params: {
    documentId: string
    executionToken: string
    error: string
  }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE byline_document_publish_schedules SET
        execution_token = NULL,
        execution_expires_at = NULL,
        last_error = ${sanitizedError(params.error)},
        next_attempt_at = TIMESTAMPADD(
          MINUTE,
          CASE attempt_count
            WHEN 1 THEN 1
            WHEN 2 THEN 2
            WHEN 3 THEN 4
            WHEN 4 THEN 8
            ELSE 15
          END,
          CURRENT_TIMESTAMP(6)
        ),
        updated_at = CURRENT_TIMESTAMP(6)
      WHERE document_id = ${params.documentId}
        AND execution_token = ${params.executionToken}
    `)
    return affectedRowCount(result) === 1
  }
}

/** MySQL scheduled-publication reads. */
export class DocumentPublishScheduleQueries implements IDocumentPublishScheduleQueries {
  constructor(private db: DatabaseConnection) {}

  async get(params: {
    documentId: string
    collectionId: string
  }): Promise<DocumentPublishSchedule | null> {
    const result = await this.db.execute(sql`
      SELECT *
      FROM byline_document_publish_schedules
      WHERE document_id = ${params.documentId}
        AND collection_id = ${params.collectionId}
    `)
    const row = firstRow<ScheduleRow>(result)
    return row === undefined ? null : toSchedule(row)
  }

  async list(params: {
    collectionIds: readonly string[]
    states?: readonly DocumentPublishScheduleState[]
    lastAuthorizedBy?: string
    page: number
    pageSize: number
  }): Promise<DocumentPublishSchedulePage> {
    if (params.collectionIds.length === 0) return { schedules: [], total: 0 }

    const collectionList = sql.join(
      params.collectionIds.map((id) => sql`${id}`),
      sql`, `
    )
    const statePredicate =
      params.states === undefined
        ? sql``
        : params.states.length === 0
          ? sql`AND false`
          : sql`AND state IN (${sql.join(
              params.states.map((state) => sql`${state}`),
              sql`, `
            )})`
    const actorPredicate =
      params.lastAuthorizedBy === undefined
        ? sql``
        : sql`AND last_authorized_by = ${params.lastAuthorizedBy}`
    const offset = Math.max(0, (params.page - 1) * params.pageSize)
    const pageSize = Math.max(0, Math.trunc(params.pageSize))

    const count = await this.db.execute(sql`
      SELECT count(*) AS total
      FROM byline_document_publish_schedules
      WHERE collection_id IN (${collectionList})
      ${statePredicate}
      ${actorPredicate}
    `)
    const total = Number(firstRow<{ total: number | string }>(count)?.total ?? 0)
    if (pageSize === 0 || total === 0) return { schedules: [], total }

    const rows = await this.db.execute(sql`
      SELECT *
      FROM byline_document_publish_schedules
      WHERE collection_id IN (${collectionList})
      ${statePredicate}
      ${actorPredicate}
      ORDER BY publish_at, document_id
      LIMIT ${pageSize}
      OFFSET ${offset}
    `)
    return { schedules: resultRows<ScheduleRow>(rows).map(toSchedule), total }
  }
}
