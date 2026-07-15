/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Leaf locale definitions — the host's two locale sets, as plain data with
 * **zero** runtime dependencies (no `@byline/*` imports, no translation
 * registry). `byline/i18n.ts` consumes these to assemble the
 * `defineServerConfig` / `defineClientConfig` payload.
 *
 * Kept separate from `byline/i18n.ts` so `byline/public.ts` can expose the
 * locale arrays to a public frontend (or a collection schema file loaded
 * outside Vite — e.g. when running seeds via tsx) without dragging in the
 * admin translation graph (`@byline/i18n/admin`) that `i18n.ts` depends on.
 * Importing `byline/i18n.ts` would; importing this won't — which keeps the lazy
 * admin/public bundle split (`src/routes/_byline/route.lazy.tsx`) intact.
 *
 * `interface` locales govern the CMS admin UI language; `content` locales
 * govern the languages a document can be published in.
 */

export interface LocaleDefinition {
  code: string
  label: string
}

/** Locales available in the CMS admin interface. */
// Every code listed here must have a matching bundle in `@byline/i18n/admin`
// (or a third-party plugin merged in via `mergeTranslations(...)`).
// `adminTranslations({ locales })` in `byline/i18n.ts` throws at boot if a
// requested code is not bundled — `@byline/i18n/admin` ships English and French.
export const interfaceLocales = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
] as const satisfies readonly LocaleDefinition[]

/** Locales a document can be published in. */
export const contentLocales = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
] as const satisfies readonly LocaleDefinition[]
