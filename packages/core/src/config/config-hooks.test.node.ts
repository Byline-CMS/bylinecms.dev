import { afterEach, describe, expect, it } from 'vitest'

import { defineClientConfig, defineServerConfig, getCollectionDefinition } from './config.js'
import type { CollectionDefinition, IDbAdapter, ServerConfig } from '../@types/index.js'

const SERVER_CONFIG = Symbol.for('__byline_server_config__')
const CLIENT_CONFIG = Symbol.for('__byline_client_config__')
const previousServer = (globalThis as Record<PropertyKey, unknown>)[SERVER_CONFIG]
const previousClient = (globalThis as Record<PropertyKey, unknown>)[CLIENT_CONFIG]

afterEach(() => {
  const globals = globalThis as Record<PropertyKey, unknown>
  if (previousServer === undefined) delete globals[SERVER_CONFIG]
  else globals[SERVER_CONFIG] = previousServer
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
  interface: { defaultLocale: 'en', locales: [] },
  content: { defaultLocale: 'en', locales: [] },
}

describe('collection definition config preference', () => {
  it('uses client definitions when only client config is registered', () => {
    const globals = globalThis as Record<PropertyKey, unknown>
    delete globals[SERVER_CONFIG]
    delete globals[CLIENT_CONFIG]
    const client = definition('client-only')
    defineClientConfig({ serverURL: 'https://example.test', collections: [client], i18n })
    expect(getCollectionDefinition('client-only')).toBe(client)
  })

  it('prefers hook-attached server definitions when both configs are registered', () => {
    const globals = globalThis as Record<PropertyKey, unknown>
    delete globals[SERVER_CONFIG]
    delete globals[CLIENT_CONFIG]
    const client = definition('docs')
    const server = definition('docs')
    const hooks = {}
    defineClientConfig({ serverURL: 'https://example.test', collections: [client], i18n })
    defineServerConfig({
      serverURL: 'https://example.test',
      collections: [server],
      db: {} as IDbAdapter,
      hooks: { collections: { docs: hooks } },
      i18n,
    } satisfies ServerConfig)

    expect(getCollectionDefinition('docs')).toBe(server)
    expect(getCollectionDefinition('docs')?.hooks).toBe(hooks)
  })
})
