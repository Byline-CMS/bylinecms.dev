import type { Logger as PinoLogger } from 'pino'
import { describe, expect, it } from 'vitest'

import { defineServerConfig, getServerConfig } from './config/config.js'
import { initBylineCore } from './core.js'
import type { IDbAdapter, ServerConfig } from './@types/index.js'

function serverConfig(admin: string): ServerConfig {
  return {
    serverURL: 'https://example.test',
    routes: { admin },
    collections: [],
    db: {} as IDbAdapter,
    i18n: {
      interface: { defaultLocale: 'en', locales: [] },
      content: { defaultLocale: 'en', locales: [] },
    },
  }
}

describe('initBylineCore configuration registration', () => {
  it('does not overwrite a valid singleton when synchronous validation fails', async () => {
    const valid = defineServerConfig(serverConfig('/stable/admin'))
    const invalid = serverConfig('/replacement/admin')
    invalid.i18n = {
      interface: { defaultLocale: 'en', locales: ['en'] },
      content: { defaultLocale: 'en', locales: [] },
    }

    await expect(initBylineCore(invalid, {} as PinoLogger)).rejects.toThrow(/translations bundle/i)
    expect(getServerConfig()).toBe(valid)
    expect(getServerConfig().routes.admin).toBe('/stable/admin')
  })
})
