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

export interface LocaleDefinition {
  code: string
  label: string
}

/** Locales available in the CMS admin interface. */
// Only English ships in `@byline/i18n/admin` today. Add another locale's
// definition here once the corresponding community bundle exists (see
// `docs/I18N.md` Phase 2) — and wire it into the `adminTranslations({...})`
// call in `i18n` below.
export const interfaceLocales: LocaleDefinition[] = [{ code: 'en', label: 'English' }]

/** Locales a document can be published in. */
export const contentLocales = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
] as const

import { adminTranslations } from '@byline/i18n/admin'

/** Derived config object — passed directly to defineServerConfig / defineClientConfig. */
export const i18n = {
  interface: {
    defaultLocale: 'en',
    locales: interfaceLocales.map((l) => l.code),
    // Admin UI translations. `adminTranslations({ en: true })` returns
    // the bundled `byline-admin` namespace for English. To add a
    // community-translated locale: import its bundle and pass it under
    // its locale code, e.g. `adminTranslations({ en: true, fr })`.
    // Compose with plugin / extension bundles via `mergeTranslations(...)`
    // from `@byline/i18n` if needed.
    translations: adminTranslations({ en: true }),
  },
  content: {
    defaultLocale: 'en',
    locales: contentLocales.map((l) => l.code),
  },
}
