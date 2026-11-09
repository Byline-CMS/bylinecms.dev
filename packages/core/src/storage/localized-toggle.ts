/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { resolveDeclarationPath } from '../paths/index.js'
import type { FieldSet } from '../@types/index.js'

/** A distinct stored `(field_path, locale)` pair found in a document version. */
export interface VersionFieldLocale {
  /** The stored dotted path, such as `content.1.photoBlock.alt`. */
  field_path: string
  locale: string
}

/**
 * A stored row whose locale disagrees with the field's current `localized`
 * flag (spec section 4.3): `shared-on-localized` is an `'all'` row on a field
 * now localized; `locale-on-shared` is a per-locale row on a field now shared.
 */
export interface LocalizationMismatch {
  field_path: string
  locale: string
  kind: 'shared-on-localized' | 'locale-on-shared'
}

/**
 * Turn a stored path into a declaration path by dropping purely numeric
 * (array/block index) segments. Eliding indexes from a storage path yields the
 * declaration path (see CLAUDE.md "Field Path Grammar").
 */
function toDeclarationPath(storedPath: string): string {
  return storedPath
    .split('.')
    .filter((segment) => !/^\d+$/.test(segment))
    .join('.')
}

/**
 * Classify stored `(field_path, locale)` pairs against the current schema
 * (spec section 4.3). Paths that do not resolve to a field, including unknown
 * paths and system names such as `path` (which are not schema fields), are
 * never mismatches. Each distinct path is resolved once.
 */
export function findLocalizationMismatches(
  fields: FieldSet,
  pairs: readonly VersionFieldLocale[]
): LocalizationMismatch[] {
  const localizedByPath = new Map<string, boolean | null>()
  const mismatches: LocalizationMismatch[] = []

  for (const { field_path, locale } of pairs) {
    let localized = localizedByPath.get(field_path)
    if (localized === undefined) {
      const resolution = resolveDeclarationPath(fields, toDeclarationPath(field_path), {
        blocks: 'qualified',
      })
      localized = resolution.status === 'ok' ? resolution.field.localized === true : null
      localizedByPath.set(field_path, localized)
    }
    if (localized == null) continue

    if (localized && locale === 'all') {
      mismatches.push({ field_path, locale, kind: 'shared-on-localized' })
    } else if (!localized && locale !== 'all') {
      mismatches.push({ field_path, locale, kind: 'locale-on-shared' })
    }
  }

  return mismatches
}

/**
 * The locales a conversion must visit (spec section 4.1): the source locale
 * first, then every other distinct locale in first-seen order, excluding
 * `'all'`.
 */
export function conversionLocales(locales: Iterable<string>, sourceLocale: string): string[] {
  const result = [sourceLocale]
  for (const locale of locales) {
    if (locale !== 'all' && !result.includes(locale)) result.push(locale)
  }
  return result
}
