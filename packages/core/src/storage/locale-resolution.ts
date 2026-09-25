/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

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
