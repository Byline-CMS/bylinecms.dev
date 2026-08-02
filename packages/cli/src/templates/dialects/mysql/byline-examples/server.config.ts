/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-side Byline bootstrap for the MySQL example scaffold.
 */

import { type AdminStore, registerAdminAbilities } from '@byline/admin'
import { JwtSessionProvider } from '@byline/admin/auth'
import { getAdminBylineClient } from '@byline/client/server'
import { type BylineCore, initBylineCore } from '@byline/core'
import { mysqlAdapter } from '@byline/db-mysql'
import { createAdminStore } from '@byline/db-mysql/admin'
import { registerTanstackStartHostBridge } from '@byline/host-tanstack-start/integrations/host-bridge'
import {
  lexicalEditorEmbedServer,
  lexicalEditorPopulateServer,
  lexicalEditorToMarkdownServer,
  lexicalEditorToTextServer,
} from '@byline/richtext-lexical/server'
import { migrate, mysqlSearch } from '@byline/search-mysql'
import { localStorageProvider } from '@byline/storage-local'

import { collections } from './collections/index.js'
import { serverHooks } from './collections/server-hooks.js'
import { i18n } from './i18n.js'
import { routes } from './routes.js'


// HMR-safe singleton. Reusing the resolving Promise prevents development
// reloads from orphaning MySQL pools and exhausting server connections.
declare global {
  // biome-ignore lint: globalThis augmentation requires `var` rather than `let`
  var __bylineCoreSingleton__: Promise<BylineCore<AdminStore>> | undefined
}

async function buildBylineCore(): Promise<BylineCore<AdminStore>> {
  const db = mysqlAdapter({
    connectionString: process.env.BYLINE_DB_MYSQL_CONNECTION_STRING || '',
    collections,
    defaultContentLocale: i18n.content.defaultLocale,
    // Optional pool tuning. Omit these values to use the adapter defaults:
    // 20 connections, 2s idle timeout, and 30s connection timeout.
    connectionLimit: process.env.BYLINE_DB_MYSQL_CONNECTION_LIMIT
      ? Number(process.env.BYLINE_DB_MYSQL_CONNECTION_LIMIT)
      : undefined,
    idleTimeout: process.env.BYLINE_DB_MYSQL_IDLE_TIMEOUT_MILLIS
      ? Number(process.env.BYLINE_DB_MYSQL_IDLE_TIMEOUT_MILLIS)
      : undefined,
    connectTimeout: process.env.BYLINE_DB_MYSQL_CONNECTION_TIMEOUT_MILLIS
      ? Number(process.env.BYLINE_DB_MYSQL_CONNECTION_TIMEOUT_MILLIS)
      : undefined,
  })

  // Search owns its disposable projection and numbered migration stream.
  // Apply it explicitly at startup with the adapter's existing pool. A
  // migration failure degrades search without taking down the application.
  try {
    await migrate(db.pool, { log: (message) => console.log(message) })
  } catch (error) {
    console.error('[search-mysql] migrate failed — search may be unavailable:', error)
  }

  const adminStore = createAdminStore(db.drizzle)
  const signingSecret = process.env.BYLINE_JWT_SECRET
  if (!signingSecret || signingSecret.length < 32) {
    throw new Error(
      'BYLINE_JWT_SECRET must be set and carry at least 32 bytes of entropy. ' +
        'Generate one with `openssl rand -base64 48` and add it to your .env.local.'
    )
  }

  const sessionProvider = new JwtSessionProvider({
    store: adminStore,
    signingSecret,
  })

  registerTanstackStartHostBridge()

  const core = await initBylineCore<AdminStore>({
    i18n,
    routes,
    collections,
    hooks: serverHooks,
    db,
    adminStore,
    storage: localStorageProvider({
      uploadDir: './uploads',
      baseUrl: '/uploads',
    }),
    sessionProvider,
    fields: {
      richText: {
        embed: lexicalEditorEmbedServer({ getClient: getAdminBylineClient }),
        populate: lexicalEditorPopulateServer({ getClient: getAdminBylineClient }),
        toMarkdown: lexicalEditorToMarkdownServer(),
        toText: lexicalEditorToTextServer(),
      },
    },
    search: mysqlSearch({ pool: db.pool, defaultLocale: i18n.content.defaultLocale }),
  })

  registerAdminAbilities(core.abilities)
  return core
}

globalThis.__bylineCoreSingleton__ ??= buildBylineCore()
await globalThis.__bylineCoreSingleton__
