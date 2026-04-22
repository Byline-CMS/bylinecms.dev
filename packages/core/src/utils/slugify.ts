/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Context passed to a `SlugifierFn`.
 *
 * `locale`         - The content locale being slugified (e.g. the default
 *                    content locale when deriving `documentVersions.path`).
 * `collectionPath` - The collection that owns the value being slugified.
 *                    Lets installation-supplied slugifiers branch by
 *                    collection if URL policies differ.
 */
export type SlugifyContext = {
  locale: string
  collectionPath: string
}

/**
 * A pure function that converts a raw value into a URL-safe slug.
 *
 * Implementations must be synchronous and side-effect free — they are
 * called both server-side at write time and client-side for live form
 * preview / validation, and the two MUST agree on output.
 */
export type SlugifierFn = (value: string, ctx: SlugifyContext) => string

/**
 * Detects whether a string value looks like an ISO 8601 datetime.
 *
 * Used to decide between date-style and text-style slug formatting when
 * the source field is a date/datetime.
 */
export function looksLikeISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value)
}

/**
 * Extracts the `yyyy-mm-dd` portion of an ISO 8601 datetime string for
 * use as a slug segment.
 */
function formatDateValue(value: string): string {
  return value.substring(0, 10)
}

/**
 * Default slug formatter. Unicode-aware (NFC), strips HTML, replaces
 * whitespace and punctuation with hyphens, and preserves Latin and Thai
 * letters plus digits and underscores. Output is lowercase, with
 * collapsed and trimmed hyphens.
 *
 * Used by core when no installation slugifier is configured on
 * `ServerConfig.slugifier`.
 */
export function formatTextValue(value: string): string {
  if (typeof value !== 'string') {
    return ''
  }

  // Remove HTML tags
  let formatted = value.replace(/<[^>]*>/g, '')

  // Normalise to NFC (composed form) without affecting complex Unicode
  formatted = formatted.normalize('NFC')

  // Lowercase Latin characters
  formatted = formatted.toLowerCase()

  // Replace spaces and punctuation-like separators with a hyphen
  formatted = formatted.replace(/[\s\p{Z}\p{P}]+/gu, '-')

  // Strip anything that isn't a Thai letter (U+0E00–U+0E7F), word char, or hyphen
  formatted = formatted.replace(/[^฀-๿\w-]+/gu, '')

  // Collapse runs of hyphens
  formatted = formatted.replace(/-+/g, '-')

  // Trim leading/trailing hyphens
  formatted = formatted.replace(/^-+|-+$/g, '')

  return formatted
}

/**
 * The default slugifier shipped with `@byline/core`.
 *
 * Branches on the value to keep ISO datetimes legible (`2026-04-22`
 * rather than the slugified `2026-04-22t12-00-00z`).
 *
 * Callers must coerce non-string source values (e.g. `Date`) to a string
 * before invocation — typically `value instanceof Date ? value.toISOString() : String(value)`.
 */
export const slugify: SlugifierFn = (value, _ctx) => {
  if (value == null || value.length === 0) return ''
  return looksLikeISODate(value) ? formatDateValue(value) : formatTextValue(value)
}
