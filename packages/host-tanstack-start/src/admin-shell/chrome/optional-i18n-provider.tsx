/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type ReactNode, useContext } from 'react'

import { getAdminConfig } from '@byline/core'
import type { TranslationBundle } from '@byline/i18n'
import { I18nContext, I18nProvider } from '@byline/i18n/react'

/**
 * Guarantees a translation context for chrome that can render *outside*
 * the admin layout's `<I18nProvider>`.
 *
 * When a provider is already above us it is reused as-is, preserving the
 * user's active locale. Only when none is present does this self-mount.
 *
 * Resilient by design: components using this are the ones shown when
 * something has already gone wrong, so throwing here would mask the real
 * condition. If the admin config can't be read it falls back to an
 * English-default provider with an empty bundle — with a provider always
 * present, `useTranslation` never throws, and a missing key renders as the
 * raw key rather than crashing (see `I18nProvider`'s `onMissing`).
 *
 * `route-error.tsx` carries its own equivalent copy of this logic; it was
 * left in place deliberately rather than refactored alongside an unrelated
 * change, and can adopt this component whenever that file is next touched.
 */
export function OptionalI18nProvider({ children }: { children: ReactNode }) {
  // Already inside a provider — reuse it (keeps the active locale) and skip
  // the self-mount entirely.
  if (useContext(I18nContext) != null) {
    return <>{children}</>
  }
  let bundle: TranslationBundle = {}
  let locale = 'en'
  try {
    const { i18n } = getAdminConfig()
    bundle = i18n.translations ?? {}
    // No active provider, so render in the default locale — recovering the
    // per-user active locale isn't worth another lookup that could itself throw.
    locale = i18n.admin.defaultLocale
  } catch {
    // Config unavailable (very early boot / broken provider chain) — fall
    // through with the English defaults above.
  }
  return (
    <I18nProvider
      bundle={bundle}
      activeLocale={locale}
      defaultLocale={locale}
      localeDefinitions={[]}
    >
      {children}
    </I18nProvider>
  )
}
