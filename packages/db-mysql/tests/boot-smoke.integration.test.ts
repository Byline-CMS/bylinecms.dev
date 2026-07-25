/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * End-to-end boot smoke — task 13, §E.
 *
 * The conformance suite (`tests/conformance.integration.test.ts`) and the
 * per-adapter unit tests (`src/modules/**\/tests/*.test.ts`) exercise
 * `mysqlAdapter` in isolation, calling its commands/queries directly. Real
 * usage never does that: an app calls `initBylineCore()` with a `db`
 * adapter, then talks to `@byline/client` — a different composition, with
 * its own layer of collection resolution, hooks, and lifecycle services
 * sitting on top of the adapter.
 *
 * This test proves that composition boots and holds together against a
 * MySQL-backed core: `defineServerConfig` (the same registration
 * `initBylineCore()` performs) + `mysqlAdapter` + `createBylineClient`,
 * then a realistic document lifecycle through the public
 * `@byline/client` API — create, read back, update, publish, read
 * published, list, delete — the same surface `apps/webapp` exercises
 * through the admin UI. Mirrors
 * `packages/client/tests/fixtures/setup.ts` (the Postgres equivalent of
 * this composition), swapping `pgAdapter` for `mysqlAdapter`.
 *
 * What this does NOT exercise: the TanStack Start host adapter, the admin
 * UI, or auth/session wiring — those are framework-specific layers above
 * `@byline/client` this task's scope doesn't reach. What it DOES prove is
 * that nothing in `@byline/client`'s lifecycle/hook/collection-resolution
 * layer assumes a Postgres-shaped adapter.
 */

import { createSuperAdminContext } from '@byline/auth'
import { type BylineClient, createBylineClient } from '@byline/client'
import { defineCollection, defineServerConfig, defineWorkflow } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type MySqlAdapter, mysqlAdapter } from '../src/index.js'
import { assertTestDatabase } from '../src/lib/test-db.js'

function createBootSmokeCollection(suffix: string) {
  return defineCollection({
    path: `boot-smoke-${suffix}`,
    labels: { singular: 'BootSmokeDoc', plural: 'BootSmokeDocs' },
    workflow: defineWorkflow({
      draft: { label: 'Draft', verb: 'Revert to Draft' },
      published: { label: 'Published', verb: 'Publish' },
      archived: { label: 'Archived', verb: 'Archive' },
    }),
    useAsPath: 'title',
    fields: [
      { name: 'title', type: 'text', label: 'Title' },
      { name: 'summary', type: 'textArea', label: 'Summary', optional: true },
    ],
  })
}

describe('MySQL end-to-end boot smoke (initBylineCore composition, live database)', () => {
  let db: MySqlAdapter
  let client: BylineClient
  let collectionId: string
  let definition: ReturnType<typeof createBootSmokeCollection>

  beforeAll(async () => {
    const connectionString = process.env.BYLINE_DB_MYSQL_CONNECTION_STRING
    assertTestDatabase(connectionString)

    definition = createBootSmokeCollection(`${Date.now()}`)

    // The same construction `apps/webapp/byline/server.config.ts` performs
    // (`mysqlAdapter(...)` in place of `pgAdapter(...)`), followed by
    // `defineServerConfig` — the registration step `initBylineCore()`
    // performs internally so `getCollectionDefinition()` resolves at
    // runtime for lifecycle hooks and path/slug derivation.
    db = mysqlAdapter({
      connectionString: connectionString as string,
      collections: [definition],
      defaultContentLocale: 'en',
    })

    defineServerConfig({
      db,
      serverURL: 'http://localhost:3000',
      i18n: {
        interface: { defaultLocale: 'en', locales: ['en'] },
        content: { defaultLocale: 'en', locales: ['en'] },
      },
      collections: [definition],
    })

    const [row] = await db.commands.collections.create(definition.path, definition)
    if (!row) throw new Error(`Failed to create test collection '${definition.path}'`)
    collectionId = row.id as string

    client = createBylineClient({
      db,
      collections: [definition],
      requestContext: createSuperAdminContext({ id: 'boot-smoke-super-admin' }),
    })
  }, 30_000)

  afterAll(async () => {
    try {
      await db.commands.collections.delete(collectionId)
    } catch (error) {
      console.error('Failed to clean up boot-smoke test collection:', error)
    }
    await db.pool.end()
  })

  it('survives create → read back → update → publish → read published → list → delete', async () => {
    const handle = client.collection(definition.path)

    // create
    const created = await handle.create(
      { title: 'Boot Smoke Doc', summary: 'first draft' },
      { path: 'boot-smoke-doc' }
    )
    expect(created.documentId).toBeTruthy()
    expect(created.documentVersionId).toBeTruthy()

    // read back — a fresh draft isn't visible under the client's default
    // `status: 'published'` mode, so this opts into `status: 'any'`, the
    // same way an admin caller would.
    const afterCreate = await handle.findById(created.documentId, { status: 'any' })
    expect(afterCreate?.fields.title).toBe('Boot Smoke Doc')
    expect(afterCreate?.fields.summary).toBe('first draft')
    expect(afterCreate?.status).toBe('draft')

    // update — a new immutable version, still draft.
    await handle.update(created.documentId, { title: 'Boot Smoke Doc', summary: 'second draft' })
    const afterUpdate = await handle.findById(created.documentId, { status: 'any' })
    expect(afterUpdate?.fields.summary).toBe('second draft')
    expect(afterUpdate?.status).toBe('draft')

    // publish
    await handle.changeStatus(created.documentId, 'published')

    // read published — the client's default read mode, no `status` override.
    const published = await handle.findById(created.documentId)
    expect(published?.fields.summary).toBe('second draft')
    expect(published?.status).toBe('published')

    // list — the published document surfaces in the default find().
    const listed = await handle.find()
    expect(listed.docs.map((d) => d.id)).toContain(created.documentId)

    // delete — soft delete; the document disappears from every read mode.
    await handle.delete(created.documentId)
    const afterDelete = await handle.findById(created.documentId, { status: 'any' })
    expect(afterDelete).toBeNull()
    const listedAfterDelete = await handle.find({ status: 'any' })
    expect(listedAfterDelete.docs.map((d) => d.id)).not.toContain(created.documentId)
  })
})
