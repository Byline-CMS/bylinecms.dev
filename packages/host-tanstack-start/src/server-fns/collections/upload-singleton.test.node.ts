/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { AdminAuth, createRequestContext } from '@byline/auth'
import {
  defineServerConfig,
  defineSingleton,
  type IDbAdapter,
  type IStorageProvider,
} from '@byline/core'
import { defineLogger } from '@byline/core/logger'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAdminRequestContext: vi.fn(),
  getCollectionRecord: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (input: unknown) => input
    const chain = {
      validator(validator: (input: unknown) => unknown) {
        validate = validator
        return chain
      },
      handler(handler: (options: { data: any }) => Promise<unknown>) {
        return async (options: { data: unknown }) => handler({ data: validate(options.data) })
      },
    }
    return chain
  },
}))

vi.mock('@byline/client/server', () => ({
  getAdminRequestContext: mocks.getAdminRequestContext,
}))

vi.mock('@byline/core/image', () => ({
  extractImageMeta: vi.fn(async () => ({ width: null, height: null, format: null })),
  generateImageVariants: vi.fn(async () => []),
  isBypassMimeType: vi.fn(() => false),
}))

vi.mock('../../integrations/byline-core.js', () => ({
  bylineCore: () => ({ getCollectionRecord: mocks.getCollectionRecord }),
}))

import { ensureCollection, ensureDocumentResource } from '../../integrations/api-utils.js'
import { uploadField } from './upload.js'

const SERVER_CONFIG = Symbol.for('__byline_server_config__')
const BYLINE_LOGGER = Symbol.for('__byline_logger__')
const previousServer = (globalThis as Record<PropertyKey, unknown>)[SERVER_CONFIG]
const previousLogger = (globalThis as Record<PropertyKey, unknown>)[BYLINE_LOGGER]

const singleton = defineSingleton({
  path: 'site-settings',
  label: 'Site settings',
  fields: [
    {
      name: 'hero',
      label: 'Hero image',
      type: 'file',
      upload: { mimeTypes: ['text/plain'], requireSavedDocument: true },
    },
  ],
})

const storageUpload = vi.fn(async () => ({
  storageProvider: 'test',
  storagePath: 'site-settings/hero.txt',
  storageUrl: '/uploads/site-settings/hero.txt',
}))

const storage: IStorageProvider = {
  providerName: 'test',
  upload: storageUpload,
  delete: vi.fn(async () => {}),
  getUrl: (path) => `/uploads/${path}`,
}

beforeAll(() => {
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
  mocks.getCollectionRecord.mockReturnValue({
    collectionId: 'collection-settings',
    version: 1,
    schemaHash: 'singleton-hash',
  })
  mocks.getAdminRequestContext.mockResolvedValue(
    createRequestContext({
      actor: new AdminAuth({
        id: 'settings-editor',
        abilities: ['singletons.site-settings.update'],
      }),
    })
  )
  defineServerConfig({
    collections: [singleton],
    db: {} as IDbAdapter,
    storage,
    i18n: {
      admin: { defaultLocale: 'en', locales: ['en'] },
      content: { defaultLocale: 'en', locales: ['en'] },
    },
  })
})

afterAll(() => {
  const globals = globalThis as Record<PropertyKey, unknown>
  if (previousServer === undefined) delete globals[SERVER_CONFIG]
  else globals[SERVER_CONFIG] = previousServer
  if (previousLogger === undefined) delete globals[BYLINE_LOGGER]
  else globals[BYLINE_LOGGER] = previousLogger
})

describe('singleton field upload host transport', () => {
  it('keeps collection routes closed while resolving the shared upload resource', async () => {
    await expect(ensureCollection('site-settings')).resolves.toBeNull()
    await expect(ensureDocumentResource('site-settings')).resolves.toMatchObject({
      definition: { singleton: true, path: 'site-settings' },
      collection: { id: 'collection-settings', version: 1 },
    })
  })

  it('stores a singleton field without taking the collection create branch', async () => {
    const formData = new FormData()
    formData.set('field', 'hero')
    formData.set('file', new File(['hero'], 'Hero.txt', { type: 'text/plain' }))

    const result = await uploadField('site-settings', formData, false)

    expect(mocks.getCollectionRecord).toHaveBeenCalledWith('site-settings')
    expect(storageUpload).toHaveBeenCalledWith(
      Buffer.from('hero'),
      expect.objectContaining({
        collection: 'site-settings',
        filename: 'hero.txt',
        mimeType: 'text/plain',
      })
    )
    expect(result.documentId).toBeUndefined()
    expect(result.storedFile).toMatchObject({
      filename: 'hero.txt',
      storageProvider: 'test',
      storagePath: 'site-settings/hero.txt',
    })
  })
})
