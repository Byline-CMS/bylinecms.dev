/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createContext, type ReactNode, useContext, useMemo } from 'react'

import type { BylineI18n } from './i18n-types'

const I18nContext = createContext<BylineI18n | null>(null)

interface BylineI18nProviderProps {
  i18n: BylineI18n
  children: ReactNode
}

export const BylineI18nProvider = ({ i18n, children }: BylineI18nProviderProps) => (
  <I18nContext.Provider value={i18n}>{children}</I18nContext.Provider>
)

/**
 * Read the full i18n bag from context. Throws when no `BylineI18nProvider`
 * is present — components inside `@byline/ui` rely on this contract.
 */
export const useBylineI18n = (): BylineI18n => {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error(
      '@byline/ui: BylineI18nProvider missing. Wrap your tree with <BylineI18nProvider i18n={…} />.'
    )
  }
  return ctx
}

/**
 * Convenience hook mirroring the common `useTranslations(namespace).t(...)`
 * idiom. The returned `t` is bound to the given namespace; the underlying
 * `BylineI18n.t` still receives both arguments so hosts can implement
 * namespacing however they prefer (catalogue lookup, key prefixing, etc.).
 *
 * The returned object identity is stable across renders for the same
 * namespace + i18n value, so it can be used in effect dependency arrays
 * without spurious re-runs.
 */
export const useTranslations = (
  namespace: string
): { t: (key: string, values?: Record<string, unknown>) => string } => {
  const i18n = useBylineI18n()
  return useMemo(
    () => ({
      t: (key: string, values?: Record<string, unknown>) => i18n.t(namespace, key, values),
    }),
    [i18n, namespace]
  )
}
