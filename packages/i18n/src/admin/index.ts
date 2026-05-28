/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/i18n/admin` — the built-in `byline-admin` namespace bundle
 * and the `adminTranslations()` registry factory.
 *
 * Locale source files (`en.json`, `fr.json`, …) live alongside this
 * module. Each is authored as plain JSON — translator-friendly, native
 * to every translation tool, clean diffs — and Rslib inlines each into
 * the ESM build at compile time. Consumers receive a plain JS module
 * exporting the parsed objects; no `.json` URL crosses any runtime
 * loader.
 *
 * Adding a locale: drop a new JSON file in this directory and add it to
 * the `BUNDLES` map below. No new package, no new build, no new
 * publishing step. Translators iterate on a single file.
 *
 * Plugins / extensions / custom fields follow the same shape inside
 * their own packages — `@byline/ai/i18n/en.json`, etc. — and expose
 * their own factory taking the same `{ locales }` shape.
 */

import { mergeTranslations } from '../merge.js'
import enJson from './en.json'
import frJson from './fr.json'
import type { LocaleCode, NamespaceTranslations, TranslationBundle } from '../types.js'

const en: NamespaceTranslations = enJson
const fr: NamespaceTranslations = frJson

/**
 * Map of every bundled locale → its `byline-admin` namespace
 * translations. Static `import` statements above mean a consumer's
 * bundler sees a fixed-size set at build time. Today's locales bundle
 * eagerly; lazy loading is the [Phase 3](../../docs/I18N.md#phase-3--lazy-locale-loading)
 * migration once locale count grows past ~5.
 */
const BUNDLES: Readonly<Record<LocaleCode, NamespaceTranslations>> = {
  en,
  fr,
}

/** Locale codes for which a bundled translation ships in-package. */
export const bundledLocales: readonly LocaleCode[] = Object.freeze(Object.keys(BUNDLES))

/** Re-exported as typed consts for plugin authors who want the literal-key autocomplete. */
export { en, fr }
export type AdminNamespaceTranslations = typeof enJson

export interface AdminTranslationsOptions {
  /**
   * Locale codes to include in the returned bundle. Each must appear in
   * `bundledLocales` — unknown codes throw at config time. Defaults to
   * `['en']` when omitted, which is always available.
   */
  locales?: readonly LocaleCode[]
}

/**
 * Build a `TranslationBundle` carrying the `byline-admin` namespace for
 * each requested locale. Compose with plugin / extension bundles via
 * `mergeTranslations(...)` in the host's `admin.config.ts`.
 *
 * @example
 * ```ts
 * import { adminTranslations } from '@byline/i18n/admin'
 *
 * defineClientConfig({
 *   i18n: {
 *     interface: { defaultLocale: 'en', locales: ['en', 'fr'] },
 *     translations: adminTranslations({ locales: ['en', 'fr'] }),
 *   },
 * })
 * ```
 *
 * @throws when a requested code is not in `bundledLocales`.
 */
export function adminTranslations(options: AdminTranslationsOptions = {}): TranslationBundle {
  const locales = options.locales ?? ['en']
  const partials: TranslationBundle[] = []
  for (const locale of locales) {
    const bundle = BUNDLES[locale]
    if (bundle == null) {
      throw new Error(
        `[adminTranslations] no bundled translation for locale '${locale}'. ` +
          `Available: [${bundledLocales.join(', ')}]. ` +
          `To add a locale, drop a new JSON file in @byline/i18n/src/admin/.`
      )
    }
    partials.push({ [locale]: { 'byline-admin': bundle } })
  }
  return mergeTranslations(...partials)
}
