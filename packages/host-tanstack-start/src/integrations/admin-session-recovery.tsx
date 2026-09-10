/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public-page session recovery.
 *
 * Public reads are verification-only and never rotate credentials, so a
 * signed-in editor whose access credential has expired renders a public page
 * as an anonymous visitor: the admin bar hides and preview mode drops. Mount
 * this component in the public layout with the `renewable` hint from
 * `getCurrentAdminSessionSoft`. When the hint is set it runs the coordinated
 * browser renewal (same expected-login check as admin navigation) and then
 * re-runs the route loaders, so the admin bar and any draft-aware reads on
 * the page re-evaluate against the renewed session.
 *
 * It renders nothing. Content already on screen stays as rendered until the
 * loaders re-run; the renewal never retroactively changes a response that was
 * produced without preview authorisation.
 *
 * The public layout stays mounted across navigations, so recovery must work
 * for every expiry cycle, not just the first: one attempt runs per renewable
 * hint per location, never overlapping. After a successful renewal the loader
 * re-runs and clears the hint; the next expiry sets it again and recovery
 * runs again. After a service or network failure the hint persists, and the
 * next navigation (a new location) tries again.
 *
 * A terminal auth outcome (revoked, disabled, unknown) suppresses further
 * attempts for the life of the page: the hint would otherwise repeat on every
 * navigation while the stale refresh cookie remains.
 */

import { useEffect, useRef } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'

import { renewExpectedSession } from './session-renewal.js'

const TERMINAL_CODES = new Set([
  'ERR_UNAUTHENTICATED',
  'ERR_INVALID_TOKEN',
  'ERR_REVOKED_TOKEN',
  'ERR_ACCOUNT_DISABLED',
  'ERR_SESSION_CHANGED',
])

let suppressed = false

export function AdminSessionRecovery({ renewable }: { renewable: boolean }) {
  const router = useRouter()
  const href = useRouterState({ select: (state) => state.location.href })
  const inFlight = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `href` is not read inside the effect; it re-arms recovery on navigation so a service failure can be retried later.
  useEffect(() => {
    if (!renewable || inFlight.current || suppressed) return
    inFlight.current = true
    // `router.invalidate()` is safe after unmount, so no cleanup guard: a
    // renewal that completes during a layout remount still refreshes data.
    renewExpectedSession()
      .then(() => router.invalidate())
      .catch((error) => {
        if (TERMINAL_CODES.has((error as { code?: string })?.code ?? '')) suppressed = true
      })
      .finally(() => {
        inFlight.current = false
      })
  }, [renewable, href, router])
  return null
}
