/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-side Byline bootstrap. Imported as a side-effect from
 * `src/server.ts` (and from any seed / migration script that needs the
 * configured runtime). Resolves the composed `BylineCore` and registers
 * it on the process global via `initBylineCore()` — server-side callers
 * read it back with `getBylineCore<AdminStore>()`.
 *
 * This is the minimal scaffold: no example collections registered. Add
 * collection schemas to the `collections` array as you create them under
 * `byline/collections/<name>/schema.ts`.
 */

import { type AdminStore, registerAdminAbilities } from '@byline/admin'
import { JwtSessionProvider } from '@byline/admin/auth'
import { type BylineCore, initBylineCore } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import { createAdminStore } from '@byline/db-postgres/admin'
import { getAdminBylineClient } from '@byline/host-tanstack-start/integrations/byline-client'
import { lexicalEditorServer } from '@byline/richtext-lexical/server'
import { localStorageProvider } from '@byline/storage-local'

import { i18n } from './i18n.js'
import { DEFAULT_SERVER_URL, routes } from './routes.js'

const serverURL = process.env.VITE_SERVER_URL || DEFAULT_SERVER_URL

const collections: Parameters<typeof pgAdapter>[0]['collections'] = []

// HMR-safe singleton. Vite's program reload re-evaluates this module
// without disposing the previous module's resources — every reload
// would otherwise allocate a fresh pg `Pool` (max: 20) inside
// `pgAdapter`, the previous pool would orphan but stay alive, and
// after a handful of HMR cycles Postgres' `max_connections` is
// exhausted. Stashing the resolving `Promise` lets module reloads
// reuse the same pool. Production has no HMR so this guard is a no-op.
declare global {
  // biome-ignore lint: globalThis augmentation requires `var` rather than `let`
  var __bylineCoreSingleton__: Promise<BylineCore<AdminStore>> | undefined
}

async function buildBylineCore(): Promise<BylineCore<AdminStore>> {
  const db = pgAdapter({
    connectionString: process.env.DB_CONNECTION_STRING || '',
    collections,
  })

  const adminStore = createAdminStore(db.drizzle)

  const signingSecret = process.env.BYLINE_JWT_SECRET
  if (!signingSecret || signingSecret.length < 32) {
    throw new Error(
      'BYLINE_JWT_SECRET must be set and carry at least 32 bytes of entropy. ' +
        'Generate one with `openssl rand -base64 48` and add it to your .env.'
    )
  }

  const sessionProvider = new JwtSessionProvider({
    store: adminStore,
    signingSecret,
  })

  const core = await initBylineCore<AdminStore>({
    serverURL,
    i18n,
    routes,
    collections,
    db,
    adminStore,
    storage: localStorageProvider({
      uploadDir: './public/uploads',
      baseUrl: '/uploads',
    }),
    sessionProvider,
    fields: {
      richText: { populate: lexicalEditorServer({ getClient: getAdminBylineClient }) },
    },
  })

  registerAdminAbilities(core.abilities)
  return core
}

globalThis.__bylineCoreSingleton__ ??= buildBylineCore()
await globalThis.__bylineCoreSingleton__
