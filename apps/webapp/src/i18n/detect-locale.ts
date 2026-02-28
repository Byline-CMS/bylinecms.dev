/**
 * Server-side locale detection utility.
 *
 * Detection priority (mirrors the previous Next.js middleware):
 *   1. Cookie (`lng`)
 *   2. Path parameter (the optional {-$lng} segment)
 *   3. Accept-Language header negotiation
 *   4. Default locale fallback
 *
 * Uses @formatjs/intl-localematcher + negotiator for standards-compliant
 * Accept-Language matching.
 */

import { match } from '@formatjs/intl-localematcher'
import Negotiator from 'negotiator'

import { i18nConfig, type Locale } from '@/i18n/i18n-config'

interface DetectLocaleOptions {
  /** The cookie value for the locale (e.g. from getCookie('lng')). */
  cookie?: string | null
  /** The {-$lng} path param from the URL, if present. */
  pathLocale?: string | null
  /** The raw Accept-Language header value. */
  acceptLanguage?: string | null
}

/**
 * Detect the best locale for the current request.
 *
 * Returns a validated Locale — never an arbitrary string.
 */
export function detectLocale(options: DetectLocaleOptions = {}): Locale {
  const { cookie, pathLocale, acceptLanguage } = options

  // 1. Cookie — explicit user preference
  if (cookie && i18nConfig.locales.includes(cookie as Locale)) {
    return cookie as Locale
  }

  // 2. Path parameter — already validated upstream, but double-check
  if (pathLocale && i18nConfig.locales.includes(pathLocale as Locale)) {
    return pathLocale as Locale
  }

  // 3. Accept-Language header negotiation
  if (acceptLanguage) {
    try {
      const negotiator = new Negotiator({
        headers: { 'accept-language': acceptLanguage },
      })
      const languages = negotiator.languages()
      const matched = match(
        languages,
        i18nConfig.locales as unknown as string[],
        i18nConfig.defaultLocale
      )
      return matched as Locale
    } catch {
      // Fall through to default on any negotiation error
    }
  }

  // 4. Default fallback
  return i18nConfig.defaultLocale
}
