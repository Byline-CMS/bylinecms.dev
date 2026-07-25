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
 * MySQL-backed core. It calls the **actual** `initBylineCore()` — not a
 * hand-rolled approximation of it — against `mysqlAdapter`, so the boot
 * half genuinely exercises `ensureCollections()` (collection row
 * reconciliation) and `discoverCounterGroups()` (counter-sequence
 * registration) through the adapter, not just the lifecycle half sitting
 * on top of it. An earlier version of this file called `defineServerConfig`
 * directly and created the collection row by hand via
 * `db.commands.collections.create` — that only registers the global config
 * singleton (`defineServerConfig` is `registerServerConfig(resolveServerConfig(...))`,
 * nothing more; see `packages/core/src/config/config.ts`) and skips every
 * other step `initBylineCore()` performs (`validateTreeAuditCapability`,
 * `ensureCollections`, `discoverCounterGroups`, `backfillSourceLocales` —
 * see `packages/core/src/core.ts`), so it never actually proved those steps
 * work against MySQL despite the docblock's claim to the contrary. Fixed
 * here: the boot-smoke collection carries a `counter` field so
 * `discoverCounterGroups()` has a real group to register (a collection with
 * no counter field makes it a no-op — see
 * `packages/core/src/services/discover-counter-groups.ts`), and the create
 * step asserts the allocated value, so counter-sequence emulation is
 * actually exercised end-to-end, not just invoked and ignored.
 *
 * Then a realistic document lifecycle through the public `@byline/client`
 * API — create, read back, update, publish, read published, list, delete —
 * the same surface `apps/webapp` exercises through the admin UI. Mirrors
 * `packages/client/tests/fixtures/setup.ts` (the Postgres equivalent of
 * this composition), swapping `pgAdapter` for `mysqlAdapter` — that fixture
 * also calls `defineServerConfig` rather than `initBylineCore()`, so this
 * file is deliberately *not* a copy of it for the boot half.
 *
 * What this does NOT exercise: the TanStack Start host adapter, the admin
 * UI, or auth/session wiring — those are framework-specific layers above
 * `@byline/client` this task's scope doesn't reach. What it DOES prove is
 * that `initBylineCore()`'s full boot sequence — collection reconciliation
 * and counter-group discovery included — completes against a MySQL adapter,
 * and that nothing in `@byline/client`'s lifecycle/hook/collection-resolution
 * layer assumes a Postgres-shaped adapter.
 */

import { createSuperAdminContext } from '@byline/auth'
import { type BylineClient, createBylineClient } from '@byline/client'
import { type BylineCore, defineCollection, defineWorkflow, initBylineCore } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type MySqlAdapter, mysqlAdapter } from '../src/index.js'
import { assertTestDatabase } from '../src/lib/test-db.js'

// `initBylineCore()` registers two process-global singletons
// (`registerServerConfig`, `defineBylineCore` — see
// `packages/core/src/config/config.ts`), keyed on `globalThis` symbols so
// every copy of the module graph shares the same state. This suite closes
// its pool in `afterAll`, so those globals must be reset afterward — this
// file's mysql run is `isolate: false, maxWorkers: 1` and sorts before
// `conformance.integration.test.ts`, so leaving them pointed at a dead pool
// would poison whichever later file in this run resolves `getServerConfig()`
// / `getBylineCore()`. There is no public reset API (nothing in this
// codebase has needed one before this file), so this reaches into the same
// two symbols `packages/core/src/config/config-hooks.test.node.ts` uses for
// the identical purpose: snapshot before init, restore after teardown.
const SERVER_CONFIG_KEY = Symbol.for('__byline_server_config__')
const BYLINE_CORE_KEY = Symbol.for('__byline_core__')

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
      // Gives `discoverCounterGroups()` (run inside `initBylineCore()`) a
      // real group to register against MySQL's `ensureCounterGroup` — a
      // collection with no `counter` field makes that pass a documented
      // no-op (`discoverCounterGroups` returns early on an empty group
      // set), which would leave the boot half's counter-sequence claim
      // unverified even after switching to a real `initBylineCore()` call.
      { name: 'sequenceId', type: 'counter', group: `boot-smoke-counters-${suffix}` },
    ],
  })
}

describe('MySQL end-to-end boot smoke (initBylineCore composition, live database)', () => {
  let previousServerConfig: unknown
  let previousBylineCore: unknown
  let db: MySqlAdapter
  let core: BylineCore
  let client: BylineClient
  let collectionId: string
  let definition: ReturnType<typeof createBootSmokeCollection>

  beforeAll(async () => {
    const connectionString = process.env.BYLINE_DB_MYSQL_CONNECTION_STRING
    assertTestDatabase(connectionString)

    const globals = globalThis as Record<PropertyKey, unknown>
    previousServerConfig = globals[SERVER_CONFIG_KEY]
    previousBylineCore = globals[BYLINE_CORE_KEY]

    definition = createBootSmokeCollection(`${Date.now()}`)

    db = mysqlAdapter({
      connectionString: connectionString as string,
      collections: [definition],
      defaultContentLocale: 'en',
    })

    // The actual boot sequence — not a hand-rolled approximation. Runs
    // `ensureCollections()` (creates the `boot-smoke-*` collection row —
    // no separate `db.commands.collections.create` call needed) and
    // `discoverCounterGroups()` (registers the `boot-smoke-counters-*`
    // sequence) against this MySQL adapter, among the other boot steps in
    // `packages/core/src/core.ts`.
    core = await initBylineCore({
      db,
      serverURL: 'http://localhost:3000',
      i18n: {
        // Empty interface locale set — `validateTranslations()` (run
        // inside `initBylineCore()`) skips its translations-bundle
        // requirement entirely when `locales` is empty (see
        // `packages/core/src/services/i18n-validator.ts`: "hosts that
        // don't mount the admin UI ... can omit translations entirely").
        // This suite exercises the document-lifecycle/adapter composition,
        // not the admin UI, so it deliberately doesn't mount one rather
        // than pulling in `@byline/i18n` just to satisfy the validator.
        interface: { defaultLocale: 'en', locales: [] },
        content: { defaultLocale: 'en', locales: ['en'] },
      },
      collections: [definition],
    })

    collectionId = core.getCollectionRecord(definition.path).collectionId

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

    const globals = globalThis as Record<PropertyKey, unknown>
    if (previousServerConfig === undefined) delete globals[SERVER_CONFIG_KEY]
    else globals[SERVER_CONFIG_KEY] = previousServerConfig
    if (previousBylineCore === undefined) delete globals[BYLINE_CORE_KEY]
    else globals[BYLINE_CORE_KEY] = previousBylineCore
  })

  it('survives create → read back → update → publish → read published → list → delete', async () => {
    const handle = client.collection(definition.path)

    // create — also proves discoverCounterGroups()'s registered sequence is
    // actually usable: `sequenceId` is allocator-assigned, never supplied
    // by the caller.
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
    const sequenceId = (afterCreate?.fields as Record<string, unknown> | undefined)?.sequenceId
    expect(Number.isInteger(sequenceId)).toBe(true)
    expect(sequenceId as number).toBeGreaterThan(0)

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
