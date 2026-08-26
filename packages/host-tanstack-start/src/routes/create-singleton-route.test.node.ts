/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  definition: {
    singleton: true,
    path: 'site-settings',
    label: 'Site settings',
    fields: [{ name: 'title', type: 'text', defaultValue: 'Default title' }],
  },
  read: vi.fn(),
  buildInitialData: vi.fn(),
  getPublishedVersion: vi.fn(),
  getRequestContext: vi.fn(),
  getScheduledPublish: vi.fn(),
  getCollectionRecord: vi.fn(),
  scheduledPublicationEnabled: true,
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

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  notFound: () => new Error('not found'),
}))

vi.mock('@byline/client/server', () => ({
  getAdminBylineClient: () => ({
    singleton: () => ({ getScheduledPublish: mocks.getScheduledPublish }),
  }),
  getAdminRequestContext: mocks.getRequestContext,
}))

vi.mock('@byline/core', () => ({
  buildInitialDataFromFields: mocks.buildInitialData,
  documentAbilityKey: (_definition: unknown, verb: string) => `singletons.site-settings.${verb}`,
  getCollectionDefinition: (path: string) =>
    path === mocks.definition.path ? mocks.definition : null,
  isSingleton: (definition: { singleton?: boolean }) => definition.singleton === true,
  getServerConfig: () => ({
    i18n: { content: { defaultLocale: 'en' } },
    scheduledPublication: { enabled: mocks.scheduledPublicationEnabled },
    db: { queries: { documents: { getPublishedVersion: mocks.getPublishedVersion } } },
  }),
  getSingletonAdminConfig: () => null,
}))

vi.mock('../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js', () => ({
  BreadcrumbsClient: () => null,
}))
vi.mock('../admin-shell/singletons/view.js', () => ({ SingletonView: () => null }))
vi.mock('../integrations/byline-core.js', () => ({
  bylineCore: () => ({ getCollectionRecord: mocks.getCollectionRecord }),
}))
vi.mock('../server-fns/singleton-document-read.js', () => ({
  readSingletonDocument: mocks.read,
}))
vi.mock('../server-fns/serialise.js', () => ({ serialise: (value: unknown) => value }))
vi.mock('@byline/i18n/react', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./admin-path.js', () => ({ getAdminRoutePath: () => '/admin' }))
vi.mock('./get-content-locale-route-config.js', () => ({
  getContentLocaleRouteConfig: () => ({ contentLocales: [], defaultContentLocale: 'en' }),
}))

import { getSingletonRouteDocument } from './create-singleton-route.js'

type ServerFunction = (options: { data: { singleton: string; locale?: string } }) => Promise<any>

const load = (locale?: string) =>
  (getSingletonRouteDocument as ServerFunction)({
    data: { singleton: 'site-settings', locale },
  })

describe('singleton editor route loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scheduledPublicationEnabled = true
    mocks.buildInitialData.mockResolvedValue({ title: 'Default title' })
    mocks.getCollectionRecord.mockReturnValue({ collectionId: 'collection-settings' })
    mocks.getRequestContext.mockResolvedValue({
      actor: {
        hasAbility: (ability: string) =>
          ability === 'singletons.site-settings.changeStatus' ||
          ability === 'singletons.site-settings.publish',
      },
    })
  })

  it('resolves schema defaults without inventing a document for an empty slot', async () => {
    mocks.read.mockResolvedValue(null)

    await expect(load('fr')).resolves.toEqual({
      document: null,
      initialData: { title: 'Default title' },
    })
    expect(mocks.read).toHaveBeenCalledWith({
      singleton: 'site-settings',
      locale: 'fr',
      populateRelations: true,
    })
    expect(mocks.buildInitialData).toHaveBeenCalledWith(mocks.definition.fields, { locale: 'fr' })
    expect(mocks.getCollectionRecord).not.toHaveBeenCalled()
    expect(mocks.getRequestContext).not.toHaveBeenCalled()
  })

  it('attaches publication and schedule metadata to a mapped document server-side', async () => {
    mocks.read.mockResolvedValue({
      id: 'document-settings',
      versionId: 'version-current',
      status: 'draft',
      fields: { title: 'Loaded' },
    })
    mocks.getPublishedVersion.mockResolvedValue({
      document_id: 'document-settings',
      document_version_id: 'version-published',
      status: 'published',
      created_at: '2026-08-25T00:00:00.000Z',
      updated_at: '2026-08-25T01:00:00.000Z',
    })
    mocks.getScheduledPublish.mockResolvedValue({
      state: 'armed',
      publishAt: '2026-09-01T00:00:00.000Z',
      targetVersionId: 'version-current',
    })

    const result = await load()

    expect(result.initialData).toBeUndefined()
    expect(result.document).toMatchObject({
      id: 'document-settings',
      _publishedVersion: {
        id: 'document-settings',
        versionId: 'version-published',
        status: 'published',
      },
      _scheduledPublicationEnabled: true,
      _canSchedulePublication: true,
      _scheduledPublish: {
        state: 'armed',
        targetVersionId: 'version-current',
      },
      scheduledPublishAt: '2026-09-01T00:00:00.000Z',
      scheduledPublishVersionId: 'version-current',
    })
    expect(mocks.getPublishedVersion).toHaveBeenCalledWith({
      collection_id: 'collection-settings',
      document_id: 'document-settings',
    })
    expect(mocks.getScheduledPublish).toHaveBeenCalledTimes(1)
  })
})
