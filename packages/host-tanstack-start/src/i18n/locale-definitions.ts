/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { LocaleDefinition } from '@byline/i18n'

/**
 * Build a `LocaleDefinition[]` for the language switcher. Per-code
 * resolution order:
 *
 *   1. An entry from the host's `i18n.interface.localeDefinitions`
 *      (matched by code). Wins outright — this is the path that lets a
 *      host author write `Français` instead of the lowercase
 *      `français` that CLDR's `Intl.DisplayNames` returns for romance
 *      languages.
 *   2. `Intl.DisplayNames(code).of(code)` — produces a display name in
 *      each locale's own language using CLDR's data.
 *   3. The raw code, as a last-resort fallback for exotic tags or
 *      runtimes that lack `Intl.DisplayNames`.
 *
 * Used by both the admin layout (post-auth) and the sign-in page
 * (pre-auth) — anywhere `<LanguageMenu>` mounts.
 */
export function buildLocaleDefinitions(
  codes: readonly string[],
  configured: ReadonlyArray<{ code: string; nativeName: string }> | undefined
): LocaleDefinition[] {
  const explicit = new Map((configured ?? []).map((d) => [d.code, d.nativeName]))
  return codes.map((code) => {
    const explicitName = explicit.get(code)
    if (explicitName != null) {
      return { code, nativeName: explicitName }
    }
    let nativeName = code
    try {
      const dn = new Intl.DisplayNames([code], { type: 'language' })
      nativeName = dn.of(code) ?? code
    } catch {
      // Intl.DisplayNames is available in Node 18+ and every modern
      // browser. Defensive catch covers exotic codes or sandbox quirks.
    }
    return { code, nativeName }
  })
}
