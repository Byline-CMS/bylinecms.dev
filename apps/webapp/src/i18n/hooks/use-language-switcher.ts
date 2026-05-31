/**
 * Language switcher hook for TanStack Router.
 *
 * Switches the interface locale by:
 * 1. Persisting the choice to the `lng` cookie via a server function
 * 2. Navigating to the same path with the new locale param
 */

import { useNavigate, useRouterState } from '@tanstack/react-router'

import { useInterfaceLocale, useLocale } from '@/i18n/hooks/use-locale-navigation'
import { i18nConfig, type Locale, routableLocales } from '@/i18n/i18n-config'
import { setLanguageFn } from '@/i18n/set-language-fn'

export function useLanguageSwitcher() {
  const navigate = useNavigate()
  // The switcher lists *interface* locales only. `pathLocale` is the URL's
  // actual locale (possibly content-only) — used to decide whether a switch
  // changes anything; `interfaceLocale` is the menu's active highlight.
  const pathLocale = useLocale()
  const interfaceLocale = useInterfaceLocale()
  const location = useRouterState({ select: (s) => s.location })

  const switchLanguage = async (lng: Locale) => {
    // No-op only when the URL is already exactly this locale. (On a
    // content-only prefix like `/fr`, picking the chrome's fallback locale
    // still navigates — it strips `/fr` back to the interface URL.)
    if (lng === pathLocale) return

    // 1. Persist the new interface locale to the cookie
    await setLanguageFn({ data: { lng } })

    // 2. Strip any existing routable locale prefix from the current pathname
    //    (interface *or* content — switching off `/fr` must not yield
    //    `/es/fr/...`).
    let path = location.pathname
    for (const loc of routableLocales) {
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
    currentLocale: interfaceLocale,
  }
}
