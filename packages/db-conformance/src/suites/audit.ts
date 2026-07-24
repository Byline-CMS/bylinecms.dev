/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { v7 as uuidv7 } from 'uuid'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

/**
 * Ported from `packages/db-postgres/src/modules/audit/tests/audit-log.test.ts`.
 * Exercises `IAuditCommands.append` (write) and `IAuditQueries.getDocumentAuditLog`
 * (read) purely through the `IDbAdapter` contract — including the load-bearing
 * property that an `append` issued inside `withTransaction` commits or rolls
 * back **with** the transaction it is part of. Test bodies are verbatim; only
 * `setupTestDB()`/`txManager` → `hooks.createAdapter()`/`adapter.withTransaction`
 * changed.
 */
function auditLogSuite(hooks: ConformanceHooks): void {
  let adapter: IDbAdapter

  describe('audit-log storage', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([])
    })

    it('appends an entry and reads it back with full field fidelity', async () => {
      const documentId = uuidv7()
      const collectionId = uuidv7()
      const actorId = uuidv7()

      await adapter.commands.audit.append({
        documentId,
        collectionId,
        actorId,
        actorRealm: 'admin',
        action: 'document.path.changed',
        field: 'path',
        before: 'old-slug',
        after: 'new-slug',
      })

      const page = await adapter.queries.audit.getDocumentAuditLog({ document_id: documentId })

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
      await adapter.commands.audit.append({
        documentId,
        actorId: null,
        actorRealm: 'system',
        action: 'document.locales.changed',
        field: 'availableLocales',
        before: ['en'],
        after: ['en', 'fr'],
      })
      await adapter.commands.audit.append({
        documentId,
        actorRealm: 'admin',
        action: 'document.status.changed',
        field: 'status',
        before: 'draft',
        after: 'published',
      })

      const page = await adapter.queries.audit.getDocumentAuditLog({ document_id: documentId })
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
        adapter.withTransaction(async () => {
          await adapter.commands.audit.append({
            documentId,
            actorRealm: 'admin',
            action: 'document.deleted',
          })
          // The unit of work fails after the audit append. If the append had run
          // on the pool rather than the ambient tx, the row would survive.
          throw new Error('boom')
        })
      ).rejects.toThrow('boom')

      const page = await adapter.queries.audit.getDocumentAuditLog({ document_id: documentId })
      expect(page.meta.total).toBe(0)
    })

    it('commits the audit row with its enclosing transaction', async () => {
      const documentId = uuidv7()

      await adapter.withTransaction(async () => {
        await adapter.commands.audit.append({
          documentId,
          actorRealm: 'admin',
          action: 'document.deleted',
        })
      })

      const page = await adapter.queries.audit.getDocumentAuditLog({ document_id: documentId })
      expect(page.meta.total).toBe(1)
      expect(page.entries[0]?.action).toBe('document.deleted')
    })
  })
}

const ArticlesConfig: CollectionDefinition = {
  path: `audit-articles-${Date.now()}`,
  labels: { singular: 'Article', plural: 'Articles' },
  fields: [{ name: 'title', type: 'text' }],
}

const PagesConfig: CollectionDefinition = {
  path: `audit-pages-${Date.now()}`,
  labels: { singular: 'Page', plural: 'Pages' },
  fields: [{ name: 'title', type: 'text' }],
}

/**
 * Ported from `packages/db-postgres/src/modules/audit/tests/activity-feed.test.ts`.
 * Exercises `IAuditQueries.findAuditLog`, the read-time UNION of the version
 * stream (content saves → `document.created` / `document.updated`) and the
 * audit log (everything else).
 *
 * The original fixture inserted `documentVersions` rows directly against the
 * Postgres schema so it could stamp deliberately fixed, in-the-past
 * `created_at` values (the version rows needed to sort predictably relative
 * to the now()-stamped audit rows). `IDocumentCommands.createDocumentVersion`
 * does not expose a caller-controlled timestamp — every canonical adapter
 * stamps `created_at` itself — so this port drives the fixture entirely
 * through `commands.collections.create` / `commands.documents.createDocumentVersion`
 * / `commands.audit.append` and captures real wall-clock boundaries
 * (`versionsStart` / `versionsEnd`) around the version-stream writes instead
 * of fixed dates. Because every write in the fixture happens in strict
 * sequence, the resulting `occurred_at` ordering is exactly as deterministic
 * as the original fixed-date one — only the *mechanism* for asserting "these
 * rows precede those rows" changed, not the assertions themselves.
 */
function activityFeedSuite(hooks: ConformanceHooks): void {
  let adapter: IDbAdapter
  let colA: string
  let colB: string
  let docA: string
  let docB: string
  let versionsStart: Date
  let versionsEnd: Date

  const actor1 = uuidv7()
  const actor2 = uuidv7()

  describe('audit findAuditLog (system activity union)', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([ArticlesConfig, PagesConfig])

      const [colARow] = await adapter.commands.collections.create(
        ArticlesConfig.path,
        ArticlesConfig
      )
      const [colBRow] = await adapter.commands.collections.create(PagesConfig.path, PagesConfig)
      if (!colARow || !colBRow) throw new Error('Failed to create test collections')
      colA = colARow.id
      colB = colBRow.id

      // Version stream: two creates and one update. `action` drives the
      // synthesised `document.created` / `document.updated` action; createdBy
      // becomes the actor. `versionsStart`/`versionsEnd` are derived from the
      // DB-assigned `created_at` of the first and last version rows — not a
      // client-side `new Date()` read, which would race against the audit
      // appends below (the whole fixture can complete within a single
      // millisecond on a fast local connection, and JS's clock resolution is
      // only 1ms). `created_at` is a TIMESTAMPTZ(6) (microsecond) column
      // defaulted by Postgres itself (`common.ts`'s `auditTimestamp`); once
      // it round-trips through `.returning()` into a JS `Date`, its
      // microsecond component is truncated, so the row's own `created_at`
      // can compare *earlier* than the true value stored for that same row.
      // Padding by 1ms in each direction absorbs exactly that truncation
      // without needing microsecond-safe (re-)serialization.
      const createA = await adapter.commands.documents.createDocumentVersion({
        collectionId: colA,
        collectionVersion: 1,
        collectionConfig: ArticlesConfig,
        action: 'create',
        documentData: { title: 'Article A' },
        locale: 'all',
        status: 'draft',
        createdBy: actor1,
      })
      docA = createA.document.document_id
      versionsStart = new Date(createA.document.created_at.getTime() - 1)

      const createB = await adapter.commands.documents.createDocumentVersion({
        collectionId: colB,
        collectionVersion: 1,
        collectionConfig: PagesConfig,
        action: 'create',
        documentData: { title: 'Page B' },
        locale: 'all',
        status: 'draft',
        createdBy: actor2,
      })
      docB = createB.document.document_id

      const updateA = await adapter.commands.documents.createDocumentVersion({
        documentId: docA,
        collectionId: colA,
        collectionVersion: 1,
        collectionConfig: ArticlesConfig,
        action: 'update',
        documentData: { title: 'Article A, updated' },
        locale: 'all',
        status: 'draft',
        createdBy: actor1,
      })
      versionsEnd = new Date(updateA.document.created_at.getTime() + 1)

      // Audit log: a status change on docA (actor1) and a system deletion of docB.
      await adapter.commands.audit.append({
        documentId: docA,
        collectionId: colA,
        actorId: actor1,
        actorRealm: 'admin',
        action: 'document.status.changed',
        field: 'status',
        before: 'draft',
        after: 'published',
      })
      await adapter.commands.audit.append({
        documentId: docB,
        collectionId: colB,
        actorId: null,
        actorRealm: 'system',
        action: 'document.deleted',
      })
    })

    afterAll(async () => {
      for (const id of [colA, colB]) {
        try {
          await adapter.commands.collections.delete(id)
        } catch (error) {
          console.error('cleanup failed for collection', id, error)
        }
      }
    })

    it('unions version-stream + audit-log rows, newest first', async () => {
      const page = await adapter.queries.audit.findAuditLog({})
      expect(page.meta.total).toBe(5) // 3 version rows + 2 audit rows

      // Audit rows were appended after every version row, so they lead;
      // version rows follow by occurred_at DESC (docA update, docB create,
      // docA create — the reverse of write order).
      const actions = page.entries.map((e) => e.action)
      expect(actions.slice(-3)).toEqual([
        'document.updated', // docA update
        'document.created', // docB create
        'document.created', // docA create
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
      const created = await adapter.queries.audit.findAuditLog({ action: 'document.created' })
      expect(created.meta.total).toBe(2)
      expect(created.entries.every((e) => e.action === 'document.created')).toBe(true)

      const updated = await adapter.queries.audit.findAuditLog({ action: 'document.updated' })
      expect(updated.meta.total).toBe(1)
    })

    it('filters by collection across both sources', async () => {
      // colA: docA create + docA update (versions) + status change (audit) = 3.
      const page = await adapter.queries.audit.findAuditLog({ collectionId: colA })
      expect(page.meta.total).toBe(3)
      expect(page.entries.every((e) => e.collectionId === colA)).toBe(true)
    })

    it('filters by actor across both sources', async () => {
      // actor1: docA create + docA update (versions) + status change (audit) = 3.
      const page = await adapter.queries.audit.findAuditLog({ actorId: actor1 })
      expect(page.meta.total).toBe(3)
      expect(page.entries.every((e) => e.actorId === actor1)).toBe(true)
    })

    it('filters by date range on occurred_at', async () => {
      // Only the version rows fall within the captured version-writing
      // window; the audit rows were appended after `versionsEnd`.
      const page = await adapter.queries.audit.findAuditLog({
        from: versionsStart,
        to: versionsEnd,
      })
      expect(page.meta.total).toBe(3)
      expect(
        page.entries.every(
          (e) => e.action.startsWith('document.created') || e.action === 'document.updated'
        )
      ).toBe(true)
    })

    it('paginates', async () => {
      const page1 = await adapter.queries.audit.findAuditLog({ page: 1, page_size: 2 })
      expect(page1.entries).toHaveLength(2)
      expect(page1.meta.total).toBe(5)
      expect(page1.meta.totalPages).toBe(3)

      const page3 = await adapter.queries.audit.findAuditLog({ page: 3, page_size: 2 })
      expect(page3.entries).toHaveLength(1)
    })
  })
}

export function auditSuite(hooks: ConformanceHooks): void {
  auditLogSuite(hooks)
  activityFeedSuite(hooks)
}
