/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Leaf locale definitions — the host's two locale sets, as plain data
 * with **zero** runtime dependencies (no `@byline/*` imports, no
 * translation registry). `byline/i18n.ts` consumes these to assemble the
 * `defineServerConfig` / `defineClientConfig` payload.
 *
 * Kept separate from `byline/i18n.ts` precisely so the public frontend
 * can import the locale arrays without dragging the admin translation
 * graph (`@byline/i18n/admin`, the Lexical-adjacent module tree) into its
 * client bundle. Importing `byline/i18n.ts` would; importing this won't.
 * That keeps the lazy-loaded admin/public split intact (see
 * `src/routes/_byline/route.lazy.tsx`).
 *
 * `interface` locales govern the CMS admin UI language; `content` locales
 * govern the languages a document can be published in. Note these are a
 * *different* set from the host **frontend** interface locales
 * (`src/i18n/i18n-config.ts` → `en`/`fr`) — the admin chrome and the
 * public chrome are translated into deliberately different sets.
 */

export interface LocaleDefinition {
  code: string
  label: string
}

/** Locales available in the CMS admin interface. */
// Every code listed here must have a matching bundle in @byline/i18n/admin
// (or a third-party plugin merged in via `mergeTranslations(...)`).
// `adminTranslations({ locales })` in `byline/i18n.ts` throws at boot if
// the requested code is not bundled.
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
