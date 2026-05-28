/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useContext, useMemo } from 'react'

import { I18nContext } from './i18n-context.js'
import type { LocaleCode, MessageKey, Namespace, TranslationValues } from '../types.js'

export interface UseTranslationReturn {
  /** Format `namespace.key` against the provider's active locale. */
  t: (key: MessageKey, values?: TranslationValues) => string
  /** The active locale — useful for `<html lang>` and direction logic. */
  locale: LocaleCode
}

/**
 * Bind to a single namespace for the lifetime of the component. The
 * returned `t` resolves keys against the active locale with default-
 * locale fallback baked in (see `createFormatter` for the cascade).
 *
 * Throws if called outside `<I18nProvider>` — the loud failure is
 * deliberate. A silently-broken admin shell with raw keys on screen
 * is harder to notice than a thrown error during development.
 */
export function useTranslation(namespace: Namespace): UseTranslationReturn {
  const context = useContext(I18nContext)
  if (context == null) {
    throw new Error(
      '[@byline/i18n] useTranslation must be used inside <I18nProvider>. Mount the provider in your admin shell root.'
    )
  }
  const { formatter, activeLocale } = context
  return useMemo(
    () => ({
      t: (key, values) => formatter.t(namespace, key, values),
      locale: activeLocale,
    }),
    [formatter, namespace, activeLocale]
  )
}
