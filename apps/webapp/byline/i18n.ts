/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Shared i18n locale configuration — no upstream dependencies, safe to import
 * from both config entry-points and collection schema files without circular
 * references.
 *
 * `interface` locales govern the CMS admin UI language.
 * `content` locales govern the languages a document can be published in.
 */

import { adminTranslations } from '@byline/i18n/admin'

export interface LocaleDefinition {
  code: string
  label: string
}

/** Locales available in the CMS admin interface. */
// Every code listed here must have a matching bundle in @byline/i18n/admin
// (or a third-party plugin merged in via `mergeTranslations(...)`).
// `adminTranslations({ locales })` below throws at boot if the requested
// code is not bundled.
export const interfaceLocales: LocaleDefinition[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
]

/** Locales a document can be published in. */
export const contentLocales = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
] as const

/** Derived config object — passed directly to defineServerConfig / defineClientConfig. */
export const i18n = {
  interface: {
    defaultLocale: 'en',
    locales: interfaceLocales.map((l) => l.code),
    // Display names for the admin language switcher. The dropdown
    // shows these labels verbatim — keeping host-side authoring of
    // `Français` (vs CLDR's lowercase `français`) is the whole reason
    // this slot exists. Hosts that don't supply this fall back to
    // `Intl.DisplayNames` per code.
    localeDefinitions: interfaceLocales.map((l) => ({ code: l.code, nativeName: l.label })),
  },
  content: {
    defaultLocale: 'en',
    locales: contentLocales.map((l) => l.code),
  },
  // Admin UI translations. The factory reads bundled JSON files in
  // @byline/i18n/admin and returns a `byline-admin` namespace bundle
  // for each requested locale. Compose with plugin / extension bundles
  // via `mergeTranslations(...)` from `@byline/i18n` if needed.
  translations: adminTranslations({ locales: interfaceLocales.map((l) => l.code) }),
}
