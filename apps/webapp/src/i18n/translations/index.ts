/**
 * Framework-agnostic translation loader.
 *
 * Replaces the previous server/index.ts which depended on the Next.js
 * 'server-only' module. This version works in both client (SPA) and
 * server (SSR / createServerFn) contexts.
 */

import { IntlMessageFormat } from 'intl-messageformat'

import type { Locale } from '@/i18n/i18n-config'

// We enumerate all translations here for better linting and TypeScript support.
// We also get the default import for cleaner types.
const translationLoaders = {
  en: () => import('./en.json').then((module) => module.default),
  es: () => import('./es.json').then((module) => module.default),
}

export const getTranslations = async (lng: Locale) =>
  translationLoaders[lng]?.() ?? translationLoaders.en()

export type Translations = Awaited<ReturnType<typeof getTranslations>>

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
