/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * TanStack Router adapter for the framework-agnostic NavigationGuard interface.
 *
 * This file lives in the webapp (not in `@byline/ui`) because it depends on
 * `@tanstack/react-router` — a framework-specific dependency.
 */

import { useCallback } from 'react'
import { useBlocker } from '@tanstack/react-router'

import type { NavigationGuardResult, UseNavigationGuard } from './navigation-guard'

/**
 * Navigation guard backed by TanStack Router's `useBlocker`.
 *
 * Blocks both in-app (soft) navigation and the browser's native `beforeunload`
 * event when `shouldBlock` is `true`.
 */
export const useTanStackNavigationGuard: UseNavigationGuard = (shouldBlock) => {
  const shouldBlockFn = useCallback(() => shouldBlock, [shouldBlock])

  const blocker = useBlocker({
    shouldBlockFn,
    enableBeforeUnload: shouldBlock,
    withResolver: true,
  })

  const result: NavigationGuardResult = {
    isBlocked: blocker.status === 'blocked',
    stay: () => blocker.reset?.(),
    proceed: () => blocker.proceed?.(),
  }

  return result
}
