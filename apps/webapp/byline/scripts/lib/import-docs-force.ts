export interface ImportDocsForceConnection {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[]
  ): Promise<{ rows: Row[] }>
  release(destroy?: boolean | Error): void
}

export interface ImportDocsForceDatabase {
  connect(): Promise<ImportDocsForceConnection>
}

interface VersionSnapshot {
  versionId: string
  status: string | null
}

interface StagedDeletedDocument {
  documentId: string
  versions: VersionSnapshot[]
}

export interface RecoveredDeletedDocument<T> {
  documentId: string
  value: T
}

function parseVersionSnapshot(value: unknown): VersionSnapshot[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('import-docs: deleted document staging returned no version snapshot')
  }
  return value.map((entry) => {
    if (
      entry == null ||
      typeof entry !== 'object' ||
      typeof (entry as { version_id?: unknown }).version_id !== 'string'
    ) {
      throw new Error('import-docs: deleted document staging returned an invalid version snapshot')
    }
    const status = (entry as { status?: unknown }).status
    if (status !== null && typeof status !== 'string') {
      throw new Error('import-docs: deleted document staging returned an invalid version status')
    }
    return {
      versionId: (entry as { version_id: string }).version_id,
      status,
    }
  })
}

async function stageDeletedDocumentAtPath(
  database: ImportDocsForceConnection,
  collectionId: string,
  locale: string,
  path: string
): Promise<StagedDeletedDocument | null> {
  const staged = await database.query<{
    document_id: string
    version_snapshot: unknown
  }>(
    `WITH occupant AS (
       SELECT document_id
         FROM byline_document_paths
        WHERE collection_id = $1 AND locale = $2 AND path = $3
        LIMIT 1
     ), eligible AS (
       SELECT o.document_id
         FROM occupant o
        WHERE NOT EXISTS (
          SELECT 1
            FROM byline_document_versions live
           WHERE live.document_id = o.document_id AND live.is_deleted = false
        )
     ), snapshot AS MATERIALIZED (
       SELECT v.document_id,
              jsonb_agg(
                jsonb_build_object('version_id', v.id::text, 'status', v.status)
                ORDER BY v.id
              ) AS version_snapshot
         FROM byline_document_versions v
         JOIN eligible e ON e.document_id = v.document_id
        GROUP BY v.document_id
     ), latest_deleted AS (
       SELECT v.id, v.document_id
         FROM byline_document_versions v
         JOIN eligible e ON e.document_id = v.document_id
        WHERE v.is_deleted = true
        ORDER BY v.id DESC
        LIMIT 1
     ), staged AS (
       UPDATE byline_document_versions v
          SET is_deleted = false, status = 'draft'
         FROM latest_deleted latest
        WHERE v.id = latest.id AND v.is_deleted = true
        RETURNING v.document_id
     )
     SELECT staged.document_id, snapshot.version_snapshot
       FROM staged
       JOIN snapshot ON snapshot.document_id = staged.document_id`,
    [collectionId, locale, path]
  )
  const row = staged.rows[0]
  return row == null
    ? null
    : {
        documentId: row.document_id,
        versions: parseVersionSnapshot(row.version_snapshot),
      }
}

function snapshotJson(staged: StagedDeletedDocument): string {
  return JSON.stringify(
    staged.versions.map((version) => ({ id: version.versionId, status: version.status }))
  )
}

async function restorePreExistingVersions(
  database: ImportDocsForceConnection,
  staged: StagedDeletedDocument
): Promise<void> {
  const restored = await database.query<{ id: string }>(
    `WITH snapshot AS (
       SELECT entry.id, entry.status
         FROM jsonb_to_recordset($2::jsonb) AS entry(id uuid, status text)
     ), restored AS (
       UPDATE byline_document_versions v
          SET is_deleted = true, status = snapshot.status
         FROM snapshot
        WHERE v.document_id = $1 AND v.id = snapshot.id
        RETURNING v.id
     )
     SELECT id FROM restored`,
    [staged.documentId, snapshotJson(staged)]
  )
  if (restored.rows.length !== staged.versions.length) {
    throw new Error(
      `import-docs: failed to restore every historical version of '${staged.documentId}'`
    )
  }
}

async function restoreDeletedState(
  database: ImportDocsForceConnection,
  staged: StagedDeletedDocument
): Promise<void> {
  const restored = await database.query<{ kind: 'existing' | 'new'; id: string }>(
    `WITH snapshot AS (
       SELECT entry.id, entry.status
         FROM jsonb_to_recordset($2::jsonb) AS entry(id uuid, status text)
     ), restored_existing AS (
       UPDATE byline_document_versions v
          SET is_deleted = true, status = snapshot.status
         FROM snapshot
        WHERE v.document_id = $1 AND v.id = snapshot.id
        RETURNING v.id
     ), tombstoned_new AS (
       UPDATE byline_document_versions v
          SET is_deleted = true
        WHERE v.document_id = $1
          AND NOT EXISTS (SELECT 1 FROM snapshot WHERE snapshot.id = v.id)
        RETURNING v.id
     )
     SELECT 'existing'::text AS kind, id FROM restored_existing
     UNION ALL
     SELECT 'new'::text AS kind, id FROM tombstoned_new`,
    [staged.documentId, snapshotJson(staged)]
  )
  const existingCount = restored.rows.filter((row) => row.kind === 'existing').length
  if (existingCount !== staged.versions.length) {
    throw new Error(
      `import-docs: failed to re-tombstone every historical version of '${staged.documentId}'`
    )
  }
}

async function withForceRecoveryLock<T>(
  database: ImportDocsForceDatabase,
  lockKey: string,
  operation: (connection: ImportDocsForceConnection) => Promise<T>
): Promise<T> {
  const connection = await database.connect()
  let lockAcquired = false
  let value: T | undefined
  let operationError: unknown
  let unlockError: unknown

  try {
    await connection.query('SELECT pg_advisory_lock(hashtextextended($1, 0)) AS locked', [lockKey])
    lockAcquired = true
    value = await operation(connection)
  } catch (error) {
    operationError = error
  } finally {
    if (lockAcquired) {
      try {
        const unlocked = await connection.query<{ unlocked: boolean }>(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked',
          [lockKey]
        )
        if (unlocked.rows[0]?.unlocked !== true) {
          unlockError = new Error(
            'import-docs: force recovery advisory lock was not held at release'
          )
        }
      } catch (error) {
        unlockError = error
      }
    }

    // A failed unlock must destroy the physical pooled session; returning it to
    // the pool could leave a session advisory lock attached to an unrelated job.
    connection.release(unlockError == null ? undefined : true)
  }

  if (operationError != null && unlockError != null) {
    throw new AggregateError(
      [operationError, unlockError],
      'import-docs: force recovery and advisory-lock release both failed'
    )
  }
  if (operationError != null) throw operationError
  if (unlockError != null) throw unlockError
  return value as T
}

/**
 * Temporarily expose one tombstoned version as a non-published update base.
 * All pre-existing statuses are restored after publish auto-archive runs. On
 * failure, versions created since the snapshot are re-tombstoned before the
 * caller reconciles cache/search side effects.
 *
 * The advisory lock serializes this maintenance command with other force
 * imports for the same path. Ordinary lifecycle writers do not take that lock,
 * so operators must still run force recovery as maintenance work without
 * concurrent editorial writes. Without a durable operation id on version rows,
 * compensation can distinguish pre-existing rows from later rows, but cannot
 * safely distinguish its own later rows from a concurrent editor's.
 */
export async function replaceDeletedDocumentAtPath<T>(
  database: ImportDocsForceDatabase,
  params: { collectionId: string; locale: string; path: string },
  replace: (documentId: string) => Promise<T>,
  reconcileDeleted: (documentId: string) => Promise<void>
): Promise<RecoveredDeletedDocument<T> | null> {
  const lockKey = `${params.collectionId}\u0000${params.locale}\u0000${params.path}`
  return withForceRecoveryLock(database, lockKey, async (connection) => {
    const staged = await stageDeletedDocumentAtPath(
      connection,
      params.collectionId,
      params.locale,
      params.path
    )
    if (staged == null) return null

    try {
      const value = await replace(staged.documentId)
      await restorePreExistingVersions(connection, staged)
      return { documentId: staged.documentId, value }
    } catch (error) {
      try {
        await restoreDeletedState(connection, staged)
      } catch (compensationError) {
        throw new AggregateError(
          [error, compensationError],
          `import-docs: replacement and deleted-state compensation both failed for '${params.path}'`
        )
      }

      try {
        await reconcileDeleted(staged.documentId)
      } catch (reconciliationError) {
        throw new AggregateError(
          [error, reconciliationError],
          `import-docs: replacement failed and deleted-state side-effect reconciliation also failed for '${params.path}'`
        )
      }
      throw error
    }
  })
}
