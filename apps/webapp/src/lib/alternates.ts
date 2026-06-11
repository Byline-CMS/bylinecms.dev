/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The shared "what languages does this URL advertise" resolver — the single
 * source of truth that keeps per-page hreflang meta (`getMeta`) and the
 * dynamic `sitemap.xml` from drifting. Both derive their alternate-language
 * links from this one function.
 *
 * Keyed off Byline's 3.0 read-surface metadata: the public *advertised* set is
 * `availableLocales ∩ _availableVersionLocales` — the editorial "publish this
 * in these languages" signal (`availableLocales`, from a collection's
 * `advertiseLocales` directive) intersected with the structural completeness
 * ledger (`_availableVersionLocales`). Use `advertisedLocalesFor(doc)` to
 * compute it from a read result. This is deliberately narrower than the
 * *routable* set: a `/de/...` URL may resolve (routable) without being promoted
 * in hreflang (advertised). We advertise only the intersection.
 *
 * Because the advertised set is the same regardless of read locale and slugs
 * are not localized (a document's `path` is anchored to its source locale), one
 * document carries one set of alternates — no per-locale fan-out.
 */

import { i18nConfig } from '@/i18n/i18n-config'
import { buildLocalizedPath } from '@/lib/meta'

export interface AlternateLink {
  /** BCP-47-ish language code, e.g. `de` — used as the `hreflang` value. */
  hreflang: string
  /** Locale-prefixed path for that language (relative; absolutised by getMeta / sitemap). */
  path: string
}

export interface ResolvedAlternates {
  /** Canonical path for the current URL, in its own (path) locale. */
  canonical: string
  /** One entry per *advertised* language (incl. a self-referential entry when
   * the path locale is advertised). Empty when the document advertises nothing. */
  alternates: AlternateLink[]
  /** Path for the `x-default` hreflang — always the default-locale URL. */
  xDefaultPath: string
}

/**
 * The public advertised locale set for a read result: the editorial
 * `availableLocales` intersected with the completeness ledger
 * `_availableVersionLocales`. Returns `[]` when nothing is advertised or the
 * document isn't complete in any advertised locale. See docs/I18N.md.
 */
export function advertisedLocalesFor(doc: {
  availableLocales?: string[] | null
  _availableVersionLocales?: string[] | null
}): string[] {
  const editorial = doc.availableLocales ?? []
  if (editorial.length === 0) return []
  const complete = new Set(doc._availableVersionLocales ?? [])
  return editorial.filter((code) => complete.has(code))
}

/**
 * Resolve canonical + hreflang alternates for a document URL.
 *
 * @param advertisedLocales the document's public advertised locale set (the
 *   `availableLocales ∩ _availableVersionLocales` intersection — see
 *   `advertisedLocalesFor`); `null`/`undefined`/empty ⇒ no alternates.
 * @param pathLng the current URL's content locale (drives the canonical).
 * @param segments path segments after the locale, e.g. `'news', doc.path`.
 */
export function resolveAlternates(
  advertisedLocales: readonly string[] | null | undefined,
  pathLng: string,
  ...segments: Array<string | null | undefined>
): ResolvedAlternates {
  const advertised = advertisedLocales != null ? [...advertisedLocales] : []

  return {
    canonical: buildLocalizedPath(pathLng, ...segments),
    alternates: advertised.map((code) => ({
      hreflang: code,
      path: buildLocalizedPath(code, ...segments),
    })),
    xDefaultPath: buildLocalizedPath(i18nConfig.defaultLocale, ...segments),
  }
}
