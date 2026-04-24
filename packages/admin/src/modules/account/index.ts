/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/admin/account` — self-service for the currently signed-in
 * admin user.
 *
 * Password change, profile fields, active-session listing and revocation.
 * Available affordances depend on the configured `SessionProvider` —
 * password change is gated by `capabilities.passwordChange`, and session
 * listing depends on whether the provider exposes per-session state.
 */

export {}
