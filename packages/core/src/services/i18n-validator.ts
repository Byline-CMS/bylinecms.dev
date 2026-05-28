/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Boot-time validator for the admin translation registry. Mirrors the
 * fail-fast posture of `validateRichTextFieldFlags` — surfacing wiring
 * mistakes at `initBylineCore()` rather than at first request.
 *
 * Rules enforced:
 *   1. `defaultLocale` must be in the permitted `locales` set.
 *   2. When `locales` is non-empty, `translations` must be present.
 *   3. Every locale in `locales` must have at least one namespace +
 *      one key in `translations`. A locale with zero translations is
 *      almost always a missing-bundle bug — at minimum the consumer
 *      should opt out of the locale set entirely.
 *
 * Soft warning (returned, not thrown):
 *   - Key set drift across locales. A namespace that carries `{ a, b }`
 *     in `en` and `{ a }` in `fr` reports `fr` as missing `b`. Surfaces
 *     translation gaps without blocking boot — partial translations are
 *     normal during community-contributor flow.
 */

import type { TranslationBundleShape } from '../@types/site-config.js'

export interface InterfaceI18nConfig {
  defaultLocale: string
  locales: string[]
  translations?: TranslationBundleShape
}

export interface TranslationDriftWarning {
  locale: string
  namespace: string
  /** Keys present in some other locale's same namespace but absent here. */
  missingKeys: string[]
}

export interface ValidateTranslationsResult {
  /** Soft warnings — caller decides whether to log or ignore. */
  warnings: TranslationDriftWarning[]
}

/**
 * Validate the admin translation slot against the configured interface
 * locale set. Throws on any structural error; returns soft warnings for
 * key-set drift between locales.
 */
export function validateTranslations(i18n: InterfaceI18nConfig): ValidateTranslationsResult {
  const { defaultLocale, locales, translations } = i18n
  const errors: string[] = []

  // (1) Default must be in the permitted set.
  if (locales.length > 0 && !locales.includes(defaultLocale)) {
    errors.push(
      `defaultLocale '${defaultLocale}' is not in i18n.interface.locales [${locales.join(', ')}]. ` +
        `Add it to locales, or change defaultLocale to one of the existing entries.`
    )
  }

  // No locales declared → skip the remaining checks. Hosts that don't
  // mount the admin UI (seeds, migrations, headless tooling) can omit
  // translations entirely.
  if (locales.length === 0) {
    return { warnings: [] }
  }

  // (2) Non-empty locale set requires a translations bundle.
  if (translations == null) {
    errors.push(
      `i18n.interface.locales declares [${locales.join(', ')}] but no translations bundle is registered. ` +
        `Pass one to defineClientConfig via i18n.translations — see @byline/i18n's adminTranslations() ` +
        `and mergeTranslations() helpers.`
    )
    if (errors.length > 0) {
      throw new Error(formatErrors(errors))
    }
    return { warnings: [] }
  }

  // (3) Every declared locale must have at least one (namespace, key).
  for (const locale of locales) {
    const localeBundle = translations[locale]
    if (localeBundle == null || namespaceKeyCount(localeBundle) === 0) {
      errors.push(
        `i18n.interface.locales includes '${locale}' but no translations are registered for it. ` +
          `Either drop '${locale}' from locales or wire a community bundle (e.g. @byline/i18n-${locale}).`
      )
    }
  }

  if (errors.length > 0) {
    throw new Error(formatErrors(errors))
  }

  // Soft warnings — key-set drift.
  return { warnings: collectDriftWarnings(translations, locales) }
}

function namespaceKeyCount(localeBundle: TranslationBundleShape[string]): number {
  let count = 0
  for (const namespace of Object.keys(localeBundle)) {
    count += Object.keys(localeBundle[namespace] ?? {}).length
  }
  return count
}

function collectDriftWarnings(
  translations: TranslationBundleShape,
  locales: readonly string[]
): TranslationDriftWarning[] {
  // For each namespace, take the union of keys across all locales,
  // then report per-locale which keys are missing relative to that
  // union.
  const namespaceKeyUnion = new Map<string, Set<string>>()
  for (const locale of locales) {
    const localeBundle = translations[locale]
    if (localeBundle == null) continue
    for (const namespace of Object.keys(localeBundle)) {
      let union = namespaceKeyUnion.get(namespace)
      if (union == null) {
        union = new Set()
        namespaceKeyUnion.set(namespace, union)
      }
      for (const key of Object.keys(localeBundle[namespace] ?? {})) {
        union.add(key)
      }
    }
  }

  const warnings: TranslationDriftWarning[] = []
  for (const locale of locales) {
    const localeBundle = translations[locale]
    if (localeBundle == null) continue
    for (const [namespace, union] of namespaceKeyUnion) {
      const present = new Set(Object.keys(localeBundle[namespace] ?? {}))
      const missing: string[] = []
      for (const key of union) {
        if (!present.has(key)) missing.push(key)
      }
      if (missing.length > 0) {
        warnings.push({ locale, namespace, missingKeys: missing })
      }
    }
  }
  return warnings
}

function formatErrors(errors: string[]): string {
  return `initBylineCore: i18n translation configuration errors:\n  - ${errors.join('\n  - ')}`
}
