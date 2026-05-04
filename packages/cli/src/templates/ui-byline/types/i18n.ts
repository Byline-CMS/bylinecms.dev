/**
 * `Locale` type used throughout the ui/byline tree as a `lng` prop type.
 *
 * The reference webapp ships its own `i18n-config.ts` that narrows this
 * to a literal union of supported locales (`'en' | 'fr' | ...`). This
 * stub keeps the type as `string` so the install builds without
 * requiring you to wire up an i18n config.
 *
 * If your app has its own i18n setup, replace this file with one that
 * re-exports your narrower `Locale` type, e.g.
 *
 *   export type { Locale } from '@/i18n/i18n-config'
 */
export type Locale = string
