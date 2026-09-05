/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type CollectionDefinition,
  type DocumentRevisionReceipt,
  ERR_NOT_FOUND,
  ERR_VALIDATION,
  type IDbAdapter,
  parseDocumentRevision,
} from '@byline/core'
import { and, desc, eq } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from './database/schema/index.js'
import { documentVersions } from './database/schema/index.js'
import { DBManagerImpl, TXManagerImpl } from './lib/db-manager.js'
import { createAuditCommands } from './modules/audit/audit-commands.js'
import { createAuditQueries } from './modules/audit/audit-queries.js'
import { createCounterCommands } from './modules/counters/counters-commands.js'
import { createSchedulerStore } from './modules/scheduler/scheduler-store.js'
import { classifyError } from './modules/storage/classify-error.js'
import { DocumentRevisions } from './modules/storage/document-revisions.js'
import { createReadSnapshot } from './modules/storage/read-snapshot.js'
import { SingletonCommands, SingletonQueries } from './modules/storage/singletons.js'
import {
  createCommandBuilders,
  type ReAnchorReport,
  type ReAnchorResult,
} from './modules/storage/storage-commands.js'
import { createQueryBuilders } from './modules/storage/storage-queries.js'

export type {
  ReAnchorReport,
  ReAnchorResult,
  ReAnchorStatus,
} from './modules/storage/storage-commands.js'

/**
 * Public return type of `pgAdapter`. Extends `IDbAdapter` with concrete
 * Drizzle + pg handles so integrations that need the raw database (the
 * session provider, housekeeping scripts, migration tooling) don't have
 * to construct a second connection pool.
 *
 * Consumers that only need the adapter contract can still annotate as
 * `IDbAdapter` and ignore the extra properties.
 */
export interface PgAdapter extends IDbAdapter {
  /** The underlying Drizzle instance typed against the full schema. */
  drizzle: NodePgDatabase<typeof schema>
  /** The pg connection pool — exposed for housekeeping and teardown. */
  pool: pg.Pool
  /**
   * One-time maintenance: populate the version-locale availability ledger
   * (`byline_document_version_locales`) for versions written before it
   * existed, so `localeFallback: 'strict'` reads can see pre-existing
   * documents. Idempotent; uses the configured default content locale. Kept
   * off the core `IDbAdapter` contract (no service depends on it) — see
   * docs/08-internationalization/index.md.
   */
  backfillVersionLocales(): Promise<{ rowsInserted: number }>
  /**
   * One-time maintenance: stamp `byline_documents.source_locale` for documents
   * created before the column existed, setting NULL rows to the configured
   * default content locale (the anchor they were implicitly authored against).
   * Idempotent; run automatically at boot by `initBylineCore` (also exposed on
   * the core `IDbAdapter` contract as an optional method) — see
   * docs/08-internationalization/index.md.
   */
  backfillSourceLocales(): Promise<{ rowsUpdated: number }>
  /**
   * Re-anchor a single document's content source locale to `targetLocale`
   * (its fallback floor, path locale, and completeness yardstick). Refuses
   * unless the document is complete in the target. Writes a new immutable
   * version. `dryRun` reports the would-be outcome without writing. Off the
   * core `IDbAdapter` contract (maintenance/admin operation) — see
   * docs/08-internationalization/index.md.
   */
  reAnchorDocument(params: {
    documentId: string
    expectedRevision: number
    targetLocale: string
    dryRun?: boolean
  }): Promise<ReAnchorResult & DocumentRevisionReceipt>
  /**
   * Bulk re-anchor every fully-translated document (optionally within one
   * collection) onto `targetLocale`, skipping and reporting the rest. Each
   * document is its own transaction — idempotent and resumable. This is the
   * "switched the default content locale, move everything that's ready" command.
   */
  reAnchorDocuments(params: {
    targets: readonly { documentId: string; expectedRevision: number }[]
    targetLocale: string
    collectionId?: string
    dryRun?: boolean
  }): Promise<
    Omit<ReAnchorReport, 'results'> & { results: (ReAnchorResult & DocumentRevisionReceipt)[] }
  >
}

export const pgAdapter = ({
  connectionString,
  collections,
  defaultContentLocale,
  max = 20,
  idleTimeoutMillis = 2000,
  connectionTimeoutMillis = 30000,
}: {
  connectionString: string
  collections: readonly CollectionDefinition[]
  /**
   * The installation's default content locale, sourced from
   * `ServerConfig.i18n.content.defaultLocale`. Used by the storage layer as
   * the **fallback** anchor only: new documents are stamped with it as their
   * `source_locale`, and it is the floor for row-less lookups (findByPath) and
   * for documents whose `source_locale` is not yet backfilled. Per-document
   * reads and writes otherwise re-base onto each document's own `source_locale`
   * (carried on the current-documents views), so changing this value does not
   * re-interpret existing data. See docs/08-internationalization/index.md.
   */
  defaultContentLocale: string
  /**
   * Maximum number of clients in the pg connection pool. Defaults to 20.
   * Tune via `BYLINE_DB_POSTGRES_MAX_POOL` in the host app.
   */
  max?: number
  /**
   * Milliseconds an idle client remains in the pool before being closed.
   * Defaults to 2000. Tune via `BYLINE_DB_POSTGRES_IDLE_TIMEOUT_MILLIS`.
   */
  idleTimeoutMillis?: number
  /**
   * Milliseconds to wait for a new connection before erroring. Defaults
   * to 30000 — long enough to absorb cold starts on serverless Postgres
   * providers like Neon. Tune via
   * `BYLINE_DB_POSTGRES_CONNECTION_TIMEOUT_MILLIS`.
   */
  connectionTimeoutMillis?: number
}): PgAdapter => {
  const pool = new pg.Pool({
    connectionString: connectionString,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
  })

  const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema })

  // Request-scoped transaction propagation (docs/03-architecture/03-transactions.md). The command
  // builders run on the DBManager — each `this.db` access resolves to the
  // ambient transaction when a `withTransaction` boundary is open, else the
  // pool. Queries and counters stay on the raw `db` for now (reads don't need
  // to join the audit transaction); they migrate opportunistically.
  const dbManager = new DBManagerImpl({ dbPool: db })
  const txManager = new TXManagerImpl({ db: dbManager })

  const commandBuilders = createCommandBuilders(dbManager, defaultContentLocale)
  const queryBuilders = createQueryBuilders(db, collections, defaultContentLocale, dbManager)
  const counterCommands = createCounterCommands(db)
  const schedulerStore = createSchedulerStore(db)
  const singletonCommands = new SingletonCommands(dbManager)
  const singletonQueries = new SingletonQueries(dbManager)
  // Audit writes run on the DBManager so they join an ambient `withTransaction`
  // (atomic with the mutation they record); audit reads run on the pool.
  const auditCommands = createAuditCommands(dbManager)
  const auditQueries = createAuditQueries(db)

  const revisions = new DocumentRevisions(dbManager)
  const reAnchorDocument: PgAdapter['reAnchorDocument'] = async (input) => {
    if (revisions.isInTransaction())
      throw ERR_VALIDATION({
        message: 'Maintenance operations own their transaction',
        details: { reason: 'external_lifecycle_transaction' },
      })
    const params = { ...input, expectedRevision: parseDocumentRevision(input.expectedRevision) }
    return txManager.withTransaction(async () => {
      const [current] = await dbManager
        .get()
        .select({ collectionId: documentVersions.collection_id })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.document_id, params.documentId),
            eq(documentVersions.is_deleted, false)
          )
        )
        .orderBy(desc(documentVersions.id))
        .limit(1)
      if (!current) throw ERR_NOT_FOUND({ message: 'Re-anchor target is unavailable' })
      await commandBuilders.collections.lockCollectionRegistration(
        current.collectionId,
        'exclusive'
      )
      const [locked] = await revisions.lock([
        {
          documentId: params.documentId,
          expectedRevision: params.expectedRevision,
          collectionId: current.collectionId,
        },
      ])
      if (!locked) throw new Error('Missing locked maintenance target')
      const result = await commandBuilders.documents.reAnchorDocument(params)
      if (!result.newVersionId) return { ...result, revision: locked.revision }
      if (locked.status === 'published')
        await commandBuilders.documents.archivePublishedVersions({
          document_id: params.documentId,
          excludeVersionId: result.newVersionId,
        })
      await auditCommands.append({
        documentId: params.documentId,
        collectionId: current.collectionId,
        actorId: null,
        actorRealm: 'system',
        action: 'document.source_locale.changed',
        field: 'source_locale',
        before: locked.sourceLocale,
        after: params.targetLocale,
      })
      const suspension = await commandBuilders.documents.publishSchedules.suspendForContentEdit({
        documentId: params.documentId,
        collectionId: current.collectionId,
        reason: 'document_metadata_changed',
      })
      if (suspension.status === 'suspended')
        await auditCommands.append({
          documentId: params.documentId,
          collectionId: current.collectionId,
          actorId: null,
          actorRealm: 'system',
          action: 'document.publish_schedule.suspended',
          field: 'scheduled_publish',
          before: { state: 'armed' },
          after: { state: 'needs_reconfirm', reason: 'document_metadata_changed' },
        })
      return { ...result, revision: (await revisions.advance(locked)).revision }
    })
  }
  const reAnchorDocuments: PgAdapter['reAnchorDocuments'] = async (input) => {
    if (revisions.isInTransaction())
      throw ERR_VALIDATION({
        message: 'Maintenance operations own their transaction',
        details: { reason: 'external_lifecycle_transaction' },
      })
    if (!Array.isArray(input.targets))
      throw ERR_VALIDATION({ message: 'Explicit observed targets are required' })
    const targets = input.targets.map((target) => ({
      documentId: target.documentId,
      expectedRevision: parseDocumentRevision(target.expectedRevision),
    }))
    const report: Awaited<ReturnType<PgAdapter['reAnchorDocuments']>> = {
      targetLocale: input.targetLocale,
      dryRun: input.dryRun ?? false,
      total: targets.length,
      reanchored: 0,
      alreadyAnchored: 0,
      skippedIncomplete: 0,
      notFound: 0,
      results: [],
    }
    for (const target of targets) {
      if (input.collectionId) {
        const scoped = await queryBuilders.documents.getDocumentRevision({
          collection_id: input.collectionId,
          document_id: target.documentId,
        })
        if (scoped == null)
          throw ERR_NOT_FOUND({ message: 'Re-anchor target is outside the selected collection' })
      }
      const result = await reAnchorDocument({
        ...target,
        targetLocale: input.targetLocale,
        dryRun: input.dryRun,
      })
      report.results.push(result)
      if (result.status === 'reanchored') report.reanchored++
      else if (result.status === 'already-anchored') report.alreadyAnchored++
      else if (result.status === 'skipped-incomplete') report.skippedIncomplete++
      else report.notFound++
    }
    return report
  }

  return {
    commands: {
      ...commandBuilders,
      counters: counterCommands,
      audit: auditCommands,
      singletons: singletonCommands,
    },
    queries: {
      ...queryBuilders,
      audit: auditQueries,
      singletons: singletonQueries,
    },
    withTransaction: (fn) => txManager.withTransaction(fn),
    withReadSnapshot: createReadSnapshot(db, collections, defaultContentLocale),
    revisions,
    drizzle: db,
    pool,
    backfillVersionLocales: () => commandBuilders.documents.backfillVersionLocales(),
    backfillSourceLocales: () => commandBuilders.documents.backfillSourceLocales(),
    reAnchorDocument,
    reAnchorDocuments,
    classifyError,
    scheduler: schedulerStore,
  }
}
