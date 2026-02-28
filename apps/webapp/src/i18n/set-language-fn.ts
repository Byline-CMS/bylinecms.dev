/**
 * TanStack Start server functions for locale management.
 *
 * - setLanguageFn: persist the locale preference cookie.
 * - detectLocaleFn: detect locale from cookie / Accept-Language header.
 *
 * Replaces the Next.js server actions and middleware locale detection.
 * Uses createServerFn so cookies are set via proper Set-Cookie headers,
 * which is secure and SSR-compatible.
 */

import { createServerFn } from '@tanstack/react-start'
import { getCookie, getRequestHeader, setCookie } from '@tanstack/react-start/server'

import { detectLocale } from '@/i18n/detect-locale'
import { i18nConfig, type Locale } from '@/i18n/i18n-config'

export const setLanguageFn = createServerFn({ method: 'POST' })
  .inputValidator((input: { lng: string }) => {
    if (!i18nConfig.locales.includes(input.lng as Locale)) {
      throw new Error(`Invalid locale: ${input.lng}`)
    }
    return input as { lng: Locale }
  })
  .handler(async ({ data }) => {
    setCookie(i18nConfig.cookieName, data.lng, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 365, // 365 days
    })

    return { success: true, lng: data.lng }
  })

/**
 * Server function to detect the best locale for the current request.
 *
 * Priority: cookie → Accept-Language header → default locale.
 * The optional {-$lng} path parameter is validated upstream by the route
 * itself, so it is not passed here.
 */
export const detectLocaleFn = createServerFn({ method: 'GET' }).handler(async () => {
  const cookie = getCookie(i18nConfig.cookieName)
  const acceptLanguage = getRequestHeader('accept-language')

  const locale = detectLocale({ cookie, acceptLanguage })

  return { locale }
})
