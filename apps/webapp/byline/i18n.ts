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

import { mergeTranslations } from '@byline/i18n'
import { adminTranslations } from '@byline/i18n/admin'

import { mediaAdminTranslations } from './collections/media/i18n/index.js'

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
    // Display names for the content locales a document can be published
    // in. Byline doesn't render these (content has no admin switcher) —
    // they travel through `getServerConfig().i18n.content.localeDefinitions`
    // so a public frontend can label its content-language affordances
    // (hreflang, "read this in…", sitemap alternates) with author-authored
    // names instead of a parallel map. Same `Français` vs `français`
    // rationale as the interface slot above.
    localeDefinitions: contentLocales.map((l) => ({ code: l.code, nativeName: l.label })),
  },
  // Admin UI translations. `adminTranslations({...})` ships the
  // `byline-admin` namespace bundled into `@byline/i18n/admin`.
  // `mediaAdminTranslations({...})` is a worked example of extending
  // the registry with a custom namespace (`webapp-media-admin`) — see
  // `collections/media/i18n/index.ts`. Third-party plugins / richtext
  // extensions / custom fields follow the same shape: a `{ locales }`
  // factory returning a TranslationBundle keyed by their own
  // namespace, merged in here. `mergeTranslations(...)` is associative
  // and last-writer-wins, so additional bundles can be appended in
  // any order.
  translations: mergeTranslations(
    adminTranslations({ locales: interfaceLocales.map((l) => l.code) }),
    mediaAdminTranslations({ locales: interfaceLocales.map((l) => l.code) })
  ),
}
