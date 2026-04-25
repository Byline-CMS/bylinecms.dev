/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/admin` — the admin subsystem.
 *
 * Concrete implementation of the admin side of Byline: admin users,
 * roles, permissions, account self-service, and the built-in JWT
 * session provider. Depends on `@byline/auth` (the Actor / RequestContext
 * / SessionProvider contract) and `@byline/core` (collection and lifecycle
 * machinery). Third-party session providers (Lucia, WorkOS, Clerk, SSO)
 * are intentionally kept out of this package — they live as separate
 * adapters against `@byline/auth` directly.
 *
 * Prefer the per-module subpath exports (`@byline/admin/admin-users`,
 * `@byline/admin/auth`, etc.) over the root barrel; this root exists so
 * the package is importable as a single unit when that is convenient.
 */

export { registerAdminAbilities } from './abilities.js'
export { assertAdminActor, requireAdminActor } from './lib/assert-admin-actor.js'
export * from './modules/admin-account/index.js'
export * from './modules/admin-permissions/index.js'
export * from './modules/admin-roles/index.js'
export * from './modules/admin-users/index.js'
export * from './modules/auth/index.js'
export type { AdminStore } from './store.js'
