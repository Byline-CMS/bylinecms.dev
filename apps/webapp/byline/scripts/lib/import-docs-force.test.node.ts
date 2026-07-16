import { describe, expect, it, vi } from 'vitest'

import {
  type ImportDocsForceConnection,
  type ImportDocsForceDatabase,
  importDocsForceLockKey,
  replaceDeletedDocumentAtPath,
} from './import-docs-force.js'

interface VersionState {
  id: string
  documentId: string
  status: string | null
  deleted: boolean
}

interface DatabaseOptions {
  failCompensation?: Error
  failFinalization?: Error
}

function createDatabase(initialVersions: VersionState[], options: DatabaseOptions = {}) {
  const versions = initialVersions.map((version) => ({ ...version }))
  const pathRow = {
    collectionId: 'docs-collection',
    locale: 'en',
    path: 'guide',
    documentId: 'doc-1',
  }
  const events: string[] = []
  let releasedWith: boolean | Error | undefined

  const restoreSnapshot = (json: unknown): Array<{ id: string; status: string | null }> => {
    expect(typeof json).toBe('string')
    return JSON.parse(json as string) as Array<{ id: string; status: string | null }>
  }

  const connection: ImportDocsForceConnection = {
    async query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[]) {
      if (text.includes('pg_advisory_lock')) {
        events.push('lock')
        return { rows: [{ locked: true } as unknown as Row] }
      }
      if (text.includes('pg_advisory_unlock')) {
        events.push('unlock')
        return { rows: [{ unlocked: true } as unknown as Row] }
      }
      if (text.includes('WITH occupant AS')) {
        events.push('stage')
        expect(text).toContain("SET is_deleted = false, status = 'draft'")
        const [collectionId, locale, path] = values
        if (
          collectionId !== pathRow.collectionId ||
          locale !== pathRow.locale ||
          path !== pathRow.path ||
          versions.some((version) => version.documentId === pathRow.documentId && !version.deleted)
        ) {
          return { rows: [] }
        }
        const snapshot = versions
          .filter((version) => version.documentId === pathRow.documentId)
          .map((version) => ({ version_id: version.id, status: version.status }))
        const latest = versions
          .filter((version) => version.documentId === pathRow.documentId && version.deleted)
          .toSorted((left, right) => right.id.localeCompare(left.id))[0]
        if (latest == null) return { rows: [] }
        latest.deleted = false
        latest.status = 'draft'
        return {
          rows: [
            {
              document_id: latest.documentId,
              version_snapshot: snapshot,
            } as unknown as Row,
          ],
        }
      }

      const [documentId, snapshotJson] = values
      const snapshot = restoreSnapshot(snapshotJson)
      if (text.includes('tombstoned_new AS')) {
        events.push('compensate')
        if (options.failCompensation != null) throw options.failCompensation
        const snapshotIds = new Set(snapshot.map((version) => version.id))
        const rows: Array<{ kind: 'existing' | 'new'; id: string }> = []
        for (const saved of snapshot) {
          const version = versions.find(
            (candidate) => candidate.documentId === documentId && candidate.id === saved.id
          )
          if (version == null) continue
          version.deleted = true
          version.status = saved.status
          rows.push({ kind: 'existing', id: version.id })
        }
        for (const version of versions) {
          if (version.documentId !== documentId || snapshotIds.has(version.id)) continue
          version.deleted = true
          rows.push({ kind: 'new', id: version.id })
        }
        return { rows: rows as unknown as Row[] }
      }

      events.push('finalize')
      if (options.failFinalization != null) throw options.failFinalization
      const rows: Array<{ id: string }> = []
      for (const saved of snapshot) {
        const version = versions.find(
          (candidate) => candidate.documentId === documentId && candidate.id === saved.id
        )
        if (version == null) continue
        version.deleted = true
        version.status = saved.status
        rows.push({ id: version.id })
      }
      return { rows: rows as unknown as Row[] }
    },
    release(destroy) {
      events.push('release')
      releasedWith = destroy
    },
  }

  const database: ImportDocsForceDatabase = {
    async connect() {
      events.push('connect')
      return connection
    },
  }

  const publicVersions = () =>
    versions.filter((version) => !version.deleted && version.status === 'published')

  return {
    database,
    events,
    pathRow,
    publicVersions,
    releasedWith: () => releasedWith,
    versions,
  }
}

const params = { collectionId: 'docs-collection', locale: 'en', path: 'guide' }

describe('forced docs replacement', () => {
  it('encodes advisory-lock identities without PostgreSQL-forbidden NUL bytes', () => {
    const key = importDocsForceLockKey(params)

    expect(key).not.toContain(String.fromCharCode(0))
    expect(JSON.parse(key)).toEqual([params.collectionId, params.locale, params.path])
    expect(
      importDocsForceLockKey({ collectionId: 'docs', locale: 'en:guide', path: 'intro' })
    ).not.toBe(importDocsForceLockKey({ collectionId: 'docs:en', locale: 'guide', path: 'intro' }))
  })

  it('keeps old published content hidden while replacing it with a draft', async () => {
    const state = createDatabase([
      { id: '001', documentId: 'doc-1', status: 'archived', deleted: true },
      { id: '002', documentId: 'doc-1', status: 'published', deleted: true },
    ])
    const reconcile = vi.fn()

    const recovered = await replaceDeletedDocumentAtPath(
      state.database,
      params,
      async (documentId) => {
        expect(documentId).toBe(state.pathRow.documentId)
        expect(state.publicVersions()).toEqual([])
        state.versions.push({ id: '003', documentId, status: 'draft', deleted: false })
        return 'updated'
      },
      reconcile
    )

    expect(recovered).toEqual({ documentId: 'doc-1', value: 'updated' })
    expect(state.publicVersions()).toEqual([])
    expect(state.versions).toEqual([
      { id: '001', documentId: 'doc-1', status: 'archived', deleted: true },
      { id: '002', documentId: 'doc-1', status: 'published', deleted: true },
      { id: '003', documentId: 'doc-1', status: 'draft', deleted: false },
    ])
    expect(reconcile).not.toHaveBeenCalled()
    expect(state.events).toEqual(['connect', 'lock', 'stage', 'finalize', 'unlock', 'release'])
    expect(state.releasedWith()).toBeUndefined()
  })

  it('restores every historical status after a successful published replacement', async () => {
    const state = createDatabase([
      { id: '001', documentId: 'doc-1', status: 'published', deleted: true },
      { id: '002', documentId: 'doc-1', status: 'draft', deleted: true },
    ])

    const recovered = await replaceDeletedDocumentAtPath(
      state.database,
      params,
      async (documentId) => {
        // Model changeStatus(..., 'published'): auto-archive currently touches
        // historical published rows as well as live rows.
        for (const version of state.versions) {
          if (version.status === 'published') version.status = 'archived'
        }
        state.versions.push({ id: '003', documentId, status: 'published', deleted: false })
        return 'published'
      },
      vi.fn()
    )

    expect(recovered?.value).toBe('published')
    expect(state.versions).toEqual([
      { id: '001', documentId: 'doc-1', status: 'published', deleted: true },
      { id: '002', documentId: 'doc-1', status: 'draft', deleted: true },
      { id: '003', documentId: 'doc-1', status: 'published', deleted: false },
    ])
    expect(state.publicVersions()).toEqual([
      { id: '003', documentId: 'doc-1', status: 'published', deleted: false },
    ])
  })

  it('compensates and reconciles a failure after a published status commit', async () => {
    const state = createDatabase([
      { id: '001', documentId: 'doc-1', status: 'published', deleted: true },
      { id: '002', documentId: 'doc-1', status: 'draft', deleted: true },
    ])
    const failure = new Error('afterStatusChange failed')
    const reconcile = vi.fn(async () => {
      expect(state.versions.every((version) => version.deleted)).toBe(true)
    })

    await expect(
      replaceDeletedDocumentAtPath(
        state.database,
        params,
        async (documentId) => {
          for (const version of state.versions) {
            if (version.status === 'published') version.status = 'archived'
          }
          state.versions.push({ id: '003', documentId, status: 'published', deleted: false })
          throw failure
        },
        reconcile
      )
    ).rejects.toBe(failure)

    expect(state.versions).toEqual([
      { id: '001', documentId: 'doc-1', status: 'published', deleted: true },
      { id: '002', documentId: 'doc-1', status: 'draft', deleted: true },
      { id: '003', documentId: 'doc-1', status: 'published', deleted: true },
    ])
    expect(reconcile).toHaveBeenCalledWith('doc-1')
    expect(state.events).toContain('compensate')
    expect(state.events.slice(-2)).toEqual(['unlock', 'release'])
  })

  it('compensates and reconciles when successful replacement finalization fails', async () => {
    const finalizationFailure = new Error('finalization failed')
    const state = createDatabase(
      [{ id: '001', documentId: 'doc-1', status: 'published', deleted: true }],
      { failFinalization: finalizationFailure }
    )
    const reconcile = vi.fn()

    await expect(
      replaceDeletedDocumentAtPath(
        state.database,
        params,
        async (documentId) => {
          state.versions.push({ id: '002', documentId, status: 'published', deleted: false })
          return 'updated'
        },
        reconcile
      )
    ).rejects.toBe(finalizationFailure)

    expect(state.versions.every((version) => version.deleted)).toBe(true)
    expect(state.versions[0]?.status).toBe('published')
    expect(reconcile).toHaveBeenCalledWith('doc-1')
    expect(state.events).toEqual([
      'connect',
      'lock',
      'stage',
      'finalize',
      'compensate',
      'unlock',
      'release',
    ])
  })

  it('aggregates reconciliation failure after preserving deleted state', async () => {
    const replacementFailure = new Error('status failed')
    const reconciliationFailure = new Error('deindex failed')
    const state = createDatabase([
      { id: '001', documentId: 'doc-1', status: 'published', deleted: true },
    ])

    let caught: unknown
    try {
      await replaceDeletedDocumentAtPath(
        state.database,
        params,
        async (documentId) => {
          state.versions.push({ id: '002', documentId, status: 'published', deleted: false })
          throw replacementFailure
        },
        async () => {
          throw reconciliationFailure
        }
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([replacementFailure, reconciliationFailure])
    expect(state.versions.every((version) => version.deleted)).toBe(true)
    expect(state.versions[0]?.status).toBe('published')
    expect(state.events.slice(-2)).toEqual(['unlock', 'release'])
  })

  it('aggregates compensation failure and still releases the advisory lock', async () => {
    const replacementFailure = new Error('update failed')
    const compensationFailure = new Error('compensation failed')
    const state = createDatabase(
      [{ id: '001', documentId: 'doc-1', status: 'draft', deleted: true }],
      { failCompensation: compensationFailure }
    )
    const reconcile = vi.fn()

    let caught: unknown
    try {
      await replaceDeletedDocumentAtPath(
        state.database,
        params,
        async () => {
          throw replacementFailure
        },
        reconcile
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([replacementFailure, compensationFailure])
    expect(reconcile).not.toHaveBeenCalled()
    expect(state.events.slice(-2)).toEqual(['unlock', 'release'])
  })
})
