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
 * collection schemas to the shared tuple in `byline/collections/index.ts`.
 */

import { type AdminStore, registerAdminAbilities } from '@byline/admin'
import { JwtSessionProvider } from '@byline/admin/auth'
import { type BylineCore, initBylineCore } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import { createAdminStore } from '@byline/db-postgres/admin'
import {
  lexicalEditorEmbedServer,
  lexicalEditorPopulateServer,
  lexicalEditorToMarkdownServer,
} from '@byline/richtext-lexical/server'
import { localStorageProvider } from '@byline/storage-local'

import { getAdminBylineClient } from './clients.server.js'
import { collections } from './collections/index.js'
import { serverHooks } from './collections/server-hooks.js'
import { i18n } from './i18n.js'
import { DEFAULT_SERVER_URL, routes } from './routes.js'

const serverURL = process.env.VITE_SERVER_URL || DEFAULT_SERVER_URL

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
    connectionString: process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING || '',
    collections,
    defaultContentLocale: i18n.content.defaultLocale,
    // Optional pg connection pool tuning. Omit (or leave the env vars
    // unset) to use the adapter defaults: max=20, idleTimeoutMillis=2000,
    // connectionTimeoutMillis=30000. Worth tuning for serverless
    // Postgres providers (e.g. Neon) where the database sleeps and cold
    // starts can stretch past a short connect timeout — 30s is a safe
    // starting point.
    //
    // max: process.env.BYLINE_DB_POSTGRES_MAX_POOL
    //   ? Number(process.env.BYLINE_DB_POSTGRES_MAX_POOL)
    //   : undefined,
    // idleTimeoutMillis: process.env.BYLINE_DB_POSTGRES_IDLE_TIMEOUT_MILLIS
    //   ? Number(process.env.BYLINE_DB_POSTGRES_IDLE_TIMEOUT_MILLIS)
    //   : undefined,
    // connectionTimeoutMillis: process.env.BYLINE_DB_POSTGRES_CONNECTION_TIMEOUT_MILLIS
    //   ? Number(process.env.BYLINE_DB_POSTGRES_CONNECTION_TIMEOUT_MILLIS)
    //   : undefined,
  })

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

  const core = await initBylineCore<AdminStore>({
    serverURL,
    i18n,
    routes,
    collections,
    hooks: serverHooks,
    db,
    adminStore,
    // Local filesystem — suitable for development and self-hosted
    // deployments. For cloud/production, swap to `@byline/storage-s3`
    // (see the commented example below).
    //
    // IMPORTANT: `uploadDir` lives OUTSIDE `public/` on purpose. With
    // TanStack Start + Nitro, anything under `public/` is snapshotted
    // into `.output/public/` at build time, and the static handler reads
    // from that snapshot — so newly-uploaded files 404 until the next
    // rebuild. Pair this with a runtime `/uploads/*` handler in
    // `src/server.ts` that streams from `uploadDir` on every request.
    storage: localStorageProvider({
      uploadDir: './uploads',
      baseUrl: '/uploads',
    }),
    // S3-compatible alternative (AWS S3 / Cloudflare R2 / MinIO). Replace
    // the `localStorageProvider` block above with the call below and add
    // the matching `BYLINE_STORAGE_S3_*` entries to your `.env.local`.
    //
    // On AWS with an IAM role / instance profile, omit `accessKeyId` and
    // `secretAccessKey` — the SDK resolves credentials via its default
    // provider chain. Never bake long-lived keys into a deployed image.
    //
    // import { s3StorageProvider } from '@byline/storage-s3'
    //
    // storage: s3StorageProvider({
    //   bucket: process.env.BYLINE_STORAGE_S3_BUCKET!,
    //   region: process.env.BYLINE_STORAGE_S3_REGION!,
    //   accessKeyId: process.env.BYLINE_STORAGE_S3_ACCESS_KEY_ID,
    //   secretAccessKey: process.env.BYLINE_STORAGE_S3_SECRET_ACCESS_KEY,
    //   publicUrl: process.env.BYLINE_STORAGE_S3_PUBLIC_URL,
    //   endpoint: process.env.BYLINE_STORAGE_S3_ENDPOINT,
    //   forcePathStyle: process.env.BYLINE_STORAGE_S3_FORCE_PATH_STYLE === 'true',
    //   pathPrefix: process.env.BYLINE_STORAGE_S3_PATH_PREFIX,
    //   cacheControl: 'public, max-age=31536000, immutable',
    // }),
    sessionProvider,
    fields: {
      richText: {
        embed: lexicalEditorEmbedServer({ getClient: getAdminBylineClient }),
        populate: lexicalEditorPopulateServer({ getClient: getAdminBylineClient }),
        // One-way Lexical → markdown serializer for the agent-readable export
        // surface (`.md` content routes, `llms.txt`). Pure JSON walk — no
        // client needed. Remove if you don't expose the markdown surface.
        toMarkdown: lexicalEditorToMarkdownServer(),
      },
    },
  })

  registerAdminAbilities(core.abilities)
  return core
}

globalThis.__bylineCoreSingleton__ ??= buildBylineCore()
await globalThis.__bylineCoreSingleton__
