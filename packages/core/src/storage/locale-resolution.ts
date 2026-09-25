/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { LocaleVisibility, ReadMode } from '../@types/index.js'

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
 * Pick the single effective content locale a version is restored in under
 * `onMissingLocale: 'fallback'`, walking `chain` (`[requested, …, floor]`) and
 * returning the first entry the version's completeness ledger records.
 *
 * The ledger is computed at write time from every persisted store row, so the
 * decision is independent of which store tables a projected read happened to
 * load. A locale-agnostic version renders identically everywhere, so the
 * requested locale is returned. The floor (the document's source locale) is
 * the terminal entry and is returned when no earlier candidate qualifies.
 *
 * Returns `undefined` when `ledger` is absent — a version written before the
 * ledger existed and not yet backfilled — so the caller can fall back to
 * deriving completeness from the rows it loaded.
 */
export function resolveLocaleFromLedger(
  chain: readonly string[],
  ledger: VersionLocaleLedger | undefined
): string | undefined {
  if (ledger == null) return undefined
  const floor = chain[chain.length - 1]
  if (floor == null) return undefined
  if (ledger.localeAgnostic) return chain[0]
  for (const candidate of chain) {
    if (candidate === floor) break
    if (ledger.availableLocales.includes(candidate)) return candidate
  }
  return floor
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
export function isLocaleEligible(locale: string, eligibility: LocaleEligibility): boolean {
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
export function resolveEligibleLocale(
  chain: readonly string[],
  eligibility: LocaleEligibility
): string {
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
