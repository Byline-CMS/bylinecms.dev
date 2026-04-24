/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/admin/auth` — session handling for the built-in admin realm.
 *
 * Hosts the reference `JwtSessionProvider` and the sign-in / refresh /
 * revoke orchestration that consumes it, along with password hashing
 * (`hashPassword` / `verifyPassword`) and the `RefreshTokensRepository`
 * contract the provider drives.
 *
 * The `SessionProvider` **interface** lives in `@byline/auth` so the
 * pluggability contract stays narrow; this module supplies the
 * Byline-native implementation. Third-party providers (Lucia, WorkOS,
 * Clerk, institutional SSO) should be shipped as separate packages
 * against `@byline/auth` rather than added here.
 */

export { JwtSessionProvider, type JwtSessionProviderConfig } from './jwt-session-provider.js'
export { hashPassword, verifyPassword } from './password.js'
export { resolveActor } from './resolve-actor.js'
export type {
  IssueRefreshTokenInput,
  RefreshTokenRow,
  RefreshTokensRepository,
} from './refresh-tokens-repository.js'
