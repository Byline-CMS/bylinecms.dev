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
 */

import { type AdminStore, registerAdminAbilities } from '@byline/admin'
import { JwtSessionProvider } from '@byline/admin/auth'
import { type BylineCore, initBylineCore } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import { createAdminStore } from '@byline/db-postgres/admin'
import { getAdminBylineClient } from '@byline/host-tanstack-start/integrations/byline-client'
import { lexicalEditorServer } from '@byline/richtext-lexical/server'
import { localStorageProvider } from '@byline/storage-local'

// Import collection definitions directly from schema files — NOT the full
// admin config or index barrels. The admin config / index files pull in
// admin UI configs (React components, CSS modules) that are not loadable
// outside Vite (e.g. when running seeds via tsx).
import { Docs } from './collections/docs/schema.js'
import { DocsCategories } from './collections/docs-categories/schema.js'
import { Media } from './collections/media/schema.js'
import { News } from './collections/news/schema.js'
import { NewsCategories } from './collections/news-categories/schema.js'
import { Pages } from './collections/pages/schema.js'
import { i18n } from './i18n.js'
import { DEFAULT_SERVER_URL, routes } from './routes.js'

const serverURL = process.env.VITE_SERVER_URL || DEFAULT_SERVER_URL

const collections = [Docs, News, Pages, Media, DocsCategories, NewsCategories]

// HMR-safe singleton. Vite's program reload re-evaluates this module
// without disposing the previous module's resources — every reload
// would otherwise allocate a fresh pg `Pool` (max: 20) inside
// `pgAdapter`, the previous pool would orphan but stay alive, and
// after a handful of HMR cycles Postgres' `max_connections` is
// exhausted and every query fails with `53300 sorry, too many clients
// already`. Stashing the resolving `Promise` (so concurrent reloads
// converge on one build) lets module reloads reuse the same pool.
// Production has no HMR so this guard is a no-op there.
declare global {
  // biome-ignore lint: globalThis augmentation requires `var` rather than `let`
  var __bylineCoreSingleton__: Promise<BylineCore<AdminStore>> | undefined
}

async function buildBylineCore(): Promise<BylineCore<AdminStore>> {
  // Construct the db adapter up-front so we can thread its drizzle handle
  // into the session provider without a second connection pool. The admin
  // store bundles the four admin repositories (users / roles / permissions
  // / refresh tokens) that `JwtSessionProvider`, the admin-user server
  // fns, and the super-admin seed all consume. Built once here and
  // surfaced on `bylineCore.adminStore` so downstream callers talk to
  // `AdminStore` — the interface — rather than casting the adapter.
  //
  // Future approaches, if/when the wiring grows:
  //
  //   Option B — Adapter-owned admin store. Have `pgAdapter()` return
  //   `{ ..., adminStore }` directly so the integration point doesn't
  //   need the separate `createAdminStore(db.drizzle)` call or the
  //   `@byline/db-postgres/admin` import. Widens the adapter contract
  //   slightly but removes one more concrete-adapter mention from this
  //   file.
  //
  //   Option C — Full DI via `@byline/core`'s `Registry`. Register
  //   `adminStore` as a typed factory keyed off `db`; adapters
  //   contribute the factory, `initBylineCore()` composes it. Most
  //   flexible (lazy construction, test wiring, multi-store setups) but
  //   heavier until we have a second adapter or a second DI consumer
  //   to justify the ceremony.
  const db = pgAdapter({
    connectionString: process.env.DB_CONNECTION_STRING || '',
    collections,
  })

  const adminStore = createAdminStore(db.drizzle)

  // Built-in JWT session provider. Signing secret comes from the
  // environment — see `.env.example`. Phase 5 uses HS256 with Byline's
  // default TTLs (15-minute access, 30-day refresh). Alternative providers
  // (Lucia, better-auth, WorkOS, Clerk, institutional SSO) can be dropped
  // in here by implementing the `SessionProvider` interface from
  // `@byline/auth`.
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
    // Site-wide default storage provider — used by any upload collection
    // that does not specify its own `upload.storage` override.
    //
    // To route a specific collection to a different backend, set `storage`
    // inside that collection's `upload` config block instead of (or in
    // addition to) this site-wide default.
    //
    // Local filesystem is suitable for development and self-hosted
    // deployments. Swap for '@byline/storage-s3' (s3StorageProvider) for
    // cloud/production. The `uploadDir` is served as a static path at
    // `baseUrl` by your web server.
    storage: localStorageProvider({
      uploadDir: './public/uploads',
      baseUrl: '/uploads',
    }),
    sessionProvider,
    fields: {
      // Server-side richtext adapter — refreshes embedded relation
      // envelopes (link `{ title, path }`, inline-image `{ title, altText,
      // image, sizes }`) on every read, gated per-field by
      // `populateRelationsOnRead`. See docs/RICHTEXT.md for the full design.
      //
      // `getClient` returns a `BylineClient` — the SDK over the storage
      // primitives that the populate visitors use to batch-fetch target
      // documents (e.g. `client.collection('media').find({ where: { id:
      // { $in: [...] } } })`). The client carries the DB adapter, the
      // collection registry, the request-context resolver, and every
      // read-pipeline phase (`beforeRead` → populate → `afterRead`), so
      // populate's nested reads run under the *same* authenticated actor
      // and the *same* `ReadContext` as the request that triggered them.
      // That's what makes A→B→A cycle protection and visited-set dedup
      // work across relation populate, richtext populate, and any user-
      // land `afterRead` hooks.
      //
      // We pass `getAdminBylineClient` (not the public client) because
      // admin server fns are the only call sites that read documents in
      // the admin webapp today — the populate phase inherits whichever
      // actor the request resolved. A future public-facing host would
      // register its own client whose `requestContext` factory resolves
      // an end-user actor instead. See `@byline/host-tanstack-start/
      // integrations/byline-client.ts` for how the admin client is built.
      //
      // Why a getter, not a value: `getAdminBylineClient()` reads the
      // server config singleton, which is only populated *after*
      // `initBylineCore()` returns. Passing a factory defers resolution
      // to populate-call time so registration order here doesn't matter.
      richText: { populate: lexicalEditorServer({ getClient: getAdminBylineClient }) },
    },
  })

  // Register admin-subsystem abilities (admin.users.*, admin.roles.*) on
  // the shared registry. Collection abilities are auto-registered by
  // `initBylineCore()`; admin abilities are opt-in here so `@byline/core`
  // does not depend on `@byline/admin`.
  registerAdminAbilities(core.abilities)

  return core
}

// Cache the *Promise*, not the resolved value, so concurrent module
// loads during a reload race converge on a single build rather than
// each starting their own. The top-level `await` surfaces init errors
// at module load time; downstream callers retrieve the resolved core
// via `getBylineCore<AdminStore>()` from `@byline/core`.
globalThis.__bylineCoreSingleton__ ??= buildBylineCore()
await globalThis.__bylineCoreSingleton__
