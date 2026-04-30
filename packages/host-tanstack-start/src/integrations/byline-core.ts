/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Typed accessor for the composed `BylineCore` post-init.
 *
 * Wraps `@byline/core`'s framework-neutral `getBylineCore<TAdminStore>()`
 * and pre-binds `TAdminStore` to `AdminStore` from `@byline/admin`. This
 * package is the admin host adapter — every server fn here ultimately
 * delegates to an `@byline/admin` command that wants the typed store, so
 * baking the generic in once removes the need for each call site to
 * repeat `getBylineCore<AdminStore>()` and to import `AdminStore`
 * separately.
 *
 * Hosts that wire a different admin-store flavour through
 * `initBylineCore<TOtherStore>()` should NOT use this helper — they
 * import `getBylineCore<TOtherStore>()` from `@byline/core` directly.
 * That escape hatch keeps the framework-neutral package agnostic to
 * which admin store is configured.
 */

import type { AdminStore } from '@byline/admin'
import { type BylineCore, getBylineCore } from '@byline/core'

export function bylineCore(): BylineCore<AdminStore> {
  return getBylineCore<AdminStore>()
}
