/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/i18n/admin` — the built-in `byline-admin` namespace bundle.
 * English is shipped in-package; other locales arrive as standalone
 * community packages (`@byline/i18n-fr`, `@byline/i18n-de`, …) whose
 * default export is a `NamespaceTranslations` for the `byline-admin`
 * namespace at one locale.
 *
 * Source-of-truth for the English bundle is `./en.json` — Rslib inlines
 * the JSON at build time so consumers receive a plain JS module
 * exporting the parsed object. No `.json` URL crosses any runtime
 * loader, sidestepping the TanStack Start / Nitro asset-extension
 * issue that forced the host's translations to be TS modules.
 */

import { mergeTranslations } from '../merge.js'
// `resolveJsonModule: true` in tsconfig + Rslib's default bundling inlines
// this JSON at build time as a regular ESM module exporting the parsed
// object. Deliberately no `with { type: 'json' }` import attribute — Rslib
// transforms the import path from `./en.json` to `./en.js` but does not
// strip the attribute, and Node then rejects the JS module as
// ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE at runtime.
import enJson from './en.json'
import type { NamespaceTranslations, TranslationBundle } from '../types.js'

const en: NamespaceTranslations = enJson

/** Re-exported as a typed const for plugin authors who want the literal-key autocomplete. */
export { en }
export type AdminNamespaceTranslations = typeof enJson

/**
 * Options to `adminTranslations`. Pass `en: true` to include the
 * bundled English admin strings. Pass any community-provided locale
 * bundles under their locale code: `{ en: true, fr: frBundle }`.
 *
 * The shape is deliberately a record-of-bundles rather than an array
 * — locale codes appear once at the call site, and downstream tooling
 * (CI drift detection, type-level locale enumeration) reads the same
 * keys.
 */
export interface AdminTranslationsOptions {
  /** Include the bundled English admin strings. Defaults to `true`. */
  en?: boolean | NamespaceTranslations
  /** Additional community-provided locale bundles, keyed by locale code. */
  [locale: string]: boolean | NamespaceTranslations | undefined
}

/**
 * Build a `TranslationBundle` carrying the `byline-admin` namespace for
 * each requested locale. Compose with plugin / extension bundles via
 * `mergeTranslations(...)` in the host's `admin.config.ts`.
 *
 * @example
 * ```ts
 * import { adminTranslations } from '@byline/i18n/admin'
 * import { fr } from '@byline/i18n-fr'
 *
 * defineClientConfig({
 *   i18n: {
 *     locales: ['en', 'fr'],
 *     translations: adminTranslations({ en: true, fr }),
 *   },
 * })
 * ```
 */
export function adminTranslations(options: AdminTranslationsOptions = {}): TranslationBundle {
  const { en: enOption = true, ...rest } = options
  const partials: TranslationBundle[] = []
  if (enOption === true) {
    partials.push({ en: { 'byline-admin': en } })
  } else if (enOption && typeof enOption === 'object') {
    partials.push({ en: { 'byline-admin': enOption } })
  }
  for (const locale of Object.keys(rest)) {
    const value = rest[locale]
    if (value == null || value === false) continue
    if (value === true) {
      // `someLocale: true` only makes sense for the in-package English
      // bundle; any other locale needs an actual bundle passed in.
      throw new Error(
        `[@byline/i18n/admin] adminTranslations({ ${locale}: true }) is only valid for 'en'. ` +
          `Pass a NamespaceTranslations object for other locales (e.g. via @byline/i18n-${locale}).`
      )
    }
    partials.push({ [locale]: { 'byline-admin': value } })
  }
  return mergeTranslations(...partials)
}
