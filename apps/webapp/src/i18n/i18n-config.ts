// https://github.com/vercel/next.js/tree/canary/examples/app-dir-i18n-routing

import { contentLocales as contentLocaleDefs } from '~/locales'

export const i18nConfig = {
  // Interface locales — the languages the host **frontend** chrome is
  // translated into. Sticky: drives the `lng` cookie, the language
  // switcher, and which URL prefix persists across a session. Distinct
  // from Byline's *admin* interface set (`byline/locales.ts` →
  // interfaceLocales, `en`/`fr`) and from the content set below.
  locales: ['en', 'es'],
  defaultLocale: 'en',
  cookieName: 'lng',
} as const

/** Interface locale — the host frontend chrome languages. */
export type Locale = (typeof i18nConfig)['locales'][number]

/**
 * Content locale codes — the languages a document can be published in,
 * owned by Byline (`byline/locales.ts` → contentLocales). Imported as
 * static data via the dependency-free leaf module, so this is safe on
 * both the server and the public client bundle (Byline's config getters
 * are not — see bylinecms.app LANGUAGE-STRATEGY.md, Phase 1 finding).
 */
export const contentLocales = contentLocaleDefs.map((l) => l.code)
export type ContentLocale = (typeof contentLocaleDefs)[number]['code']

/**
 * Routable locales = interface ∪ content. The `{-$lng}` matcher resolves
 * any of these, so content-locale deep links (`/fr/news/foo`) work. This
 * is deliberately a *different* set from "advertised" locales (the
 * per-document `availableLocales ∩ _availableVersionLocales` that drive
 * hreflang — see `@/lib/alternates`): a URL can resolve without being promoted.
 */
export const routableLocales: readonly string[] = [
  ...new Set<string>([...i18nConfig.locales, ...contentLocales]),
]

/** A locale that the matcher will resolve (interface or content). */
export type RoutableLocale = Locale | ContentLocale

/** Narrows a raw string to an interface locale. */
export function isInterfaceLocale(lng: string | null | undefined): lng is Locale {
  return lng != null && (i18nConfig.locales as readonly string[]).includes(lng)
}

/** Narrows a raw string to a routable locale (interface or content). */
export function isRoutableLocale(lng: string | null | undefined): lng is RoutableLocale {
  return lng != null && routableLocales.includes(lng)
}

/**
 * The interface locale to use for **chrome** on a given URL locale. A
 * content-only locale (e.g. `fr`) has no frontend chrome bundle, so chrome
 * falls back to the default interface locale — the content still renders in
 * the URL's locale.
 */
export function toInterfaceLocale(lng: string | null | undefined): Locale {
  return isInterfaceLocale(lng) ? lng : i18nConfig.defaultLocale
}
