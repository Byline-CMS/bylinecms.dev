/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Framework-neutral i18n contract for `@byline/ui` field/form components.
 *
 * The host application provides a concrete `BylineI18n` value via
 * `BylineI18nProvider` — typically a thin adapter that bridges to the
 * host's existing translation primitives (TanStack-style namespaced
 * translations, next-intl, react-i18next, custom formatters, etc.).
 *
 * `t` is intentionally namespace-keyed so consumers can keep their string
 * catalogues organised the same way the host does. The convenience
 * `useTranslations(namespace)` hook in `i18n-context.tsx` mirrors the
 * `useTranslations(ns).t(key, values)` idiom used by most i18n libraries.
 *
 * Note: this contract is for **UI locale** (admin chrome translation) —
 * not for **content locale** (which language a document is being edited
 * in). Content locale stays on `FormRenderer` as `defaultLocale` /
 * `initialLocale` props because it's authored data, not chrome.
 */

export interface BylineLocaleOption {
  /** Locale code, e.g. `'en'`, `'es'`. */
  code: string
  /** Display label, typically the language's native name. */
  label: string
}

export type BylineTranslateFn = (
  namespace: string,
  key: string,
  values?: Record<string, unknown>
) => string

export interface BylineI18n {
  /** The currently active UI locale. */
  locale: string
  /** Fallback UI locale, used when a translation is missing. */
  defaultLocale: string
  /** All UI locales the host advertises in language switchers. */
  availableLocales: ReadonlyArray<BylineLocaleOption>
  /**
   * Translate a key within a namespace. Hosts that use ICU MessageFormat
   * should accept the `values` argument as the formatter's substitution
   * map; hosts without a formatter can ignore it. Missing keys should
   * fall back to the key itself so partial coverage degrades gracefully.
   */
  t: BylineTranslateFn
  /**
   * Optional setter for hosts that expose a runtime locale switch. Omit
   * when locale is route-driven and changes via navigation only.
   */
  setLocale?: (locale: string) => void
}
