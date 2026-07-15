/**
 * `Locale` type used throughout the ui/byline tree as a `lng` prop type.
 *
 * This portable default stays `string` so the scaffold builds without an
 * application-specific i18n module.
 *
 * If your app has its own i18n setup, replace this alias with its narrower
 * locale union or re-export that setup's `Locale` type from this file.
 */
export type Locale = string
