/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Handler-level tests isolate transport; session-middleware tests exercise the real pre-handler boundary.
vi.mock('../../integrations/session-middleware.js', () => ({ adminSessionMiddleware: {} }))

import { createSuperAdminContext } from '@byline/auth'
import {
  defineCollection,
  defineServerConfig,
  getDocumentRevisionValidationDetails,
} from '@byline/core'
import { defineLogger } from '@byline/core/logger'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { testAdapter } from '../../../../core/src/storage/db-adapter.test-helper.js'

const fixtures = vi.hoisted(() => ({ ensureCollection: vi.fn(), getAdminRequestContext: vi.fn() }))
// Simulate only the compiler's binding of a validator to a handler. These are
// the real exported host handlers and core services, not mocked lifecycle calls.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value
    const chain = {
      middleware() {
        return chain
      },
      validator(fn: (value: unknown) => unknown) {
        validate = fn
        return chain
      },
      handler(fn: (args: { data: unknown }) => Promise<unknown>) {
        return (args: { data: unknown }) => fn({ data: validate(args.data) })
      },
    }
    return chain
  },
}))
vi.mock('../../integrations/api-utils.js', () => ({ ensureCollection: fixtures.ensureCollection }))
vi.mock('@byline/client/server', () => ({
  getAdminRequestContext: fixtures.getAdminRequestContext,
}))

import { deleteDocument } from './delete.js'
import { unpublishDocument, updateDocumentStatus } from './status.js'
import {
  updateCollectionDocumentSystemFields,
  updateCollectionDocumentWithPatches,
} from './update.js'

const write = vi.fn((): never => {
  throw new Error('Unexpected document write')
})
beforeEach(() => {
  vi.clearAllMocks()
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
  const definition = defineCollection({
    path: 'pages',
    labels: { singular: 'Page', plural: 'Pages' },
    fields: [],
  })
  fixtures.ensureCollection.mockResolvedValue({
    definition,
    collection: { id: 'collection', version: 1 },
  })
  fixtures.getAdminRequestContext.mockResolvedValue(createSuperAdminContext({ id: 'editor' }))
  defineServerConfig({
    collections: [definition],
    db: testAdapter({ withTransaction: write }),
    i18n: {
      admin: { defaultLocale: 'en', locales: [] },
      content: { defaultLocale: 'en', locales: ['en'] },
    },
  })
})

const operations = [
  ['save', updateCollectionDocumentWithPatches, { patches: [] }],
  ['metadata', updateCollectionDocumentSystemFields, { path: 'changed' }],
  ['status', updateDocumentStatus, { status: 'published' }],
  ['unpublish', unpublishDocument, {}],
  ['delete', deleteDocument, {}],
] as const

describe('raw host revision inputs', () => {
  for (const [name, operation, extra] of operations) {
    for (const revision of [undefined, null, '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      it(`${name} rejects ${String(revision)} without writing`, async () => {
        const data = {
          collection: 'pages',
          id: 'document',
          ...extra,
          ...(revision === undefined ? {} : { expectedRevision: revision }),
        }
        const error = await Reflect.apply(operation, undefined, [{ data }]).catch(
          (error: unknown) => error
        )
        expect(error).toMatchObject({ code: 'ERR_VALIDATION' })
        expect(getDocumentRevisionValidationDetails(error)).toEqual({
          reason:
            revision === undefined ? 'missing_document_revision' : 'invalid_document_revision',
        })
        expect(write).not.toHaveBeenCalled()
      })
    }
  }
})
