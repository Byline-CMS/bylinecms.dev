import type { FieldBeforeChangeResult, FieldHookContext } from '@byline/core'

export const formatTextField = (val: string): string => {
  if (typeof val !== 'string') {
    return ''
  }

  // Remove HTML tags
  let formatted = val.replace(/<[^>]*>/g, '')

  // Normalize to decompose accented characters (e.g., é → e), without affecting complex Unicode
  // formatted = formatted.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  formatted = formatted.normalize('NFC')

  // Convert to lowercase for Latin characters
  formatted = formatted.toLowerCase()

  // Replace spaces and punctuation-like separators with a hyphen
  formatted = formatted.replace(/[\s\p{Z}\p{P}]+/gu, '-')

  // Remove any remaining characters that are not letters, numbers, hyphens, or underscores
  // formatted = formatted.replace(/[^-\w\p{L}\p{N}]+/gu, '')
  formatted = formatted.replace(/[^\u0E00-\u0E7F\w-]+/gu, '')

  // Replace multiple hyphens with a single hyphen
  formatted = formatted.replace(/-+/g, '-')

  // Trim leading and trailing hyphens
  formatted = formatted.replace(/^-+|-+$/g, '')

  // Truncate to 256 characters, ensuring no trailing hyphen
  // formatted = formatted.slice(0, 256).replace(/-+$/g, '')

  return formatted
}

/**
 * formatDateField
 *
 * @description Datetime field values stored in ISO 8601 format — extract
 * the `yyyy-mm-dd` date portion for use as a slug segment.
 * @param {string} value
 * @returns {string}
 */
const formatDateField = (value: string): string => value.substring(0, 10)

/**
 * Detects whether a string value looks like an ISO 8601 datetime.
 * Used to decide between date-style and text-style slug formatting
 * when inferring the source field type from its value at runtime.
 */
const looksLikeISODate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}/.test(value)

/**
 * formatSlug
 *
 * Returns a `beforeValidate` hook function for a slug / path field.
 *
 * **On change** (`operation === 'change'`): advisory — the user's typed value
 * is always committed (preserving cursor position) and an error is shown
 * whenever the value doesn't match its slugified form.
 *
 * **On submit** (`operation === 'submit'`): if the path value is empty the
 * hook auto-populates it from the source field (returning `{ value }`).
 * If the path has content it is validated — invalid characters produce an
 * error that blocks submission.
 *
 * @param sourceFieldName  The name of the field to derive a slug from when
 *                         the slug field itself is empty (e.g. `'title'`).
 *
 * @example
 * ```ts
 * {
 *   name: 'path',
 *   type: 'text',
 *   hooks: {
 *     beforeValidate: formatSlug('title'),
 *   },
 * }
 * ```
 */
export const formatSlug = (
  sourceFieldName: string
): ((ctx: FieldHookContext) => FieldBeforeChangeResult | void) => {
  return (ctx: FieldHookContext): FieldBeforeChangeResult | void => {
    const { value, data, operation } = ctx

    // ── 1. Value present — validate it as a slug ──────────────────
    if (typeof value === 'string' && value.length > 0) {
      const formatted = formatTextField(value)
      if (formatted !== value) {
        return {
          error: `Path contains invalid characters. Suggested: "${formatted}"`,
        }
      }
      return // valid slug — no error
    }

    // ── 2. Value empty — derive from the source field ─────────────
    const sourceValue = data?.[sourceFieldName]

    if (sourceValue != null) {
      // Coerce Date objects to ISO strings so we can format them
      const asString = sourceValue instanceof Date ? sourceValue.toISOString() : String(sourceValue)

      if (asString.length > 0) {
        const suggested = looksLikeISODate(asString)
          ? formatDateField(asString)
          : formatTextField(asString)

        if (suggested.length > 0) {
          if (operation === 'submit') {
            // Auto-populate the field value before validation
            return { value: suggested }
          }
          // Advisory during editing — show a hint but don't alter the value
          return {
            error: `Path is empty — suggested from ${sourceFieldName}: "${suggested}"`,
          }
        }
      }
    }
  }
}

export default formatSlug
