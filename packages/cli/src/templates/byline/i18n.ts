/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Shared i18n configuration — assembles the `defineServerConfig` /
 * `defineClientConfig` payload from the host's locale sets and the admin
 * translation bundle.
 *
 * The locale arrays themselves live in `./locales.ts`, a dependency-free leaf
 * module, so the public frontend can import them without pulling in the admin
 * translation graph this file depends on. Re-exported here for back-compat
 * with existing `~/i18n` importers.
 *
 * `interface` locales govern the CMS admin UI language.
 * `content` locales govern the languages a document can be published in.
 */

import { adminTranslations } from '@byline/i18n/admin'

import { contentLocales, interfaceLocales, type LocaleDefinition } from './locales.js'

export { contentLocales, interfaceLocales, type LocaleDefinition }

/** Derived config object — passed directly to defineServerConfig / defineClientConfig. */
export const i18n = {
  interface: {
    defaultLocale: 'en',
    locales: interfaceLocales.map((l) => l.code),
    // Optional display names for the admin language switcher. Lets you
    // author `Français` rather than the lowercase `français` that
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
  // Admin UI translations. `adminTranslations({...})` ships the `byline-admin`
  // namespace bundled into `@byline/i18n/admin`. A non-empty `interface.locales`
  // REQUIRES this — `initBylineCore()` throws at boot otherwise. To extend the
  // registry with your own namespace (custom fields, plugins), merge bundles:
  //   import { mergeTranslations } from '@byline/i18n'
  //   translations: mergeTranslations(
  //     adminTranslations({ locales: interfaceLocales.map((l) => l.code) }),
  //     myPluginTranslations({ locales: interfaceLocales.map((l) => l.code) })
  //   ),
  translations: adminTranslations({ locales: interfaceLocales.map((l) => l.code) }),
}
