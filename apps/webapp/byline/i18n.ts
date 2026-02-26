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
export const interfaceLocales: LocaleDefinition[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
]

/** Locales a document can be published in. */
export const contentLocales: LocaleDefinition[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'de', label: 'German' },
]

/** Derived config object — passed directly to defineServerConfig / defineClientConfig. */
export const i18n = {
  interface: {
    defaultLocale: 'en',
    locales: interfaceLocales.map((l) => l.code),
  },
  content: {
    defaultLocale: 'en',
    locales: contentLocales.map((l) => l.code),
  },
}
