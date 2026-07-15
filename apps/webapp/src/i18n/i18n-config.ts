// https://github.com/vercel/next.js/tree/canary/examples/app-dir-i18n-routing

import { contentLocales as publicContentLocales } from '~/public'

export const i18nConfig = {
  // Interface locales — the languages the host **frontend** chrome is
  // translated into. Sticky: drives the `lng` cookie, the language
  // switcher, and which URL prefix persists across a session. Distinct
  // from Byline's *admin* interface set (`byline/locales.ts` →
  // interfaceLocales) and from the content set below.
  locales: ['en', 'fr'],
  defaultLocale: 'en',
  cookieName: 'lng',
} as const

/** Interface locale — the host frontend chrome languages. */
export type Locale = (typeof i18nConfig)['locales'][number]

/**
 * Content locale codes — the languages a document can be published in,
 * owned by Byline and exposed through its client-safe `byline/public.ts`
 * barrel. Byline's runtime config getters are intentionally not used by
 * the public client bundle.
 */
export const contentLocaleDefinitions = publicContentLocales
export type ContentLocale = (typeof contentLocaleDefinitions)[number]['code']
export const contentLocales = contentLocaleDefinitions.map((locale) => locale.code)
export const contentLocaleLabels = Object.fromEntries(
  contentLocaleDefinitions.map((locale) => [locale.code, locale.label])
) as Readonly<Record<ContentLocale, string>>

/**
 * Routable locales = interface ∪ content. The `$lng` matcher resolves
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

/** Narrows a raw string to a configured content locale. */
export function isContentLocale(lng: string | null | undefined): lng is ContentLocale {
  return lng != null && (contentLocales as readonly string[]).includes(lng)
}

/** Narrows a raw string to a routable locale (interface or content). */
export function isRoutableLocale(lng: string | null | undefined): lng is RoutableLocale {
  return lng != null && routableLocales.includes(lng)
}

/**
 * The interface locale to use for **chrome** on a given URL locale. A
 * content-only locale (e.g. `de`) has no frontend chrome bundle, so chrome
 * falls back to the default interface locale — the content still renders in
 * the URL's locale.
 */
export function toInterfaceLocale(lng: string | null | undefined): Locale {
  return isInterfaceLocale(lng) ? lng : i18nConfig.defaultLocale
}
