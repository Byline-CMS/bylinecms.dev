/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  AdminAuth,
  AuthErrorCodes,
  createRequestContext,
  createSuperAdminContext,
  type RequestContext,
} from '@byline/auth'
import {
  type BeforeReadHookFn,
  defineCollection,
  defineSingleton,
  defineWorkflow,
  ErrorCodes,
  SINGLE_STATUS_WORKFLOW,
} from '@byline/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { type BylineClient, createBylineClient, type SingletonHandle } from '../../src/index.js'
import { setupMultiCollectionTestClient } from '../fixtures/setup.js'

const suffix = `${Date.now()}-singleton-${Math.floor(Math.random() * 1e6)}`
const workflow = defineWorkflow({
  draft: { label: 'Draft', verb: 'Revert to Draft' },
  published: { label: 'Published', verb: 'Publish' },
  archived: { label: 'Archived', verb: 'Archive' },
})

function singleton(path: string, beforeRead?: BeforeReadHookFn) {
  return defineSingleton({
    path,
    label: 'Site settings',
    workflow,
    fields: [
      { name: 'title', type: 'text', label: 'Title', localized: true },
      { name: 'enabled', type: 'checkbox', label: 'Enabled' },
    ],
    hooks: beforeRead == null ? undefined : { beforeRead },
  })
}

const neverSavedDefinition = singleton(`never-saved-${suffix}`)
const settingsDefinition = singleton(`settings-${suffix}`)
const publishedDefinition = singleton(`published-${suffix}`)
const deniedDefinition = singleton(`denied-${suffix}`, ({ requestContext }) =>
  requestContext.actor == null ? false : undefined
)
const otherDefinition = singleton(`other-${suffix}`)
const operationalDefinition = defineSingleton({
  path: `operational-${suffix}`,
  label: 'Operational settings',
  workflow: SINGLE_STATUS_WORKFLOW,
  fields: [{ name: 'siteName', type: 'text', label: 'Site name' }],
})
const articlesDefinition = defineCollection({
  path: `articles-${suffix}`,
  labels: { singular: 'Article', plural: 'Articles' },
  fields: [{ name: 'title', type: 'text', label: 'Title' }],
})
const definitions = [
  neverSavedDefinition,
  settingsDefinition,
  publishedDefinition,
  deniedDefinition,
  otherDefinition,
  operationalDefinition,
  articlesDefinition,
] as const

const currentRequestContext: RequestContext = createSuperAdminContext({ id: 'singleton-admin' })
let client: BylineClient
let collectionIds: Record<string, string>
let db: Awaited<ReturnType<typeof setupMultiCollectionTestClient>>['db']

beforeAll(async () => {
  const setup = await setupMultiCollectionTestClient([...definitions], {
    requestContext: () => currentRequestContext,
  })
  client = setup.client
  db = setup.db
  collectionIds = setup.collectionIds
}, 30_000)

afterAll(async () => {
  if (collectionIds == null || db == null) return
  for (const definition of [...definitions].reverse()) {
    const id = collectionIds[definition.path]
    if (id != null) await db.commands.collections.delete(id)
  }
})

describe('client.singleton()', () => {
  it('rejects paths whose runtime kind does not match the requested handle', () => {
    expect(() => client.collection(settingsDefinition.path)).toThrow(
      `'${settingsDefinition.path}' is a singleton`
    )
    expect(() => client.singleton(articlesDefinition.path)).toThrow(
      `'${articlesDefinition.path}' is a collection`
    )

    let missingCollectionError: unknown
    try {
      client.collection('missing-collection' as never)
    } catch (error) {
      missingCollectionError = error
    }
    expect(missingCollectionError).toMatchObject({
      code: ErrorCodes.NOT_FOUND,
      details: {
        collectionPath: 'missing-collection',
        available: [articlesDefinition.path],
      },
    })
  })

  it('returns the specified empty shapes before a slot is materialized', async () => {
    const handle = client.singleton(neverSavedDefinition.path)

    await expect(handle.get({ status: 'any' })).resolves.toBeNull()
    await expect(handle.history({ page: 3, pageSize: 7 })).resolves.toEqual({
      docs: [],
      meta: { total: 0, page: 3, pageSize: 7, totalPages: 0 },
    })
    await expect(handle.findByVersion('missing-version')).resolves.toBeNull()
    await expect(handle.getScheduledPublish()).resolves.toBeNull()
  })

  it('rejects every non-materializing mutation on an unsaved slot', async () => {
    const handle = client.singleton(neverSavedDefinition.path)
    const expectedNotFound = { code: ErrorCodes.NOT_FOUND }

    await expect(handle.changeStatus('published')).rejects.toMatchObject(expectedNotFound)
    await expect(handle.unpublish()).rejects.toMatchObject(expectedNotFound)
    await expect(
      handle.schedulePublish({
        publishAt: new Date(Date.now() + 3_600_000).toISOString(),
        expectedVersionId: 'missing-version',
      })
    ).rejects.toMatchObject(expectedNotFound)
    await expect(
      handle.confirmScheduledPublish({ expectedVersionId: 'missing-version' })
    ).rejects.toMatchObject(expectedNotFound)
    await expect(handle.cancelScheduledPublish()).rejects.toMatchObject(expectedNotFound)
    await expect(handle.restoreVersion('missing-version')).rejects.toMatchObject(expectedNotFound)
    await expect(
      handle.copyToLocale({ sourceLocale: 'en', targetLocale: 'th' })
    ).rejects.toMatchObject(expectedNotFound)
  })

  it('materializes through update and returns a pathless singleton envelope', async () => {
    const handle = client.singleton(settingsDefinition.path)
    const saved = await handle.update({ title: 'Byline', enabled: true })

    expect(saved.documentId).toBeTruthy()
    expect(saved.documentVersionId).toBeTruthy()

    const document = await handle.get({ status: 'any' })
    expect(document).toMatchObject({
      id: saved.documentId,
      versionId: saved.documentVersionId,
      status: 'draft',
      fields: { title: 'Byline', enabled: true },
    })
    expect(document).not.toHaveProperty('path')

    await expect(handle.history()).resolves.toMatchObject({
      docs: [{ id: saved.documentId, versionId: saved.documentVersionId }],
      meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
    })
    await expect(handle.findByVersion(saved.documentVersionId)).resolves.toMatchObject({
      id: saved.documentId,
      versionId: saved.documentVersionId,
    })
  })

  it('saves, reads, publishes, and re-reads a singleton through the client handle', async () => {
    const handle = client.singleton(publishedDefinition.path)
    const saved = await handle.update({ title: 'Live value', enabled: true })

    await expect(handle.get({ status: 'any' })).resolves.toMatchObject({
      id: saved.documentId,
      status: 'draft',
      fields: { title: 'Live value', enabled: true },
    })
    await expect(handle.get()).resolves.toBeNull()

    await expect(handle.changeStatus('published')).resolves.toEqual({
      previousStatus: 'draft',
      newStatus: 'published',
    })
    await expect(handle.get()).resolves.toMatchObject({
      id: saved.documentId,
      status: 'published',
      fields: { title: 'Live value', enabled: true },
    })
  })

  it('reads a single-status singleton as published immediately after its first save', async () => {
    const handle = client.singleton(operationalDefinition.path)
    const saved = await handle.update({ siteName: 'Example site' })

    await expect(handle.get()).resolves.toMatchObject({
      id: saved.documentId,
      versionId: saved.documentVersionId,
      status: 'published',
      fields: { siteName: 'Example site' },
    })
  })

  it('returns a private singleton only to an authorized actor', async () => {
    const handle = client.singleton(deniedDefinition.path)
    await handle.update({ title: 'Secret', enabled: false })
    await handle.changeStatus('published')

    const anonymousClient = createBylineClient({
      db,
      collections: definitions,
      requestContext: createRequestContext({ readMode: 'published' }),
    })
    const reader = new AdminAuth({
      id: 'private-singleton-reader',
      abilities: [`singletons.${deniedDefinition.path}.read`],
    })
    const authorizedClient = createBylineClient({
      db,
      collections: definitions,
      requestContext: createRequestContext({ actor: reader, readMode: 'published' }),
    })

    await expect(anonymousClient.singleton(deniedDefinition.path).get()).resolves.toBeNull()
    await expect(authorizedClient.singleton(deniedDefinition.path).get()).resolves.toMatchObject({
      status: 'published',
      fields: { title: 'Secret', enabled: false },
    })
  })

  it('does not resolve an orphaned version after rematerializing the singleton slot', async () => {
    const other = client.singleton(otherDefinition.path)
    const first = await other.update({
      title: 'First singleton document',
      enabled: true,
    })
    await db.commands.singletons.clearMapping(collectionIds[otherDefinition.path])

    const second = await other.update({
      title: 'Rematerialized singleton document',
      enabled: false,
    })

    expect(second.documentId).not.toBe(first.documentId)
    await expect(other.findByVersion(first.documentVersionId)).resolves.toBeNull()
    await expect(other.findByVersion(second.documentVersionId)).resolves.toMatchObject({
      id: second.documentId,
      versionId: second.documentVersionId,
    })
  })

  it('authorizes before mapping for materialized and unmaterialized slots', async () => {
    const actor = new AdminAuth({ id: 'no-singleton-access', abilities: [] })
    const unauthorizedClient = createBylineClient({
      db,
      collections: definitions,
      requestContext: createRequestContext({ actor, readMode: 'any' }),
    })
    const mapping = vi.spyOn(db.queries.singletons, 'getMappedDocumentId')
    mapping.mockClear()

    type LooseHandle = SingletonHandle<Record<string, any>>
    const operations: Array<{
      name: string
      ability: 'read' | 'update' | 'changeStatus'
      run: (handle: LooseHandle) => Promise<unknown>
    }> = [
      { name: 'get', ability: 'read', run: (handle) => handle.get({ status: 'any' }) },
      { name: 'update', ability: 'update', run: (handle) => handle.update({ title: 'Denied' }) },
      {
        name: 'changeStatus',
        ability: 'changeStatus',
        run: (handle) => handle.changeStatus('published'),
      },
      { name: 'unpublish', ability: 'changeStatus', run: (handle) => handle.unpublish() },
      {
        name: 'schedulePublish',
        ability: 'changeStatus',
        run: (handle) =>
          handle.schedulePublish({
            publishAt: new Date(Date.now() + 3_600_000).toISOString(),
            expectedVersionId: 'version',
          }),
      },
      {
        name: 'confirmScheduledPublish',
        ability: 'changeStatus',
        run: (handle) => handle.confirmScheduledPublish({ expectedVersionId: 'version' }),
      },
      {
        name: 'cancelScheduledPublish',
        ability: 'changeStatus',
        run: (handle) => handle.cancelScheduledPublish(),
      },
      {
        name: 'getScheduledPublish',
        ability: 'changeStatus',
        run: (handle) => handle.getScheduledPublish(),
      },
      { name: 'history', ability: 'read', run: (handle) => handle.history() },
      {
        name: 'findByVersion',
        ability: 'read',
        run: (handle) => handle.findByVersion('version'),
      },
      {
        name: 'restoreVersion',
        ability: 'update',
        run: (handle) => handle.restoreVersion('version'),
      },
      {
        name: 'copyToLocale',
        ability: 'update',
        run: (handle) => handle.copyToLocale({ sourceLocale: 'en', targetLocale: 'th' }),
      },
    ]

    for (const operation of operations) {
      for (const definition of [settingsDefinition, neverSavedDefinition]) {
        const promise = operation.run(unauthorizedClient.singleton(definition.path))
        await expect(promise, `${operation.name} on ${definition.path}`).rejects.toMatchObject({
          code: AuthErrorCodes.FORBIDDEN,
          message: expect.stringContaining(`singletons.${definition.path}.${operation.ability}`),
        })
      }
    }
    expect(mapping).not.toHaveBeenCalled()
    mapping.mockRestore()
  })
})
