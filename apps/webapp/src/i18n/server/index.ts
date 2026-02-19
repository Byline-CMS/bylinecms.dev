/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

// https://github.com/vercel/next.js/tree/canary/examples/app-dir-i18n-routing
import 'server-only'

import { IntlMessageFormat } from 'intl-messageformat'

import type { Locale } from '@/i18n/i18n-config'

// We enumerate all translations here for better linting and typescript support
// We also get the default import for cleaner types
const translations = {
  en: () => import('../translations/en.json').then((module) => module.default),
  es: () => import('../translations/es.json').then((module) => module.default),
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
