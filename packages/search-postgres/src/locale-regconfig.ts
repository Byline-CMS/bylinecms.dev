/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Maps a content locale to a Postgres text-search configuration
 * (`regconfig`) — the language used by `to_tsvector` / `websearch_to_tsquery`
 * for stemming and stop-words. The set here is the configs shipped with a
 * stock Postgres install; anything unmapped falls back to `'simple'` (no
 * stemming, no stop-words — correct, just unstemmed).
 *
 * A host can override or extend the map via the `localeRegconfig` factory
 * option, e.g. to wire a custom dictionary or a language Postgres doesn't
 * ship (Thai, etc.).
 */
const DEFAULT_REGCONFIG: Readonly<Record<string, string>> = {
  ar: 'arabic',
  da: 'danish',
  de: 'german',
  el: 'greek',
  en: 'english',
  es: 'spanish',
  fi: 'finnish',
  fr: 'french',
  hu: 'hungarian',
  id: 'indonesian',
  it: 'italian',
  lt: 'lithuanian',
  ne: 'nepali',
  nl: 'dutch',
  no: 'norwegian',
  pt: 'portuguese',
  ro: 'romanian',
  ru: 'russian',
  sv: 'swedish',
  ta: 'tamil',
  tr: 'turkish',
}

export const DEFAULT_FALLBACK_REGCONFIG = 'simple'

export type RegconfigResolver = (locale: string | undefined) => string

/**
 * Build a locale → regconfig resolver. `overrides` are merged over the
 * built-in map; `fallback` is used for any locale (or locale base) not found.
 */
export function createRegconfigResolver(
  overrides: Record<string, string> = {},
  fallback: string = DEFAULT_FALLBACK_REGCONFIG
): RegconfigResolver {
  const map = { ...DEFAULT_REGCONFIG, ...overrides }
  return (locale) => {
    if (!locale) return fallback
    if (map[locale] != null) return map[locale]
    const base = locale.split('-')[0]?.toLowerCase()
    return (base != null ? map[base] : undefined) ?? fallback
  }
}
