/**
 * TanStack Start server function to persist the locale preference cookie.
 *
 * Replaces the Next.js server action (set-language-action.ts).
 * Uses createServerFn so the cookie is set via proper Set-Cookie headers,
 * which is secure and SSR-compatible.
 */

import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie } from '@tanstack/react-start/server'

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
 * Server function to read the locale cookie from an incoming request.
 * Useful for first-visit locale detection when SSR is enabled.
 */
export const getLanguageCookieFn = createServerFn({ method: 'GET' }).handler(async () => {
  const lng = getCookie(i18nConfig.cookieName) as Locale | undefined
  return { lng: lng ?? null }
})
