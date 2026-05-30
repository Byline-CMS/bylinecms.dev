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
  { code: 'es', label: 'Español' },
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
    // Optional display names for the admin language switcher. Lets you
    // author `Español` rather than the lowercase `español` that
    // Intl.DisplayNames returns; omit to fall back to Intl per code.
    localeDefinitions: interfaceLocales.map((l) => ({ code: l.code, nativeName: l.label })),
  },
  content: {
    defaultLocale: 'en',
    locales: contentLocales.map((l) => l.code),
    // Optional display names for content locales. Byline doesn't render
    // these (content has no admin switcher) — a public frontend can read
    // them from getServerConfig().i18n.content.localeDefinitions to label
    // hreflang / "read this in…" affordances without a parallel map.
    localeDefinitions: contentLocales.map((l) => ({ code: l.code, nativeName: l.label })),
  },
}
