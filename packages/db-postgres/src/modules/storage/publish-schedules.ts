/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

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
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import type * as schema from '../../database/schema/index.js'
import type { DBManager } from '../../lib/db-manager.js'

type DatabaseConnection = NodePgDatabase<typeof schema>

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
  attempt_count: number
  last_error: string | null
}

type ClaimRow = ScheduleRow & {
  database_now: string | Date
  recovered_expired_claim: boolean
}

function requiredDate(value: string | Date, column: string): Date {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`publish schedules: failed to parse ${column} timestamp '${String(value)}'`)
  }
  return date
}

function optionalDate(value: string | Date | null, column: string): Date | null {
  return value === null ? null : requiredDate(value, column)
}

function toSchedule(row: ScheduleRow): DocumentPublishSchedule {
  return {
    documentId: row.document_id,
    collectionId: row.collection_id,
    targetVersionId: row.target_version_id,
    publishAt: requiredDate(row.publish_at, 'publish_at'),
    state: row.state,
    suspendedAt: optionalDate(row.suspended_at, 'suspended_at'),
    suspendedReason: row.suspended_reason,
    scheduledBy: row.scheduled_by,
    lastAuthorizedBy: row.last_authorized_by,
    lastAuthorizedAt: requiredDate(row.last_authorized_at, 'last_authorized_at'),
    scheduledAt: requiredDate(row.scheduled_at, 'scheduled_at'),
    updatedAt: requiredDate(row.updated_at, 'updated_at'),
    executionToken: row.execution_token,
    executionExpiresAt: optionalDate(row.execution_expires_at, 'execution_expires_at'),
    lastAttemptAt: optionalDate(row.last_attempt_at, 'last_attempt_at'),
    nextAttemptAt: requiredDate(row.next_attempt_at, 'next_attempt_at'),
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error,
  }
}

function firstRow<T>(result: { rows: T[] }): T | undefined {
  return result.rows[0]
}

function sanitizedError(error: string): string {
  return error
    .replace(/\r?\n[\s\S]*$/, '')
    .trim()
    .slice(0, LAST_ERROR_MAX_LENGTH)
}

/** Postgres scheduled-publication writes on the ambient document transaction. */
export class DocumentPublishScheduleCommands implements IDocumentPublishScheduleCommands {
  constructor(private dbManager: DBManager) {}

  private get db(): DatabaseConnection {
    return this.dbManager.get()
  }

  private async lockCurrentVersion(params: {
    documentId: string
    collectionId: string
  }): Promise<string | null> {
    const document = await this.db.execute<{ id: string }>(sql`
      SELECT id
      FROM byline_documents
      WHERE id = ${params.documentId}::uuid
        AND collection_id = ${params.collectionId}::uuid
      FOR UPDATE
    `)
    if (document.rows.length === 0) return null

    const current = await this.db.execute<{ id: string }>(sql`
      SELECT id
      FROM byline_document_versions
      WHERE document_id = ${params.documentId}::uuid
        AND collection_id = ${params.collectionId}::uuid
        AND is_deleted = false
      ORDER BY id DESC
      LIMIT 1
    `)
    return firstRow(current)?.id ?? null
  }

  private async lockSchedule(documentId: string): Promise<DocumentPublishSchedule | null> {
    const result = await this.db.execute<ScheduleRow>(sql`
      SELECT *
      FROM byline_document_publish_schedules
      WHERE document_id = ${documentId}::uuid
      FOR UPDATE
    `)
    const row = firstRow(result)
    return row === undefined ? null : toSchedule(row)
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
    const validation = await this.db.execute<{
      publish_at_is_future: boolean
      execution_is_live: boolean
    }>(sql`
      SELECT
        (${params.publishAt}::timestamptz > now()) AS publish_at_is_future,
        (${previous?.executionToken ?? null}::text IS NOT NULL
          AND ${previous?.executionExpiresAt ?? null}::timestamptz > now()) AS execution_is_live
    `)
    const flags = firstRow(validation)
    if (!flags?.publish_at_is_future) return { status: 'publish_at_not_future' }
    if (flags.execution_is_live) return { status: 'execution_in_progress' }

    const result =
      previous === null
        ? await this.db.execute<ScheduleRow>(sql`
            INSERT INTO byline_document_publish_schedules (
              document_id, collection_id, target_version_id, publish_at,
              state, suspended_at, suspended_reason,
              scheduled_by, last_authorized_by, last_authorized_at,
              execution_token, execution_expires_at, last_attempt_at,
              next_attempt_at, attempt_count, last_error, updated_at
            ) VALUES (
              ${params.documentId}::uuid,
              ${params.collectionId}::uuid,
              ${params.expectedVersionId}::uuid,
              ${params.publishAt}::timestamptz,
              'armed', NULL, NULL,
              ${params.actorId}::uuid, ${params.actorId}::uuid, now(),
              NULL, NULL, NULL,
              ${params.publishAt}::timestamptz, 0, NULL, now()
            )
            RETURNING *
          `)
        : await this.db.execute<ScheduleRow>(sql`
            UPDATE byline_document_publish_schedules SET
              target_version_id = ${params.expectedVersionId}::uuid,
              publish_at = ${params.publishAt}::timestamptz,
              state = 'armed',
              suspended_at = NULL,
              suspended_reason = NULL,
              last_authorized_by = ${params.actorId}::uuid,
              last_authorized_at = now(),
              execution_token = NULL,
              execution_expires_at = NULL,
              last_attempt_at = NULL,
              next_attempt_at = ${params.publishAt}::timestamptz,
              attempt_count = 0,
              last_error = NULL,
              updated_at = now()
            WHERE document_id = ${params.documentId}::uuid
            RETURNING *
          `)

    const row = firstRow(result)
    if (row === undefined) throw new Error('publish schedules: schedule row disappeared')
    return { status: 'scheduled', schedule: toSchedule(row), previous }
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

    const result = await this.db.execute<ScheduleRow>(sql`
      UPDATE byline_document_publish_schedules SET
        target_version_id = ${params.expectedVersionId}::uuid,
        state = 'armed',
        suspended_at = NULL,
        suspended_reason = NULL,
        last_authorized_by = ${params.actorId}::uuid,
        last_authorized_at = now(),
        execution_token = NULL,
        execution_expires_at = NULL,
        last_attempt_at = NULL,
        next_attempt_at = publish_at,
        attempt_count = 0,
        last_error = NULL,
        updated_at = now()
      WHERE document_id = ${params.documentId}::uuid
      RETURNING *
    `)
    const row = firstRow(result)
    if (row === undefined) throw new Error('publish schedules: confirm row disappeared')
    return {
      status: 'confirmed',
      schedule: toSchedule(row),
      previousTargetVersionId: previous.targetVersionId,
    }
  }

  async cancel(params: {
    documentId: string
    collectionId: string
  }): Promise<DocumentPublishSchedule | null> {
    const locked = await this.lockSchedule(params.documentId)
    if (locked === null || locked.collectionId !== params.collectionId) return null
    const result = await this.db.execute<ScheduleRow>(sql`
      DELETE FROM byline_document_publish_schedules
      WHERE document_id = ${params.documentId}::uuid
        AND collection_id = ${params.collectionId}::uuid
      RETURNING *
    `)
    const row = firstRow(result)
    return row === undefined ? null : toSchedule(row)
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

    const result = await this.db.execute<ScheduleRow>(sql`
      UPDATE byline_document_publish_schedules SET
        state = 'needs_reconfirm',
        suspended_at = now(),
        suspended_reason = 'content_edited',
        execution_token = NULL,
        execution_expires_at = NULL,
        updated_at = now()
      WHERE document_id = ${params.documentId}::uuid
      RETURNING *
    `)
    const row = firstRow(result)
    if (row === undefined) throw new Error('publish schedules: suspend row disappeared')
    return { status: 'suspended', schedule: toSchedule(row) }
  }

  async claimDue(params: {
    batchSize: number
    leaseMs: number
  }): Promise<ClaimedDocumentPublishSchedule[]> {
    const batchSize = Math.max(0, Math.trunc(params.batchSize))
    if (batchSize === 0) return []

    const result = await this.db.execute<ClaimRow>(sql`
      WITH candidates AS (
        SELECT document_id, execution_token, execution_expires_at
        FROM byline_document_publish_schedules
        WHERE state = 'armed'
          AND publish_at <= now()
          AND next_attempt_at <= now()
          AND (execution_expires_at IS NULL OR execution_expires_at <= now())
        ORDER BY publish_at, document_id
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE byline_document_publish_schedules schedule SET
        execution_token = gen_random_uuid(),
        execution_expires_at = now() + make_interval(secs => ${params.leaseMs} / 1000.0),
        last_attempt_at = now(),
        attempt_count = schedule.attempt_count + 1,
        updated_at = now()
      FROM candidates
      WHERE schedule.document_id = candidates.document_id
      RETURNING
        schedule.*,
        schedule.last_attempt_at AS database_now,
        (candidates.execution_token IS NOT NULL) AS recovered_expired_claim
    `)

    return result.rows.map((row) => {
      const schedule = toSchedule(row)
      if (
        schedule.executionToken === null ||
        schedule.executionExpiresAt === null ||
        schedule.lastAttemptAt === null
      ) {
        throw new Error('publish schedules: claimed row returned without its execution fence')
      }
      return {
        ...schedule,
        executionToken: schedule.executionToken,
        executionExpiresAt: schedule.executionExpiresAt,
        lastAttemptAt: schedule.lastAttemptAt,
        databaseNow: requiredDate(row.database_now, 'database_now'),
        recoveredExpiredClaim: row.recovered_expired_claim,
      }
    })
  }

  async lockClaim(params: {
    documentId: string
    executionToken: string
  }): Promise<DocumentPublishSchedule | null> {
    const result = await this.db.execute<ScheduleRow>(sql`
      SELECT *
      FROM byline_document_publish_schedules
      WHERE document_id = ${params.documentId}::uuid
        AND execution_token::text = ${params.executionToken}
      FOR UPDATE
    `)
    const row = firstRow(result)
    return row === undefined ? null : toSchedule(row)
  }

  async deleteClaim(params: { documentId: string; executionToken: string }): Promise<boolean> {
    const result = await this.db.execute(sql`
      DELETE FROM byline_document_publish_schedules
      WHERE document_id = ${params.documentId}::uuid
        AND execution_token::text = ${params.executionToken}
    `)
    return result.rowCount === 1
  }

  async suspendClaimForContentEdit(params: {
    documentId: string
    executionToken: string
  }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE byline_document_publish_schedules SET
        state = 'needs_reconfirm',
        suspended_at = now(),
        suspended_reason = 'content_edited',
        execution_token = NULL,
        execution_expires_at = NULL,
        last_attempt_at = NULL,
        next_attempt_at = publish_at,
        attempt_count = 0,
        last_error = NULL,
        updated_at = now()
      WHERE document_id = ${params.documentId}::uuid
        AND execution_token::text = ${params.executionToken}
    `)
    return result.rowCount === 1
  }

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
        next_attempt_at = now() + CASE
          WHEN attempt_count = 1 THEN interval '1 minute'
          WHEN attempt_count = 2 THEN interval '2 minutes'
          WHEN attempt_count = 3 THEN interval '4 minutes'
          WHEN attempt_count = 4 THEN interval '8 minutes'
          ELSE interval '15 minutes'
        END,
        updated_at = now()
      WHERE document_id = ${params.documentId}::uuid
        AND execution_token::text = ${params.executionToken}
    `)
    return result.rowCount === 1
  }
}

/** Postgres scheduled-publication reads. */
export class DocumentPublishScheduleQueries implements IDocumentPublishScheduleQueries {
  constructor(private db: DatabaseConnection) {}

  async get(params: {
    documentId: string
    collectionId: string
  }): Promise<DocumentPublishSchedule | null> {
    const result = await this.db.execute<ScheduleRow>(sql`
      SELECT *
      FROM byline_document_publish_schedules
      WHERE document_id = ${params.documentId}::uuid
        AND collection_id = ${params.collectionId}::uuid
    `)
    const row = firstRow(result)
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
      params.collectionIds.map((id) => sql`${id}::uuid`),
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
        : sql`AND last_authorized_by::text = ${params.lastAuthorizedBy}`
    const offset = Math.max(0, (params.page - 1) * params.pageSize)
    const pageSize = Math.max(0, Math.trunc(params.pageSize))

    const count = await this.db.execute<{ total: string }>(sql`
      SELECT count(*)::text AS total
      FROM byline_document_publish_schedules
      WHERE collection_id IN (${collectionList})
      ${statePredicate}
      ${actorPredicate}
    `)
    const total = Number(firstRow(count)?.total ?? 0)
    if (pageSize === 0 || total === 0) return { schedules: [], total }

    const rows = await this.db.execute<ScheduleRow>(sql`
      SELECT *
      FROM byline_document_publish_schedules
      WHERE collection_id IN (${collectionList})
      ${statePredicate}
      ${actorPredicate}
      ORDER BY publish_at, document_id
      LIMIT ${pageSize}
      OFFSET ${offset}
    `)
    return { schedules: rows.rows.map(toSchedule), total }
  }
}
