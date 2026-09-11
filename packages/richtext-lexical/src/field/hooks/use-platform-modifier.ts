'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useSyncExternalStore } from 'react'

import { IS_APPLE } from '../shared/environment'

/** Never changes after load, so nothing to subscribe to. */
const subscribe = () => () => {}

/**
 * Whether to label keyboard shortcuts the Apple way.
 *
 * `IS_APPLE` is resolved at module scope from `navigator.platform`, which
 * is false on the server and true on a Mac client. Reading it directly
 * during render therefore produced markup the server and client
 * disagreed about — React reported a hydration mismatch on the toolbar's
 * `title` and `aria-label` attributes and, as it warns, did not patch
 * them up: a Mac user could be shown `Ctrl+B`, and a screen reader could
 * announce it.
 *
 * `useSyncExternalStore` uses its server snapshot for the initial client
 * render as well as for SSR, so the first client render matches the
 * server exactly and the real platform is adopted immediately after.
 */
export function useIsApplePlatform(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => IS_APPLE,
    // Server, and the hydrating client render: the platform is unknown
    // to the server, so both must agree on the same answer.
    () => false
  )
}
