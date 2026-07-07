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
import {
  lexicalEditorEmbedServer,
  lexicalEditorPopulateServer,
  lexicalEditorToMarkdownServer,
  lexicalEditorToTextServer,
} from '@byline/richtext-lexical/server'
import { migrate, postgresSearch } from '@byline/search-postgres'
import { localStorageProvider } from '@byline/storage-local'

// Import collection definitions directly from schema files — NOT the full
// admin config or index barrels. The admin config / index files pull in
// admin UI configs (React components, CSS modules) that are not loadable
// outside Vite (e.g. when running seeds via tsx).
import { Docs } from './collections/docs/schema.js'
import { Media } from './collections/media/schema.js'
import { News } from './collections/news/schema.js'
import { NewsCategories } from './collections/news-categories/schema.js'
import { Pages } from './collections/pages/schema.js'
import { i18n } from './i18n.js'
import { DEFAULT_SERVER_URL, routes } from './routes.js'

const serverURL = process.env.VITE_SERVER_URL || DEFAULT_SERVER_URL

const collections = [Docs, News, Pages, Media, NewsCategories]

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

  // Ensure the search-index schema before the provider serves any traffic.
  // `@byline/search-postgres` owns its schema (numbered SQL inside the
  // package) and applies it via `migrate(pool)` — it is NOT part of the
  // host's Drizzle migration stream. We run it deliberately here, rather
  // than relying on the driver's `autoMigrate` option, so startup DDL is an
  // explicit, awaited step. Reuses the adapter's pool — no second
  // connection. See docs/05-reading-and-delivery/07-search.md.
  //
  // Wrapped defensively: a migration failure degrades search but must not
  // take down the whole app at boot. We log loudly and continue. (For
  // locked-down Postgres where the app role can't run DDL, drop this call and
  // apply `migrations/0001_init.sql` by hand as a deploy step instead.)
  try {
    await migrate(db.pool, { log: (m) => console.log(m) })
  } catch (err) {
    console.error('[search-postgres] migrate failed — search may be unavailable:', err)
  }

  const adminStore = createAdminStore(db.drizzle)

  // Built-in JWT session provider. Signing secret comes from the
  // environment — see `.env.local.example`. Phase 5 uses HS256 with Byline's
  // default TTLs (15-minute access, 30-day refresh). Alternative providers
  // (Lucia, better-auth, WorkOS, Clerk, institutional SSO) can be dropped
  // in here by implementing the `SessionProvider` interface from
  // `@byline/auth`.
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
    // deployments. The `uploadDir` is served at `baseUrl` by a runtime
    // handler in `src/server.ts` — NOT by the framework's static-asset
    // pipeline. Keeping uploads outside `public/` is what lets newly-
    // uploaded files appear without a rebuild: `vite build` snapshots
    // `public/` into `.output/public/`, but the runtime handler reads
    // `uploadDir` directly on every request. For cloud/production
    // deployments, swap to `@byline/storage-s3` — see the commented
    // example below.
    storage: localStorageProvider({
      uploadDir: './uploads',
      baseUrl: '/uploads',
    }),
    // S3-compatible alternative (AWS S3 / Cloudflare R2 / MinIO). Replace
    // the `localStorageProvider` block above with the call below and add
    // the corresponding `BYLINE_STORAGE_S3_*` entries to your `.env.local`
    // (see `apps/webapp/.env.local.example`).
    //
    // On AWS with an IAM role / instance profile, omit `accessKeyId` and
    // `secretAccessKey` so the SDK resolves credentials via its default
    // provider chain — never bake long-lived keys into a deployed image.
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
      // Server-side richtext adapter — refreshes embedded relation
      // envelopes (link `{ title, path }`, inline-image `{ title, altText,
      // image, sizes }`) on every read, gated per-field by
      // `populateRelationsOnRead`. See docs/04-collections/06-rich-text.md for the full design.
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
      richText: {
        embed: lexicalEditorEmbedServer({ getClient: getAdminBylineClient }),
        populate: lexicalEditorPopulateServer({ getClient: getAdminBylineClient }),
        // One-way Lexical → markdown serializer for the agent-readable export
        // surface (`.md` content routes, `llms.txt`). Pure JSON walk — no
        // client needed. Remove if you don't expose the markdown surface.
        toMarkdown: lexicalEditorToMarkdownServer(),
        // Plain-text extractor for search indexing — flattens rich-text
        // `body` fields to indexable text for `buildSearchDocument`. Pure
        // JSON walk, no client. Required by any collection that lists a
        // richText field in its `search.body`. See
        // docs/05-reading-and-delivery/07-search.md.
        toText: lexicalEditorToTextServer(),
      },
    },
    // Built-in Postgres full-text search provider. Reuses the adapter's pool
    // (no second connection); the search index lives in the same database.
    // Collections opt in via their `search` config (see
    // collections/docs/schema.ts) and keep the index live via lifecycle
    // hooks (see collections/docs/hooks.ts). Remove this registration if no
    // collection declares a `search` config.
    search: postgresSearch({ pool: db.pool, defaultLocale: i18n.content.defaultLocale }),
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
