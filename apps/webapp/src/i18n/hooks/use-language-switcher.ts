/**
 * Language switcher hook for TanStack Router.
 *
 * Switches the interface locale by:
 * 1. Persisting the choice to the `lng` cookie via a server function
 * 2. Navigating to the same path with the new locale param
 */

import { useNavigate, useRouterState } from '@tanstack/react-router'

import { useLocale } from '@/i18n/hooks/use-locale-navigation'
import { i18nConfig, type Locale } from '@/i18n/i18n-config'
import { setLanguageFn } from '@/i18n/set-language-fn'

export function useLanguageSwitcher() {
  const navigate = useNavigate()
  const currentLocale = useLocale()
  const location = useRouterState({ select: (s) => s.location })

  const switchLanguage = async (lng: Locale) => {
    if (lng === currentLocale) return

    // 1. Persist the new locale to cookie
    await setLanguageFn({ data: { lng } })

    // 2. Strip existing locale prefix from the current pathname
    let path = location.pathname
    for (const loc of i18nConfig.locales) {
      if (path.startsWith(`/${loc}/`)) {
        path = path.slice(loc.length + 1)
        break
      }
      if (path === `/${loc}`) {
        path = '/'
        break
      }
    }

    // 3. Navigate with the new locale prefix (omit for default locale)
    const newPath = lng === i18nConfig.defaultLocale ? path : `/${lng}${path}`

    navigate({
      to: newPath,
      replace: true,
      resetScroll: false,
    })
  }

  return {
    switchLanguage,
    currentLocale,
  }
}
