import type React from 'react'
import { createContext, useContext } from 'react'

// https://formatjs.io/docs/core-concepts/icu-syntax
import { IntlMessageFormat } from 'intl-messageformat'

import type { Translations } from '@/i18n/translations'

const TranslationsContext = createContext<Translations | null>(null)

export const TranslationsProvider = ({
  translations,
  children,
}: {
  translations: Translations
  children: React.ReactNode
}) => {
  return (
    <TranslationsContext.Provider value={translations}>{children}</TranslationsContext.Provider>
  )
}

export const useTranslations = <T extends keyof Translations>(
  namespace: T
): {
  t: (key: keyof Translations[T], values?: Record<string, any>) => string
} => {
  const translations = useContext(TranslationsContext)

  if (translations == null) {
    throw new Error('useTranslations must be used within a TranslationsProvider')
  }

  // NOTE that source translations in this case are all translations
  // for a given language - hence const message = translations[namespace][key] ?? key
  // and unlike the server version of t - in @/i18n/server/use-translations
  return {
    t: (key: keyof Translations[T], values?: Record<string, any>) => {
      const message = translations[namespace][key] ?? key

      if (typeof message === 'string') {
        const formatter = new IntlMessageFormat(message)
        return formatter.format(values)
      }

      return message
    },
  }
}
