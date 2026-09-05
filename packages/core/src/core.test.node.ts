import type { Logger as PinoLogger } from 'pino'
import { describe, expect, it, vi } from 'vitest'

import { defineServerConfig, getServerConfig } from './config/config.js'
import { initBylineCore } from './core.js'
import type { IDbAdapter, ServerConfig } from './@types/index.js'

function serverConfig(admin: string): ServerConfig {
  return {
    routes: { admin },
    collections: [],
    db: {} as IDbAdapter,
    i18n: {
      admin: { defaultLocale: 'en', locales: [] },
      content: { defaultLocale: 'en', locales: [] },
    },
  }
}

describe('initBylineCore configuration registration', () => {
  it('does not overwrite a valid singleton when synchronous validation fails', async () => {
    const valid = defineServerConfig(serverConfig('/stable/admin'))
    const invalid = serverConfig('/replacement/admin')
    invalid.i18n = {
      admin: { defaultLocale: 'en', locales: ['en'] },
      content: { defaultLocale: 'en', locales: [] },
    }

    await expect(initBylineCore(invalid, {} as PinoLogger)).rejects.toThrow(/translations bundle/i)
    expect(getServerConfig()).toBe(valid)
    expect(getServerConfig().routes.admin).toBe('/stable/admin')
  })
})

it('rejects revision-incompatible storage before any boot database writes', async () => {
  const config = serverConfig('/revision-check/admin')
  const write = vi.fn()
  const schemaError = new Error('fence and upgrade the revision schema')
  config.db = {
    withTransaction: vi.fn(),
    withReadSnapshot: vi.fn(),
    revisions: {
      assertCompatibleSchema: vi.fn().mockRejectedValue(schemaError),
      isInTransaction: () => false,
      lock: vi.fn(),
      readStructure: vi.fn(),
      advance: vi.fn(),
    },
    commands: {
      collections: { create: write, update: write, lockCollectionRegistration: write },
      documents: { publishSchedules: { lockDocuments: write } },
      counters: { ensureCounterGroup: write },
    },
    backfillSourceLocales: write,
  } as unknown as IDbAdapter
  await expect(initBylineCore(config, {} as PinoLogger)).rejects.toBe(schemaError)
  expect(write).not.toHaveBeenCalled()
})
