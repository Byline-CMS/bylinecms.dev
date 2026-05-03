// generic types
import type { Size as s, Intent as t } from '../../@types/shared.js'

/**
 * This file contains the types and prop-types for the Button and IconButton components.
 */

// typescript types

/**
 * Available visual style variants for Button and IconButton.
 */
export const variant = ['filled', 'filled-weak', 'outlined', 'gradient', 'text'] as const

/**
 * Visual style variant of the button.
 *
 * - `filled`      — solid background fill using the intent color (default)
 * - `filled-weak` — lightly tinted background, lower visual weight than `filled`
 * - `outlined`    — transparent background with an intent-colored border
 * - `gradient`    — gradient background from intent start to end color
 * - `text`        — no background or border, label only (like a hyperlink)
 *
 * @default 'filled'
 */
export type Variant = (typeof variant)[number]

/**
 * Size of the button. Inherits from the shared `Size` type.
 * @default 'md'
 */
export type Size = 'md' | s

/**
 * Semantic color intent of the button. Inherits from the shared `Intent` type.
 * @default 'primary'
 */
export type Intent = 'primary' | t

/**
 * When `true`, the button expands to fill 100% of its container width.
 * @default false
 */
export type FullWidth = boolean

/**
 * When `true`, enables a Material-style ripple animation on click/tap.
 * @default false
 */
export type EnableRipple = boolean
