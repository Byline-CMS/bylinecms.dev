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

import { defaultContentLocale } from '~/public'

import { buildLocalizedPath } from '@/lib/meta'

export interface AlternateLink {
  /** BCP-47-ish language code, e.g. `de` — used as the `hreflang` value. */
  hreflang: string
  /** Locale-prefixed path for that language (relative; absolutised by getMeta / sitemap). */
  path: string
}

export interface ResolvedAlternates {
  /** Advertised path locale, otherwise the document's source-locale path. */
  canonical: string
  /** One entry per *advertised* language (incl. a self-referential entry when
   * the path locale is advertised). Empty when the document advertises nothing. */
  alternates: AlternateLink[]
  /** Source-locale fallback, even when the source is not advertised. */
  xDefaultPath: string
}

/**
 * The public advertised locale set for a read result: the editorial
 * `availableLocales` intersected with the completeness ledger
 * `_availableVersionLocales`. Returns `[]` when nothing is advertised or the
 * document isn't complete in any advertised locale. See docs/08-internationalization/index.md.
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

export interface AlternateOptions {
  /** Checked AND complete locales, from `advertisedLocalesFor`. */
  advertisedLocales?: readonly string[] | null
  /** Requested URL locale. Omit to select the source URL (e.g. a sitemap entry). */
  pathLocale?: string
  /** Document's authoring locale; legacy rows fall back to the content default. */
  sourceLocale?: string | null
}

/**
 * Editorial URL policy: only checked-and-complete translations own a canonical
 * URL; every other request defers to the source document. The source remains
 * canonical-eligible even when no locales are advertised.
 *
 * This does not gate reads or describe the language actually served. A complete
 * but unchecked translation can still render until upstream delivery gating is
 * implemented; canonical is a preference, not an access or indexing barrier.
 */
export function resolveAlternates(
  { advertisedLocales, pathLocale, sourceLocale }: AlternateOptions,
  ...segments: Array<string | null | undefined>
): ResolvedAlternates {
  const advertised = advertisedLocales != null ? [...advertisedLocales] : []
  const source = sourceLocale ?? defaultContentLocale
  const canonicalLocale =
    pathLocale != null && advertised.includes(pathLocale) ? pathLocale : source

  return {
    canonical: buildLocalizedPath(canonicalLocale, ...segments),
    alternates: advertised.map((code) => ({
      hreflang: code,
      path: buildLocalizedPath(code, ...segments),
    })),
    // Deliberately allow x-default outside the advertised language set: the
    // source is the generic fallback, not an implicitly approved translation.
    xDefaultPath: buildLocalizedPath(source, ...segments),
  }
}
