/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Webapp transport for `@byline/admin/admin-account` self-service.
 *
 * Mirrors the admin-users / admin-roles module shape: each operation
 * is a thin `createServerFn` wrapper that resolves a `RequestContext`
 * and delegates to the matching `*Command` from the package. The
 * actor is the target — none of these accept an `id`.
 */

// Re-exports from the package, useful for components that need to
// type-narrow against the response shape without pulling
// `@byline/admin/admin-account` into the client bundle (which would
// transitively pull argon2 in via the package barrel).
export type { AccountResponse } from '@byline/admin/admin-account'

export { changeAccountPassword } from './server/change-password'
export { getAccount } from './server/get'
export { updateAccount } from './server/update'
export type { ChangeAccountPasswordInput } from './server/change-password'
export type { UpdateAccountInput } from './server/update'
