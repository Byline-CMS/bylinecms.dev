import { i18nConfig, type Locale } from './i18n-config'

export const pathWithoutLocale = (pathname: string): string => {
  const pathnameIsMissingLocale = i18nConfig.locales.every(
    (locale) => !pathname.startsWith(`/${locale}/`) && pathname !== `/${locale}`
  )
  if (pathnameIsMissingLocale) {
    return pathname
  }
  // TODO: correctly remove locales based on locale match,
  // which could be en-US, en-CA etc.
  const withoutLocale = pathname.substring(3)
  if (withoutLocale.length === 0) {
    return '/'
  }
  return withoutLocale
}

export const localeFromPath = (path: string, fallbackToDefault = true): string | undefined => {
  const localeInPath = i18nConfig.locales.find((locale) => {
    return path.startsWith(`/${locale}/`) || path === `/${locale}`
  })
  if (localeInPath != null) {
    return localeInPath
  }
  if (localeInPath == null && fallbackToDefault === true) {
    return i18nConfig.defaultLocale
  }
  return undefined
}

export const isValidLocale = (locale: Locale): boolean => {
  return i18nConfig.locales.includes(locale)
}
