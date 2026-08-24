/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Canonical server-side Byline bootstrap for the reference application.
 * `src/server.ts` imports it for its registration side effect; seeds and other
 * one-shot tools import it when they need the same configured runtime.
 *
 * This active example selects PostgreSQL for documents, search, and analytics;
 * local filesystem upload storage; JWT admin sessions; Lexical rich-text
 * adapters; scheduled publication; and analytics rollups. The commented MySQL
 * blocks show the coordinated provider substitutions without changing the
 * portable collection, admin, or host configuration.
 *
 * `initBylineCore()` validates and composes these choices, then registers the
 * resolved core. Server-only consumers retrieve it through typed helpers such
 * as `getBylineCore<AdminStore>()` and `getAdminBylineClient()`. Configuration
 * registers recurring tasks but never starts their timer; `src/server.ts` owns
 * scheduler startup for the long-running application process.
 */

import { type AdminStore, registerAdminAbilities } from '@byline/admin'
import { JwtSessionProvider } from '@byline/admin/auth'
import { createAnalytics, defineAnalyticsRollupTask, registerAnalytics } from '@byline/analytics'
// import { migrate as migrateAnalytics, mysqlAnalyticsStore } from '@byline/analytics-mysql'
import { migrate as migrateAnalytics, postgresAnalyticsStore } from '@byline/analytics-postgres'
import { getAdminBylineClient } from '@byline/client/server'
import { type BylineCore, initBylineCore } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import { createAdminStore } from '@byline/db-postgres/admin'
// ── MySQL adapter (end-to-end testing) ────────────────────────────────────────
// Comment out the two `@byline/db-postgres` imports above and uncomment these
// two, then follow the matching block in `buildBylineCore()` below.
//
// import { mysqlAdapter } from '@byline/db-mysql'
// import { createAdminStore } from '@byline/db-mysql/admin'
import { registerTanstackStartHostBridge } from '@byline/host-tanstack-start/integrations/host-bridge'
import {
  lexicalEditorEmbedServer,
  lexicalEditorPopulateServer,
  lexicalEditorToMarkdownServer,
  lexicalEditorToTextServer,
} from '@byline/richtext-lexical/server'
// import { migrate as migrateSearch, mysqlSearch } from '@byline/search-mysql'
import { migrate as migrateSearch, postgresSearch } from '@byline/search-postgres'
import { localStorageProvider } from '@byline/storage-local'

import { collections } from './collections/index.js'
import { serverHooks } from './collections/server-hooks.js'
import { i18n } from './i18n.js'
import { routes } from './routes.js'

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
  // A global augmentation requires `var`; TypeScript rejects `let` here.
  var __bylineCoreSingleton__: Promise<BylineCore<AdminStore>> | undefined
}

/** Construct and register one complete server runtime for this process. */
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
    // Required PostgreSQL DSN. Passing an empty value leaves the adapter to
    // report a single, provider-specific boot error when the env key is absent.
    connectionString: process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING || '',
    // The adapter fingerprints and stores values against this server-safe
    // schema tuple; it contains no admin presentation modules.
    collections,
    // Locale used when adapter operations need the installation's canonical
    // content fallback.
    defaultContentLocale: i18n.content.defaultLocale,
    // Pool tuning. Optional — `pgAdapter` ships sensible defaults
    // (max: 20, idle: 2s, connect: 30s). Override via env when running
    // against a serverless Postgres provider (e.g. Neon) where cold
    // starts can stretch the initial connect time.
    max: process.env.BYLINE_DB_POSTGRES_MAX_POOL
      ? Number(process.env.BYLINE_DB_POSTGRES_MAX_POOL)
      : undefined,
    idleTimeoutMillis: process.env.BYLINE_DB_POSTGRES_IDLE_TIMEOUT_MILLIS
      ? Number(process.env.BYLINE_DB_POSTGRES_IDLE_TIMEOUT_MILLIS)
      : undefined,
    connectionTimeoutMillis: process.env.BYLINE_DB_POSTGRES_CONNECTION_TIMEOUT_MILLIS
      ? Number(process.env.BYLINE_DB_POSTGRES_CONNECTION_TIMEOUT_MILLIS)
      : undefined,
  })

  // ── MySQL adapter (end-to-end testing) ──────────────────────────────────────
  //
  // Swapping adapters takes three coordinated edits:
  //
  //   1. the database, search-provider, and analytics-provider imports above
  //   2. this block — comment out the `pgAdapter({...})` call above, uncomment
  //      the `mysqlAdapter({...})` call below
  //   3. select `mysqlAnalyticsStore` in the analytics block and `mysqlSearch`
  //      in the `search:` entry of `initBylineCore()`
  //
  // Prerequisites:
  //
  //   • `BYLINE_DB_MYSQL_CONNECTION_STRING` in `apps/webapp/.env.local` — see
  //     `.env.local.example`. The MySQL container is `mysql/docker-compose.yml`
  //     (`cd mysql && ./mysql.sh up -d`).
  //   • a migrated database: `cd packages/db-mysql && pnpm drizzle:migrate`
  //   • seed data if you want content to look at: `cd apps/webapp && pnpm tsx
  //     byline/seed.ts` (it reads whichever adapter this file configures)
  //
  // const db = mysqlAdapter({
  //   connectionString: process.env.BYLINE_DB_MYSQL_CONNECTION_STRING || '',
  //   collections,
  //   defaultContentLocale: i18n.content.defaultLocale,
  //   // Pool tuning. Optional — `mysqlAdapter` ships the same defaults as
  //   // `pgAdapter` (20 connections, 2s idle, 30s connect), so a managed provider
  //   // that pauses idle databases gets the same cold-start headroom.
  //   connectionLimit: process.env.BYLINE_DB_MYSQL_CONNECTION_LIMIT
  //     ? Number(process.env.BYLINE_DB_MYSQL_CONNECTION_LIMIT)
  //     : undefined,
  //   idleTimeout: process.env.BYLINE_DB_MYSQL_IDLE_TIMEOUT_MILLIS
  //     ? Number(process.env.BYLINE_DB_MYSQL_IDLE_TIMEOUT_MILLIS)
  //     : undefined,
  //   connectTimeout: process.env.BYLINE_DB_MYSQL_CONNECTION_TIMEOUT_MILLIS
  //     ? Number(process.env.BYLINE_DB_MYSQL_CONNECTION_TIMEOUT_MILLIS)
  //     : undefined,
  // })

  // Ensure the search-index schema before the provider serves any traffic.
  // The selected search driver owns its schema in an independent numbered
  // migration stream. Both built-in SQL providers expose the same `migrate`
  // function shape and reuse their database adapter's existing pool.
  // Apply it deliberately here rather than relying on `autoMigrate` so
  // startup is deterministic and DDL is an explicit, awaited step. Reuses the
  // adapter's pool — no second connection. See the package README.
  //
  // Wrapped defensively: a migration failure degrades search but must not take
  // down the whole app at boot — log loudly and continue.
  //
  try {
    await migrateSearch(db.pool, { log: (m) => console.log(m) })
  } catch (err) {
    console.error('[search-postgres] migrate failed — search may be unavailable:', err)
  }

  // Analytics owns an independent numbered migration stream, just like the
  // search provider. Unlike optional search degradation, a configured
  // analytics subsystem must migrate successfully before its route and task
  // runtime are registered.
  await migrateAnalytics(db.pool, { log: (message) => console.log(message) })
  const analytics = registerAnalytics(
    createAnalytics({
      // Reuse the document adapter's pool; analytics owns tables and
      // migrations, not a second database connection pool.
      store: postgresAnalyticsStore({ pool: db.pool }),
      // store: mysqlAnalyticsStore({ pool: db.pool }),
      // Browser submissions must name one of these same-origin hosts. The
      // resolver prefers explicit analytics domains and otherwise derives the
      // local/reference host from `VITE_SERVER_URL`.
      publicDomains: resolveAnalyticsPublicDomains(),
      // Defense in depth: reject events for admin and internal namespaces even
      // if a modified browser agent bypasses its own ignored-prefix list.
      ignoredPathPrefixes: [routes.admin, routes.api, '/_byline', '/telemetry'],
    })
  )

  // Build the repository bundle once from the same Drizzle handle used by the
  // document adapter. Authentication, admin server functions, and seeds then
  // share transactions and do not allocate another pool.
  const adminStore = createAdminStore(db.drizzle)

  // Built-in JWT session provider. Signing secret comes from the
  // environment — see `.env.local.example`. It uses HS256 with Byline's
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
    // Users, roles, permissions, and refresh tokens use the shared admin
    // repository bundle created above.
    store: adminStore,
    // The provider signs access and refresh tokens; the secret never enters
    // client configuration.
    signingSecret,
  })

  // Register the TanStack Start `HostRequestBridge` before any
  // request-bound client getter (`@byline/client/server`) can run. The
  // host adapter also registers it from its own side-effect imports, but
  // doing it here makes registration structural at server boot rather
  // than dependent on which host module happens to load first.
  registerTanstackStartHostBridge()

  const core = await initBylineCore<AdminStore>({
    // One shared admin/content locale policy and translation registry.
    i18n,
    // Canonical host-owned paths; configuration does not mount HTTP routes.
    routes,
    // Portable schema tuple used for validation, lifecycle, and storage.
    collections,
    // Server-only lifecycle hooks are attached after schema validation, which
    // keeps their dependencies out of the collection-definition graph.
    hooks: serverHooks,
    // Primary document storage adapter and its optional scheduler capability.
    db,
    // Typed admin repositories exposed as `core.adminStore`.
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
      // Runtime-writable directory, resolved from the webapp working directory.
      uploadDir: './uploads',
      // Same-origin URL prefix handled by `src/server.ts` for stored files.
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
    // Authentication seam consumed by the TanStack admin transport.
    sessionProvider,
    fields: {
      // Server-side richtext adapter — refreshes embedded relation
      // envelopes (link `{ title, path }`, inline-image `{ title, altText,
      // image, sizes }`) on every read, gated per-field by
      // `populateRelationsOnRead`. See docs/04-collections/07-rich-text.md for the full design.
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
      // an end-user actor instead. See `packages/client/src/server/
      // clients.ts` (`@byline/client/server`) for how the admin client is built.
      //
      // Why a getter, not a value: `getAdminBylineClient()` reads the
      // server config singleton, which is only populated *after*
      // `initBylineCore()` returns. Passing a factory defers resolution
      // to populate-call time so registration order here doesn't matter.
      richText: {
        // Write-time visitor that refreshes stored relation envelopes before a
        // document version is committed.
        embed: lexicalEditorEmbedServer({ getClient: getAdminBylineClient }),
        // Read-time visitor that resolves configured embedded relations under
        // the current authenticated request context.
        populate: lexicalEditorPopulateServer({ getClient: getAdminBylineClient }),
        // One-way markdown serializer for the agent-readable export surface
        // (`.md` routes, `llms.txt`). Pure JSON walk — no client needed.
        toMarkdown: lexicalEditorToMarkdownServer(),
        // Plain-text extractor for search indexing — flattens rich-text to
        // indexable text for `buildSearchDocument`'s `body` feed. Pure JSON
        // walk, no client. See docs/06-search/index.md.
        toText: lexicalEditorToTextServer(),
      },
    },
    // Built-in SQL full-text search provider. Reuses the adapter's pool
    // (no second connection); the search index lives in the same database.
    // Collections opt in via their `search` config; lifecycle
    // hooks maintain the index (see e.g. `collections/docs/hooks.ts`).
    search: postgresSearch({
      // Search tables share the selected database adapter's connection pool.
      pool: db.pool,
      // Analyzer fallbacks must agree with document lifecycle locale defaults.
      defaultLocale: i18n.content.defaultLocale,
    }),
    // search: mysqlSearch({ pool: db.pool, defaultLocale: i18n.content.defaultLocale }),
    // Optional document-grain delayed publication. This registers the inert
    // recurring task; the webapp's server entry starts the ticker explicitly
    // so seeds, migrations, and other imports of this config never start one.
    scheduledPublication: {
      // Contributes Byline's built-in publication sweep to the recurring task
      // registry. It does not start a timer during configuration.
      enabled: true,
    },
    // Application-defined recurring tasks sit beside built-in tasks. The
    // analytics definition performs catch-up rollups and retention maintenance;
    // `src/server.ts` runs the combined validated registry.
    recurringTasks: [defineAnalyticsRollupTask({ analytics })],
  })

  // Analytics is created before core so its task can be registered above.
  // Connect it to the application logger afterward; the runtime logs only
  // operational counts and sanitized persistence error metadata.
  analytics.setLogger(core.logger)

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

/** Resolve the allowlist used by analytics origin validation. */
function resolveAnalyticsPublicDomains(): string[] {
  // An explicit comma-separated list supports installations serving several
  // public domains and takes precedence over the general site URL.
  const configured = process.env.BYLINE_ANALYTICS_PUBLIC_DOMAINS
  if (configured != null && configured.trim() !== '') {
    return configured
      .split(',')
      .map((domain) => domain.trim())
      .filter(Boolean)
  }

  // The reference app already requires its public URL for host behavior, so a
  // single-domain installation need not repeat the host in another variable.
  const publicUrl = process.env.VITE_SERVER_URL
  if (publicUrl != null) {
    try {
      return [new URL(publicUrl).host]
    } catch {
      // The analytics config validator reports malformed explicit domains;
      // an invalid public URL simply falls through to the local default.
    }
  }
  // Final development default. Production deployments should always provide a
  // valid public URL or explicit analytics domain list.
  return ['localhost:5173']
}
