/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/admin/admin-account` — reserved for self-service surfaces
 * (password change, profile fields, active-session listing) for the
 * currently signed-in admin user.
 *
 * Empty placeholder. The module exists so the package's subpath layout
 * is stable and so `@byline/admin/admin-account` can be imported the
 * moment a concrete affordance lands. Available affordances will depend
 * on the configured `SessionProvider` (e.g. `capabilities.passwordChange`).
 */

export {}
