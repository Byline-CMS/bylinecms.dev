/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { LocaleVisibility, MissingLocalePolicy, ReadMode } from '../@types/index.js'
import type { FlattenedFieldValue } from './storage-row-types.js'

// ------------------------------------------------------------------------------
// Effective content-locale resolution from the version completeness ledger
// ------------------------------------------------------------------------------

/**
 * One version's entry in the `byline_document_version_locales` ledger: the
 * concrete locales its content is complete in, or `localeAgnostic` when the
 * version carries only the `'all'` sentinel (no localized content).
 */
export interface VersionLocaleLedger {
  availableLocales: readonly string[]
  localeAgnostic: boolean
}

/**
 * Derive a completeness ledger from loaded store rows, using the same rule the
 * write path records: a locale is complete when it covers every localized field
 * path the source locale has; a version with no localized rows is
 * locale-agnostic. Used only for versions written before the ledger existed and
 * not yet backfilled. It can only see the rows a read loaded, so a projected
 * read of such a version may still misjudge completeness.
 */
export function deriveVersionLocaleLedger(
  rows: readonly FlattenedFieldValue[],
  sourceLocale: string
): VersionLocaleLedger {
  const pathsByLocale = new Map<string, Set<string>>()
  for (const row of rows) {
    if (row.locale === 'all' || row.field_type === 'meta') continue
    let paths = pathsByLocale.get(row.locale)
    if (paths == null) {
      paths = new Set<string>()
      pathsByLocale.set(row.locale, paths)
    }
    paths.add(row.field_path.join('.'))
  }
  if (pathsByLocale.size === 0) return { availableLocales: [], localeAgnostic: true }
  const canonical = pathsByLocale.get(sourceLocale) ?? new Set<string>()
  const availableLocales: string[] = []
  for (const [locale, paths] of pathsByLocale) {
    let covers = true
    for (const path of canonical) {
      if (!paths.has(path)) {
        covers = false
        break
      }
    }
    if (covers) availableLocales.push(locale)
  }
  return { availableLocales, localeAgnostic: false }
}

// ------------------------------------------------------------------------------
// Locale visibility: which of a version's languages a read may deliver
// ------------------------------------------------------------------------------

/**
 * The per-document facts a locale-eligibility decision needs. `ledger` is the
 * selected version's completeness ledger; `availableLocales` is the document's
 * saved editorial checkbox set; `advertiseLocales` is the collection's opt-in
 * to that control.
 */
export interface LocaleEligibility {
  visibility: LocaleVisibility
  sourceLocale: string
  ledger: VersionLocaleLedger
  advertiseLocales: boolean
  availableLocales: readonly string[]
}

/**
 * Whether `locale` may be delivered for one document version.
 *
 *   - A locale-agnostic version renders identically everywhere: always eligible.
 *   - The source locale is always eligible, whatever its checkbox says.
 *   - Any other locale must be complete on the selected version.
 *   - Under `'public'` visibility in a collection with `advertiseLocales`, it
 *     must also be checked in the document's editorial set. An empty set
 *     authorizes no additional translation.
 */
function isLocaleEligible(locale: string, eligibility: LocaleEligibility): boolean {
  const { visibility, sourceLocale, ledger, advertiseLocales, availableLocales } = eligibility
  if (ledger.localeAgnostic) return true
  if (locale === sourceLocale) return true
  if (!ledger.availableLocales.includes(locale)) return false
  if (visibility === 'editorial' || !advertiseLocales) return true
  return availableLocales.includes(locale)
}

/**
 * Walk `chain` (`[requested, …, floor]`) and return the first locale eligible
 * under `eligibility`. Every candidate must pass, so a withheld intermediate
 * locale can never be selected. The floor is terminal and returned when no
 * earlier candidate qualifies.
 */
function resolveEligibleLocale(chain: readonly string[], eligibility: LocaleEligibility): string {
  for (const candidate of chain) {
    if (isLocaleEligible(candidate, eligibility)) return candidate
  }
  // biome-ignore lint/style/noNonNullAssertion: a locale chain always has a floor
  return chain[chain.length - 1]!
}

/**
 * The locale visibility a read uses: an explicit `localeVisibility` wins;
 * otherwise `status: 'any'` implies `'editorial'` and an omitted or
 * `'published'` status implies `'public'`. Resolving visibility never grants
 * access; callers still authorize `'editorial'` separately.
 */
export function resolveLocaleVisibility(
  status: ReadMode | undefined,
  explicit?: LocaleVisibility
): LocaleVisibility {
  if (explicit != null) return explicit
  return status === 'any' ? 'editorial' : 'public'
}

/** The outcome of one read's language decision for one document version. */
export interface ReadLocaleDecision {
  /** The locale to restore fields in; `undefined` for a multi-locale (`'all'`) read. */
  restoreLocale: string | undefined
  /** The `resolvedLocale` read metadata: the locale the fields were selected in, or `null`. */
  resolvedLocale: string | null
  /** `true` when localized values must be withheld and only non-localized values returned. */
  withholdLocalized: boolean
}

/**
 * Decide, for one document version, which locale a read restores, what it
 * reports as `resolvedLocale`, and whether localized values must be withheld.
 * Shared by every storage adapter so the language decision is identical across
 * engines and is made from the whole version, before any field projection.
 *
 *   - `locale: 'all'` restores locale maps and reports `null`.
 *   - A locale-agnostic version restores the requested locale and reports `null`.
 *   - `'fallback'` restores and reports the first eligible chain entry.
 *   - `'omit'`, `'empty'` and an omitted policy are exact: an eligible locale is
 *     restored and reported. Under `'public'` visibility an ineligible locale
 *     withholds localized values and reports `null`; under `'editorial'` the
 *     exact locale is restored even when partial.
 */
export function resolveReadLocale(params: {
  locale: string
  chain: readonly string[]
  onMissingLocale: MissingLocalePolicy | undefined
  eligibility: LocaleEligibility
}): ReadLocaleDecision {
  const { locale, chain, onMissingLocale, eligibility } = params
  if (locale === 'all') {
    return { restoreLocale: undefined, resolvedLocale: null, withholdLocalized: false }
  }
  if (eligibility.ledger.localeAgnostic) {
    return { restoreLocale: locale, resolvedLocale: null, withholdLocalized: false }
  }
  if (onMissingLocale === 'fallback') {
    const selected = resolveEligibleLocale(chain, eligibility)
    return { restoreLocale: selected, resolvedLocale: selected, withholdLocalized: false }
  }
  if (eligibility.visibility === 'public' && !isLocaleEligible(locale, eligibility)) {
    return { restoreLocale: locale, resolvedLocale: null, withholdLocalized: true }
  }
  return { restoreLocale: locale, resolvedLocale: locale, withholdLocalized: false }
}
