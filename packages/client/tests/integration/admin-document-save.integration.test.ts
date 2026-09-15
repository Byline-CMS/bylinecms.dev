/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { AdminAuth, createRequestContext, createSuperAdminContext } from '@byline/auth'
import { defineCollection, defineServerConfig } from '@byline/core'
import { defineLogger } from '@byline/core/logger'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createBylineClient } from '../../src/index.js'
import { setupTestClient, type TestContext, teardownTestClient } from '../fixtures/setup.js'

// Execute the built host handlers and lifecycle against Postgres. This suite
// shares the client integration database setup; it does not import host source.
// Session acquisition and the compiler's server-function binding are supplied here;
// the installed HTTP serializer has separate transport regression coverage.
const fixtures = vi.hoisted(() => ({ ensureCollection: vi.fn(), requestContext: vi.fn() }))
const hostRequire = createRequire(
  new URL('../../../host-tanstack-start/package.json', import.meta.url)
)
vi.doMock(
  join(dirname(hostRequire.resolve('@tanstack/react-start/package.json')), 'dist/esm/index.js'),
  () => ({
    createServerFn: () => {
      let validate = (input: unknown) => input
      const chain = {
        middleware() {
          return chain
        },
        validator(fn: (input: unknown) => unknown) {
          validate = fn
          return chain
        },
        handler(fn: (args: { data: unknown }) => unknown) {
          return (args: { data: unknown }) => fn({ data: validate(args.data) })
        },
      }
      return chain
    },
  })
)
vi.mock('../../../host-tanstack-start/dist/integrations/session-middleware.js', () => ({
  adminSessionMiddleware: {},
}))
vi.mock('../../../host-tanstack-start/dist/integrations/api-utils.js', () => ({
  ensureCollection: fixtures.ensureCollection,
}))
vi.mock('@byline/client/server', () => ({ getAdminRequestContext: fixtures.requestContext }))

const { createCollectionDocument } = await import(
  '../../../host-tanstack-start/dist/server-fns/collections/create.js'
)
const { updateCollectionDocumentWithPatches } = await import(
  '../../../host-tanstack-start/dist/server-fns/collections/update.js'
)

let ctx: TestContext
const definition = defineCollection({
  path: `admin-save-${Date.now()}`,
  labels: { singular: 'Entry', plural: 'Entries' },
  fields: [
    { name: 'title', type: 'text' },
    { name: 'details', type: 'group', fields: [{ name: 'caption', type: 'text' }] },
  ],
})
beforeAll(async () => {
  ctx = await setupTestClient(definition)
  const silent = () => {}
  defineLogger({
    log: silent,
    fatal: silent,
    error: silent,
    warn: silent,
    info: silent,
    debug: silent,
    trace: silent,
    silent,
  })
  defineServerConfig({
    db: ctx.db,
    collections: [definition],
    i18n: {
      admin: { defaultLocale: 'en', locales: [] },
      content: { defaultLocale: 'en', locales: ['en'] },
    },
  })
  fixtures.ensureCollection.mockResolvedValue({
    definition,
    collection: { id: ctx.collectionId, version: 1 },
  })
  fixtures.requestContext.mockReturnValue(createSuperAdminContext({ id: 'test-editor' }))
})
afterAll(async () => {
  if (ctx) await teardownTestClient(ctx)
})

describe('admin create and patch through real persistence', () => {
  it('returns safe nested errors and rejects an invalid patch without advancing the revision', async () => {
    await expect(
      createCollectionDocument({
        data: { collection: definition.path, data: { title: 'Invalid', details: {} } },
      })
    ).rejects.toMatchObject({
      code: 'ERR_VALIDATION',
      details: {
        reason: 'invalid_document_fields',
        issues: [{ field: 'details.caption', message: 'caption is required' }],
      },
    })
    const created = await createCollectionDocument({
      data: {
        collection: definition.path,
        data: { title: 'Valid', details: { caption: 'Original' } },
      },
    })
    if (created.status !== 'ok') throw new Error('Unexpected committed-hook failure')
    const input = {
      collection: definition.path,
      id: created.documentId,
      expectedRevision: created.revision,
    }
    await expect(
      updateCollectionDocumentWithPatches({
        data: { ...input, patches: [{ kind: 'field.set', path: 'details.caption', value: '' }] },
      })
    ).rejects.toMatchObject({ code: 'ERR_VALIDATION' })
    const saved = await updateCollectionDocumentWithPatches({
      data: {
        ...input,
        patches: [{ kind: 'field.set', path: 'details.caption', value: 'Updated' }],
      },
    })
    expect(saved.revision).toBe(created.revision + 1)
    const doc = await ctx.client
      .collection(definition.path)
      .findById(created.documentId, { status: 'any' })
    expect(doc?.fields.details).toEqual({ caption: 'Updated' })
  })

  it('uses the admin default and rejects SDK status overrides for a create-only actor', async () => {
    const requestContext = createRequestContext({
      actor: new AdminAuth({ id: 'editor', abilities: [`collections.${definition.path}.create`] }),
    })
    fixtures.requestContext.mockReturnValue(requestContext)
    const created = await createCollectionDocument({
      data: {
        collection: definition.path,
        data: { title: 'Default status', details: { caption: 'Valid' }, status: 'published' },
      },
    })
    if (created.status !== 'ok') throw new Error('Unexpected committed-hook failure')
    const doc = await ctx.client
      .collection(definition.path)
      .findById(created.documentId, { status: 'any' })
    expect(doc?.status).toBe('draft')
    const restricted = createBylineClient({ db: ctx.db, collections: [definition], requestContext })
    await expect(
      restricted
        .collection(definition.path)
        .create({ title: 'Denied', details: { caption: 'Valid' } }, { status: 'published' })
    ).rejects.toMatchObject({ code: 'ERR_FORBIDDEN' })
    await expect(
      restricted
        .collection(definition.path)
        .create({ title: 'Denied', details: { caption: 'Valid' }, status: 'published' })
    ).rejects.toMatchObject({ code: 'ERR_FORBIDDEN' })
  })
})
