/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Framework-agnostic navigation guard adapter.
 *
 * Different router frameworks (TanStack Router, Next.js, React Router, etc.)
 * each have their own mechanism for blocking navigation when a form has unsaved
 * changes.  This module defines a common interface so that `FormRenderer` can
 * remain framework-independent — the consuming application injects the
 * appropriate adapter via a prop or React context.
 */

import { createContext, useContext, useEffect } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The result returned by a `UseNavigationGuard` hook. */
export interface NavigationGuardResult {
  /** Whether a navigation attempt is currently being blocked (show confirmation UI). */
  isBlocked: boolean
  /** Cancel the pending navigation — stay on the current page. */
  stay: () => void
  /** Confirm the pending navigation — leave the page. */
  proceed: () => void
}

/**
 * A hook that blocks in-app navigation and (optionally) browser unload when
 * `shouldBlock` is `true`.
 *
 * Each framework adapter implements this signature.
 */
export type UseNavigationGuard = (shouldBlock: boolean) => NavigationGuardResult

// ---------------------------------------------------------------------------
// Default (no-op) implementation  — browser `beforeunload` only
// ---------------------------------------------------------------------------

/**
 * Fallback navigation guard that only handles the browser's native
 * `beforeunload` event.  In-app (client-side) route changes are **not**
 * intercepted — `isBlocked` will never become `true`.
 *
 * This is used when no framework-specific adapter has been provided.
 */
export const useBeforeUnloadGuard: UseNavigationGuard = (shouldBlock) => {
  useEffect(() => {
    if (!shouldBlock) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [shouldBlock])

  return { isBlocked: false, stay: () => { }, proceed: () => { } }
}

// ---------------------------------------------------------------------------
// React context — allows setting the adapter once at the app shell level
// ---------------------------------------------------------------------------

const NavigationGuardContext = createContext<UseNavigationGuard>(useBeforeUnloadGuard)

/**
 * Provide a framework-specific `UseNavigationGuard` hook to all descendant
 * `FormRenderer` instances.
 *
 * ```tsx
 * import { NavigationGuardProvider } from './navigation-guard'
 * import { useTanStackNavigationGuard } from './tanstack-navigation-guard'
 *
 * function App() {
 *   return (
 *     <NavigationGuardProvider value={useTanStackNavigationGuard}>
 *       <Outlet />
 *     </NavigationGuardProvider>
 *   )
 * }
 * ```
 */
export const NavigationGuardProvider = NavigationGuardContext.Provider

/**
 * Consume the current `UseNavigationGuard` hook from context.
 * Falls back to `useBeforeUnloadGuard` when no provider is present.
 */
export const useNavigationGuardAdapter = (): UseNavigationGuard => {
  return useContext(NavigationGuardContext)
}
