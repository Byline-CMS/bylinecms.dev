/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type ReactNode, useMemo } from 'react'

import { createFormatter, type MissingTranslationEvent } from '../formatter.js'
import { I18nContext, type I18nContextValue } from './i18n-context.js'
import type { LocaleCode, LocaleDefinition, TranslationBundle } from '../types.js'

export interface I18nProviderProps {
  bundle: TranslationBundle
  activeLocale: LocaleCode
  defaultLocale: LocaleCode
  /** Permitted locale set with native names — drives `<LanguageMenu>`. */
  localeDefinitions: readonly LocaleDefinition[]
  /**
   * Optional handler the host wires to its language-switcher server fn.
   * Receives the new locale; expected to persist it and trigger a re-
   * render with the updated `activeLocale` prop.
   */
  setLocale?: (next: LocaleCode) => void | Promise<void>
  /**
   * Override the dev-time `console.warn` on missing translations.
   * Defaults to a one-shot warn per `(locale, namespace, key)` triple
   * when `process.env.NODE_ENV !== 'production'`.
   */
  onMissing?: (event: MissingTranslationEvent) => void
  children: ReactNode
}

export function I18nProvider({
  bundle,
  activeLocale,
  defaultLocale,
  localeDefinitions,
  setLocale,
  onMissing,
  children,
}: I18nProviderProps) {
  const value = useMemo<I18nContextValue>(() => {
    const onMissingResolved =
      onMissing ?? (process.env.NODE_ENV !== 'production' ? defaultMissingWarner : undefined)
    return {
      formatter: createFormatter({
        bundle,
        activeLocale,
        defaultLocale,
        onMissing: onMissingResolved,
      }),
      bundle,
      activeLocale,
      defaultLocale,
      localeDefinitions,
      setLocale,
    }
  }, [bundle, activeLocale, defaultLocale, localeDefinitions, setLocale, onMissing])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

function defaultMissingWarner(event: MissingTranslationEvent): void {
  if (event.fellThroughToKey) {
    console.warn(
      `[@byline/i18n] missing translation: ${event.activeLocale}.${event.namespace}.${event.key} — also missing in default locale; rendered raw key.`
    )
  } else {
    console.warn(
      `[@byline/i18n] missing translation: ${event.activeLocale}.${event.namespace}.${event.key} — using default-locale fallback.`
    )
  }
}
