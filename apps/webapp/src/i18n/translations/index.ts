/**
 * Framework-agnostic translation loader.
 *
 * Locale source files are authored as plain JSON (`en.json`, `es.json`)
 * — translator-friendly, native to every translation tool, clean diffs.
 *
 * Vite's `?raw` query inlines each file as a string literal at transform
 * time, so no `.json` URL is ever requested at runtime. That sidesteps
 * the TanStack Start / Nitro dev-server quirk where `import x from
 * './x.json'` is rewritten to `/x.json?import` and Nitro's dev middleware
 * 404s it because `.json` isn't in Nitro's `ASSET_EXT_RE` allowlist.
 *
 * Eager form (current): every locale is parsed once at module init and
 * shipped in both the SSR and client bundles. Right answer for a host
 * webapp with a handful of locales — see `docs/I18N.md` for the same
 * tradeoff in `@byline/i18n`.
 *
 * Lazy form (if locale count or per-locale size grows past ~5): swap the
 * static imports for a dynamic-import map. `getTranslations` is already
 * async, so consumers don't change.
 *
 *   const loaders: Record<Locale, () => Promise<{ default: string }>> = {
 *     en: () => import('./en.json?raw'),
 *     es: () => import('./es.json?raw'),
 *   }
 *   const cache = new Map<Locale, Translations>()
 *   export async function getTranslations(lng: Locale): Promise<Translations> {
 *     if (cache.has(lng)) return cache.get(lng)!
 *     const { default: raw } = await (loaders[lng] ?? loaders[i18nConfig.defaultLocale])()
 *     const parsed = JSON.parse(raw) as Translations
 *     cache.set(lng, parsed)
 *     return parsed
 *   }
 *
 * Vite code-splits each `import('./xx.json?raw')` into its own chunk
 * when the path is a literal — the explicit map is required, a dynamic
 * template like `./${lng}.json?raw` would defeat code-splitting.
 */

import { IntlMessageFormat } from 'intl-messageformat'

import enRaw from './en.json?raw'
import esRaw from './es.json?raw'
import type { Locale } from '@/i18n/i18n-config'
import type enType from './en.json'

export type Translations = typeof enType

const translations: Record<string, Translations> = {
  en: JSON.parse(enRaw) as Translations,
  es: JSON.parse(esRaw) as Translations,
}

export const getTranslations = async (lng: Locale): Promise<Translations> =>
  translations[lng] ?? translations.en

/**
 * Imperative translation helper — works identically on client and server.
 * On the client it's used via TranslationsProvider + useTranslations().
 * On the server it can be called directly in loaders / server functions.
 */
export async function createTranslator<T extends keyof Translations>(lng: Locale, namespace: T) {
  const translations = await getTranslations(lng)
  const namespacedTranslations = translations[namespace]

  return {
    t: (key: keyof Translations[T], values?: Record<string, unknown>) => {
      const message = namespacedTranslations[key] ?? key

      if (typeof message === 'string') {
        const formatter = new IntlMessageFormat(message)
        return formatter.format(values)
      }

      return message
    },
  }
}
