/**
 * Framework-agnostic translation loader.
 *
 * Replaces the previous server/index.ts which depended on the Next.js
 * 'server-only' module. This version works in both client (SPA) and
 * server (SSR / createServerFn) contexts.
 *
 * NOTE: translation files are TS modules, not JSON. Under TanStack
 * Start's Nitro-based dev server (Nitro v3+), Vite 8 transforms
 * `import x from './x.json'` into a URL-based import (`/x.json?import`)
 * rather than inlining at compile time, and Nitro's dev middleware
 * 404s the URL because `.json` is not in its asset-extension allowlist.
 * Plain TS modules go through the standard JS pipeline and bypass the
 * issue entirely.
 */

import { IntlMessageFormat } from 'intl-messageformat'

import en from './en'
import es from './es'
import type { Locale } from '@/i18n/i18n-config'

const translations: Record<string, typeof en> = { en, es }

export const getTranslations = async (lng: Locale) => translations[lng] ?? translations.en

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
