/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * React Context module — kept in its own file (rather than inlined in
 * `i18n-provider.tsx`) so both the provider and the hook import the
 * same Context identity by path, and any consumer that imports from
 * `@byline/i18n/react` shares it too. Splitting it across files would
 * be fine on its own; what is NOT fine is splitting it across subpath
 * exports — Vite's `optimizeDeps` can inline a private copy per
 * subpath, breaking provider / consumer identity. The single `/react`
 * subpath collapses both into one module graph.
 */

import { createContext } from 'react'

import type { Formatter } from '../formatter.js'
import type { LocaleCode, LocaleDefinition, TranslationBundle } from '../types.js'

export interface I18nContextValue {
  formatter: Formatter
  bundle: TranslationBundle
  activeLocale: LocaleCode
  defaultLocale: LocaleCode
  /**
   * Permitted locale set with native names. `<LanguageMenu>` renders
   * one row per entry; the resolver in the root package just needs the
   * codes (`localeDefinitions.map(d => d.code)`).
   */
  localeDefinitions: readonly LocaleDefinition[]
  /**
   * Imperative locale change. Provided by the host adapter — typically
   * calls a server fn that updates the user's stored preference and
   * the cookie, then re-renders the provider with the new locale.
   * When undefined the language switcher renders disabled.
   */
  setLocale?: (next: LocaleCode) => void | Promise<void>
}

export const I18nContext = createContext<I18nContextValue | null>(null)
