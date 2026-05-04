// https://github.com/vercel/next.js/tree/canary/examples/app-dir-i18n-routing
// import 'server-only' // Next.js-only; not available under TanStack Start

import { IntlMessageFormat } from 'intl-messageformat'

// Translations are TS modules, not JSON — see `../translations/index.ts`
// for the rationale (Vite 8 + Nitro turn `.json` imports into URL fetches
// that 404 in dev).
import en from '../translations/en'
import es from '../translations/es'
import type { Locale } from '@/i18n/i18n-config'

const translations: Record<string, typeof en> = { en, es }

export const getTranslations = async (lng: Locale) => translations[lng] ?? translations.en

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
