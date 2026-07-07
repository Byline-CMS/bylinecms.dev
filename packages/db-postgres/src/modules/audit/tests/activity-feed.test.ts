/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Integration tests for the system-wide activity feed (docs/06-auth-and-security/02-auditability.md — W4):
 * `audit.findAuditLog`, the read-time UNION of the version stream (content
 * saves → `document.created` / `document.updated`) and the audit log
 * (everything else). Exercises both sources, the cross-source `occurred_at`
 * ordering, every filter (actor / collection / action / date range), and
 * pagination.
 *
 * The version-stream side requires real `collections` + `documents` FK rows,
 * so the fixture seeds two collections and one document each before inserting
 * version rows with controlled `created_at` timestamps.
 */

import { v7 as uuidv7 } from 'uuid'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { collections, documents, documentVersions } from '../../../database/schema/index.js'
import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'
import { createAuditCommands } from '../audit-commands.js'
import { createAuditQueries } from '../audit-queries.js'

let auditCommands: ReturnType<typeof createAuditCommands>
let auditQueries: ReturnType<typeof createAuditQueries>
let db: ReturnType<typeof setupTestDB>['db']

const colA = uuidv7()
const colB = uuidv7()
const docA = uuidv7()
const docB = uuidv7()
const actor1 = uuidv7()
const actor2 = uuidv7()

// Fixed version-save timestamps in the past, so the (now()-stamped) audit rows
// always sort ahead of them and the version rows have a deterministic order.
const t1 = new Date('2026-01-01T10:00:00.000Z') // docA create
const t2 = new Date('2026-01-02T10:00:00.000Z') // docB create
const t3 = new Date('2026-01-03T10:00:00.000Z') // docA update

describe('audit findAuditLog (system activity union)', () => {
  beforeAll(async () => {
    const testDB = setupTestDB([])
    db = testDB.db
    auditCommands = createAuditCommands(testDB.dbManager)
    auditQueries = createAuditQueries(testDB.db)

    // Collection + document FK fixtures for the version-stream side.
    await db.insert(collections).values([
      {
        id: colA,
        path: 'articles',
        singular: 'Article',
        plural: 'Articles',
        config: {},
        version: 1,
      },
      { id: colB, path: 'pages', singular: 'Page', plural: 'Pages', config: {}, version: 1 },
    ])
    await db.insert(documents).values([
      { id: docA, collection_id: colA, source_locale: 'en' },
      { id: docB, collection_id: colB, source_locale: 'en' },
    ])

    // Version stream: two creates and one update. event_type drives the
    // synthesised action; created_by/created_at become actor/occurred_at.
    await db.insert(documentVersions).values([
      {
        id: uuidv7(),
        document_id: docA,
        collection_id: colA,
        collection_version: 1,
        event_type: 'create',
        status: 'draft',
        created_by: actor1,
        created_at: t1,
      },
      {
        id: uuidv7(),
        document_id: docB,
        collection_id: colB,
        collection_version: 1,
        event_type: 'create',
        status: 'draft',
        created_by: actor2,
        created_at: t2,
      },
      {
        id: uuidv7(),
        document_id: docA,
        collection_id: colA,
        collection_version: 1,
        event_type: 'update',
        status: 'draft',
        created_by: actor1,
        created_at: t3,
      },
    ])

    // Audit log: a status change on docA (actor1) and a system deletion of docB.
    await auditCommands.append({
      documentId: docA,
      collectionId: colA,
      actorId: actor1,
      actorRealm: 'admin',
      action: 'document.status.changed',
      field: 'status',
      before: 'draft',
      after: 'published',
    })
    await auditCommands.append({
      documentId: docB,
      collectionId: colB,
      actorId: null,
      actorRealm: 'system',
      action: 'document.deleted',
    })
  })

  afterAll(async () => {
    await teardownTestDB()
  })

  it('unions version-stream + audit-log rows, newest first', async () => {
    const page = await auditQueries.findAuditLog({})
    expect(page.meta.total).toBe(5) // 3 version rows + 2 audit rows

    // Audit rows are now()-stamped, so they lead; version rows follow by
    // created_at DESC (t3 update, t2 docB create, t1 docA create).
    const actions = page.entries.map((e) => e.action)
    expect(actions.slice(-3)).toEqual([
      'document.updated', // t3
      'document.created', // t2 (docB)
      'document.created', // t1 (docA)
    ])

    // A content-save row surfaces with the synthesised action, its actor, and
    // no field/before/after diff.
    const created = page.entries.find(
      (e) => e.action === 'document.created' && e.documentId === docA
    )
    expect(created?.actorId).toBe(actor1)
    expect(created?.actorRealm).toBe('admin')
    expect(created?.field).toBeNull()
    expect(created?.before).toBeNull()
    expect(created?.after).toBeNull()
  })

  it('filters by action', async () => {
    const created = await auditQueries.findAuditLog({ action: 'document.created' })
    expect(created.meta.total).toBe(2)
    expect(created.entries.every((e) => e.action === 'document.created')).toBe(true)

    const updated = await auditQueries.findAuditLog({ action: 'document.updated' })
    expect(updated.meta.total).toBe(1)
  })

  it('filters by collection across both sources', async () => {
    // colA: docA create + docA update (versions) + status change (audit) = 3.
    const page = await auditQueries.findAuditLog({ collectionId: colA })
    expect(page.meta.total).toBe(3)
    expect(page.entries.every((e) => e.collectionId === colA)).toBe(true)
  })

  it('filters by actor across both sources', async () => {
    // actor1: docA create + docA update (versions) + status change (audit) = 3.
    const page = await auditQueries.findAuditLog({ actorId: actor1 })
    expect(page.meta.total).toBe(3)
    expect(page.entries.every((e) => e.actorId === actor1)).toBe(true)
  })

  it('filters by date range on occurred_at', async () => {
    // Only the version rows fall in the fixed January window; the audit rows
    // are now()-stamped and excluded.
    const page = await auditQueries.findAuditLog({
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-01-31T23:59:59.000Z'),
    })
    expect(page.meta.total).toBe(3)
    expect(
      page.entries.every(
        (e) => e.action.startsWith('document.created') || e.action === 'document.updated'
      )
    ).toBe(true)
  })

  it('paginates', async () => {
    const page1 = await auditQueries.findAuditLog({ page: 1, page_size: 2 })
    expect(page1.entries).toHaveLength(2)
    expect(page1.meta.total).toBe(5)
    expect(page1.meta.totalPages).toBe(3)

    const page3 = await auditQueries.findAuditLog({ page: 3, page_size: 2 })
    expect(page3.entries).toHaveLength(1)
  })
})
