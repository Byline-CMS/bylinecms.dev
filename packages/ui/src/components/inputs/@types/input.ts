/* eslint-disable @typescript-eslint/naming-convention */
import type { ReactNode } from 'react'

// generic types
import type { Intent as t } from '../../@types/shared.js'

/**
 * This file contains the types and prop-types for the Input and related form components.
 */

// typescript types

/**
 * Available visual style variants for the Input component.
 */
export const variant = ['outlined', 'filled', 'underlined'] as const

/**
 * Visual style variant of the input field.
 *
 * - `outlined`   — full border on all sides with a transparent background (default)
 * - `filled`     — tinted background with only a bottom border
 * - `underlined` — bottom border only, no background (minimal style)
 *
 * @default 'outlined'
 */
export type Variant = (typeof variant)[number]

/**
 * Available size tokens for form inputs.
 */
export const size = ['sm', 'md', 'lg'] as const

/**
 * Visual size of the input field.
 *
 * - `sm` — compact, suitable for inline forms or dense layouts
 * - `md` — standard form size (default)
 * - `lg` — large, prominent or hero input
 *
 * @default 'md'
 */
export type Size = (typeof size)[number]

/**
 * Semantic color intent applied to the input border and focus ring.
 * @default 'primary'
 */
export type Intent = 'primary' | t
export type ClassName = string
export type Children = ReactNode
