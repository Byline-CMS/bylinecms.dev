import type { Intent as t } from '../../@types/shared.js'

/**
 * Available visual style variants for the Autocomplete input.
 */
export const variant = ['outlined', 'filled', 'underlined'] as const

/**
 * Visual style variant of the autocomplete input field.
 *
 * - `outlined`   — full border on all sides with a transparent background (default)
 * - `filled`     — tinted background
 * - `underlined` — bottom border only, no background (minimal style)
 *
 * @default 'outlined'
 */
export type Variant = (typeof variant)[number]

/**
 * Available size tokens for the Autocomplete component.
 */
export const size = ['sm', 'md', 'lg'] as const

/**
 * Visual size of the autocomplete component.
 *
 * - `sm` — compact, suitable for inline forms or dense layouts
 * - `md` — standard form size (default)
 * - `lg` — large, prominent input
 *
 * @default 'md'
 */
export type Size = (typeof size)[number]

/**
 * Semantic color intent applied to the autocomplete border and focus ring.
 * @default 'primary'
 */
export type Intent = 'primary' | t
