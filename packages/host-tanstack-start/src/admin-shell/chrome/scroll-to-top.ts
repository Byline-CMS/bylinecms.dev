/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Return the reader to the top of the page.
 *
 * Separate from `RouterPager` so the behaviour can be asserted without
 * mounting a router. `smoothScrollToTop` suppresses TanStack's instant
 * `resetScroll` in favour of an animated one, which makes a missing
 * implementation silent — the page simply does not move. That is what
 * happened to every pager carrying the flag.
 *
 * Honours `prefers-reduced-motion`: those readers still arrive at the top,
 * without the travel.
 */
export function scrollWindowToTop(): void {
  if (typeof window === 'undefined') return

  // `matchMedia` is absent in some test and server-ish environments; treating
  // that as "no preference expressed" keeps the scroll working either way.
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, behavior: prefersReducedMotion === true ? 'auto' : 'smooth' })
}
