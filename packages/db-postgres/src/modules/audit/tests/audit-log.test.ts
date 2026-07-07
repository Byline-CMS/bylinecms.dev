/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Integration tests for the audit-log storage layer (docs/06-auth-and-security/02-auditability.md — W2):
 * `audit.append` (write) + `audit.getDocumentAuditLog` (read), and the
 * load-bearing property that an `append` issued inside `withTransaction`
 * commits or rolls back **with** the transaction it is part of.
 */

import { v7 as uuidv7 } from 'uuid'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'
import { createAuditCommands } from '../audit-commands.js'
import { createAuditQueries } from '../audit-queries.js'

let auditCommands: ReturnType<typeof createAuditCommands>
let auditQueries: ReturnType<typeof createAuditQueries>
let txManager: ReturnType<typeof setupTestDB>['txManager']

describe('audit-log storage', () => {
  beforeAll(() => {
    const testDB = setupTestDB([])
    txManager = testDB.txManager
    auditCommands = createAuditCommands(testDB.dbManager)
    auditQueries = createAuditQueries(testDB.db)
  })

  afterAll(async () => {
    await teardownTestDB()
  })

  it('appends an entry and reads it back with full field fidelity', async () => {
    const documentId = uuidv7()
    const collectionId = uuidv7()
    const actorId = uuidv7()

    await auditCommands.append({
      documentId,
      collectionId,
      actorId,
      actorRealm: 'admin',
      action: 'document.path.changed',
      field: 'path',
      before: 'old-slug',
      after: 'new-slug',
    })

    const page = await auditQueries.getDocumentAuditLog({ document_id: documentId })

    expect(page.meta.total).toBe(1)
    const entry = page.entries[0]!
    expect(entry.documentId).toBe(documentId)
    expect(entry.collectionId).toBe(collectionId)
    expect(entry.actorId).toBe(actorId)
    expect(entry.actorRealm).toBe('admin')
    expect(entry.action).toBe('document.path.changed')
    expect(entry.field).toBe('path')
    expect(entry.before).toBe('old-slug')
    expect(entry.after).toBe('new-slug')
    expect(entry.occurredAt).toBeInstanceOf(Date)
  })

  it('persists NULL actor + structured before/after, and returns newest-first', async () => {
    const documentId = uuidv7()

    // A system write (no actor) with object-shaped before/after.
    await auditCommands.append({
      documentId,
      actorId: null,
      actorRealm: 'system',
      action: 'document.locales.changed',
      field: 'availableLocales',
      before: ['en'],
      after: ['en', 'fr'],
    })
    await auditCommands.append({
      documentId,
      actorRealm: 'admin',
      action: 'document.status.changed',
      field: 'status',
      before: 'draft',
      after: 'published',
    })

    const page = await auditQueries.getDocumentAuditLog({ document_id: documentId })
    expect(page.meta.total).toBe(2)
    // UUIDv7 ids → newest first: the status change was appended last.
    expect(page.entries[0]?.action).toBe('document.status.changed')
    expect(page.entries[1]?.action).toBe('document.locales.changed')

    const localesEntry = page.entries[1]!
    expect(localesEntry.actorId).toBeNull()
    expect(localesEntry.before).toEqual(['en'])
    expect(localesEntry.after).toEqual(['en', 'fr'])
  })

  it('rolls back the audit row when its enclosing transaction throws', async () => {
    const documentId = uuidv7()

    await expect(
      txManager.withTransaction(async () => {
        await auditCommands.append({
          documentId,
          actorRealm: 'admin',
          action: 'document.deleted',
        })
        // The unit of work fails after the audit append. If the append had run
        // on the pool rather than the ambient tx, the row would survive.
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    const page = await auditQueries.getDocumentAuditLog({ document_id: documentId })
    expect(page.meta.total).toBe(0)
  })

  it('commits the audit row with its enclosing transaction', async () => {
    const documentId = uuidv7()

    await txManager.withTransaction(async () => {
      await auditCommands.append({
        documentId,
        actorRealm: 'admin',
        action: 'document.deleted',
      })
    })

    const page = await auditQueries.getDocumentAuditLog({ document_id: documentId })
    expect(page.meta.total).toBe(1)
    expect(page.entries[0]?.action).toBe('document.deleted')
  })
})
