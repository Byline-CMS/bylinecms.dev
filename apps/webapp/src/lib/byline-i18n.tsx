/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Bridge component that adapts the webapp's existing TanStack-style
 * translation primitives to the framework-neutral `BylineI18n` contract
 * consumed by `@byline/ui`. Mounts inside the localized route subtree
 * (which already provides `TranslationsProvider`) so it can read the
 * loaded translation bag and the current locale, then re-emits both
 * through `BylineI18nProvider`.
 *
 * A future Next.js host would ship its own bridge file with the same
 * shape — the `@byline/ui` consumers don't change.
 */

import { type ReactNode, useContext, useMemo } from 'react'

import { type BylineI18n, BylineI18nProvider } from '@byline/ui'
import { IntlMessageFormat } from 'intl-messageformat'

import { TranslationsContext } from '@/i18n/client/translations-provider'
import { useLocale } from '@/i18n/hooks/use-locale-navigation'
import { i18nConfig } from '@/i18n/i18n-config'
import { interfaceLanguageMap } from '@/i18n/language-map'

interface BylineI18nBridgeProps {
  children: ReactNode
}

export function BylineI18nBridge({ children }: BylineI18nBridgeProps) {
  const translations = useContext(TranslationsContext)
  const locale = useLocale()

  const i18n = useMemo<BylineI18n>(
    () => ({
      locale,
      defaultLocale: i18nConfig.defaultLocale,
      availableLocales: i18nConfig.locales.map((code) => ({
        code,
        label: interfaceLanguageMap[code]?.nativeName ?? code,
      })),
      t: (namespace, key, values) => {
        const bag = translations as Record<string, Record<string, unknown>> | null
        const message = bag?.[namespace]?.[key] ?? key
        if (typeof message === 'string') {
          return new IntlMessageFormat(message).format(values) as string
        }
        return String(message)
      },
    }),
    [translations, locale]
  )

  return <BylineI18nProvider i18n={i18n}>{children}</BylineI18nProvider>
}
