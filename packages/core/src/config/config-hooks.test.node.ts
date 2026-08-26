import { afterEach, describe, expect, it } from 'vitest'

import { defineAdmin, defineSingletonAdmin } from '../@types/admin-types.js'
import { defineCollection, defineSingleton } from '../@types/collection-types.js'
import {
  defineAdminConfig,
  defineServerConfig,
  getCollectionAdminConfig,
  getCollectionDefinition,
  getSingletonAdminConfig,
} from './config.js'
import type { CollectionDefinition, IDbAdapter, ServerConfig } from '../@types/index.js'

const SERVER_CONFIG = Symbol.for('__byline_server_config__')
const ADMIN_CONFIG = Symbol.for('__byline_admin_config__')
const CLIENT_CONFIG = Symbol.for('__byline_client_config__')
const previousServer = (globalThis as Record<PropertyKey, unknown>)[SERVER_CONFIG]
const previousAdmin = (globalThis as Record<PropertyKey, unknown>)[ADMIN_CONFIG]
const previousClient = (globalThis as Record<PropertyKey, unknown>)[CLIENT_CONFIG]

afterEach(() => {
  const globals = globalThis as Record<PropertyKey, unknown>
  if (previousServer === undefined) delete globals[SERVER_CONFIG]
  else globals[SERVER_CONFIG] = previousServer
  if (previousAdmin === undefined) delete globals[ADMIN_CONFIG]
  else globals[ADMIN_CONFIG] = previousAdmin
  if (previousClient === undefined) delete globals[CLIENT_CONFIG]
  else globals[CLIENT_CONFIG] = previousClient
})

function definition(path: string): CollectionDefinition {
  return {
    path,
    labels: { singular: path, plural: path },
    fields: [{ name: 'title', type: 'text' }],
  }
}

const i18n = {
  admin: { defaultLocale: 'en', locales: [] },
  content: { defaultLocale: 'en', locales: [] },
}

describe('collection definition config preference', () => {
  it('uses client definitions when only admin config is registered', () => {
    const globals = globalThis as Record<PropertyKey, unknown>
    delete globals[SERVER_CONFIG]
    delete globals[CLIENT_CONFIG]
    const client = definition('client-only')
    defineAdminConfig({ collections: [client], i18n })
    expect(getCollectionDefinition('client-only')).toBe(client)
  })

  it('prefers hook-attached server definitions when both configs are registered', () => {
    const globals = globalThis as Record<PropertyKey, unknown>
    delete globals[SERVER_CONFIG]
    delete globals[CLIENT_CONFIG]
    const client = definition('docs')
    const server = definition('docs')
    const hooks = {}
    defineAdminConfig({ collections: [client], i18n })
    defineServerConfig({
      collections: [server],
      db: {} as IDbAdapter,
      hooks: { collections: { docs: hooks } },
      i18n,
    } satisfies ServerConfig)

    expect(getCollectionDefinition('docs')).toBe(server)
    expect(getCollectionDefinition('docs')?.hooks).toBe(hooks)
  })
})

describe('admin resource config lookup', () => {
  it('returns only the admin config matching the requested resource kind', () => {
    const pages = defineCollection({
      path: 'pages',
      labels: { singular: 'Page', plural: 'Pages' },
      fields: [{ name: 'title', label: 'Title', type: 'text' }],
    })
    const settings = defineSingleton({
      path: 'site-settings',
      label: 'Site settings',
      fields: [{ name: 'title', label: 'Title', type: 'text' }],
    })
    const pagesAdmin = defineAdmin(pages, {})
    const settingsAdmin = defineSingletonAdmin(settings, {})

    defineAdminConfig({
      collections: [pages, settings],
      admin: [pagesAdmin, settingsAdmin],
      i18n,
    })

    expect(getCollectionAdminConfig(pages.path)).toBe(pagesAdmin)
    expect(getCollectionAdminConfig(settings.path)).toBeNull()
    expect(getSingletonAdminConfig(settings.path)).toBe(settingsAdmin)
    expect(getSingletonAdminConfig(pages.path)).toBeNull()
  })
})
