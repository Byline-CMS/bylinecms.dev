import { type AdminStore, registerAdminAbilities } from '@byline/admin'
import { JwtSessionProvider } from '@byline/admin/auth'
import { initBylineCore } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import { createAdminStore } from '@byline/db-postgres/admin'
import { localStorageProvider } from '@byline/storage-local'

// Import collection definitions directly from schema files — NOT the full
// client config or index barrels. The client config / index files pull in
// admin configs (React components, CSS modules) that are not loadable
// outside Vite (e.g. when running seeds via tsx).
import { Categories } from './byline/collections/categories/schema.js'
import { Docs } from './byline/collections/docs/schema.js'
import { Media } from './byline/collections/media/schema.js'
import { News } from './byline/collections/news/schema.js'
import { Pages } from './byline/collections/pages/schema.js'
import { i18n } from './byline/i18n.js'

const collections = [Docs, News, Pages, Media, Categories]

// Construct the db adapter up-front so we can thread its drizzle handle into
// the session provider without a second connection pool. The admin store
// bundles the four admin repositories (users / roles / permissions / refresh
// tokens) that `JwtSessionProvider`, the admin-user server fns, and the
// super-admin seed all consume. Built once here and surfaced on
// `bylineCore.adminStore` so downstream callers talk to `AdminStore` — the
// interface — rather than casting the adapter.
//
// Future approaches, if/when the wiring grows:
//
//   Option B — Adapter-owned admin store. Have `pgAdapter()` return
//   `{ ..., adminStore }` directly so the integration point doesn't need
//   the separate `createAdminStore(db.drizzle)` call or the
//   `@byline/db-postgres/admin` import. Widens the adapter contract slightly
//   but removes one more concrete-adapter mention from this file.
//
//   Option C — Full DI via `@byline/core`'s `Registry`. Register
//   `adminStore` as a typed factory keyed off `db`; adapters contribute
//   the factory, `initBylineCore()` composes it. Most flexible (lazy
//   construction, test wiring, multi-store setups) but heavier until we
//   have a second adapter or a second DI consumer to justify the
//   ceremony.
const db = pgAdapter({
  connectionString: process.env.DB_CONNECTION_STRING || '',
  collections,
})

const adminStore = createAdminStore(db.drizzle)

// Built-in JWT session provider. Signing secret comes from the environment —
// see `.env.example`. Phase 5 uses HS256 with Byline's default TTLs
// (15-minute access, 30-day refresh). Alternative providers (Lucia,
// better-auth, WorkOS, Clerk, institutional SSO) can be dropped in here by
// implementing the `SessionProvider` interface from `@byline/auth`.
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

export const bylineCore = await initBylineCore<AdminStore>({
  serverURL: 'http://localhost:5173/',
  i18n,
  collections,
  db,
  adminStore,
  // Site-wide default storage provider — used by any upload collection that
  // does not specify its own `upload.storage` override.
  //
  // To route a specific collection to a different backend, set `storage`
  // inside that collection's `upload` config block instead of (or in addition
  // to) this site-wide default.
  //
  // Local filesystem is suitable for development and self-hosted deployments.
  // Swap for '@byline/storage-s3' (s3StorageProvider) for cloud/production.
  // The `uploadDir` is served as a static path at `baseUrl` by your web server.
  storage: localStorageProvider({
    uploadDir: './public/uploads',
    baseUrl: '/uploads',
  }),
  sessionProvider,
})

// Register admin-subsystem abilities (admin.users.*, admin.roles.*) on the
// shared registry. Collection abilities are auto-registered by
// `initBylineCore()`; admin abilities are opt-in here so `@byline/core` does
// not depend on `@byline/admin`.
registerAdminAbilities(bylineCore.abilities)
