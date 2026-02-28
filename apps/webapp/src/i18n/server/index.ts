// https://github.com/vercel/next.js/tree/canary/examples/app-dir-i18n-routing
import 'server-only'

import { IntlMessageFormat } from 'intl-messageformat'

import type { Locale } from '@/i18n/i18n-config'

// We enumerate all translations here for better linting and typescript support
// We also get the default import for cleaner types
const translations = {
  en: () => import('../translations/en.json').then((module) => module.default),
  th: () => import('../translations/th.json').then((module) => module.default),
}

export const getTranslations = async (lng: Locale) => translations[lng]?.() ?? translations.en()

export type Translations = Awaited<ReturnType<typeof getTranslations>>

// Server version of useTranslations
export async function useTranslations<T extends keyof Translations>(lng: Locale, namespace: T) {
  const translations = await getTranslations(lng)
  const namespacedTranslations = translations[namespace]

  return {
    t: (key: keyof Translations[T], values?: Record<string, any>) => {
      const message = namespacedTranslations[key] ?? key

      if (typeof message === 'string') {
        const formatter = new IntlMessageFormat(message)
        return formatter.format(values)
      }

      return message
    },
  }
}
