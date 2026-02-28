// https://github.com/vercel/next.js/tree/canary/examples/app-dir-i18n-routing

export const i18nConfig = {
  locales: ['en', 'es'],
  defaultLocale: 'en',
  cookieName: 'lng',
} as const

export type Locale = (typeof i18nConfig)['locales'][number]
