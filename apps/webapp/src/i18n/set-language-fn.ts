/**
 * TanStack Start server function for persisting the locale preference.
 *
 * Initial locale detection (cookie + Accept-Language negotiation) lives
 * in `apps/webapp/src/middleware/locale-redirect.ts` and runs at the
 * HTTP middleware layer for the `{-$lng}` route subtree — it is not a
 * server function and has no client trampoline.
 */

import { createServerFn } from '@tanstack/react-start'
import { setCookie } from '@tanstack/react-start/server'

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
