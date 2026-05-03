/* eslint-disable @typescript-eslint/naming-convention */
import type { ReactNode } from 'react'

// generic types
import type { Intent as t } from '../../@types/shared.js'

/**
 * This file contains the types and prop-types for the Checkbox and CheckboxGroup components.
 */

// typescript types

/**
 * Available visual style variants for the Checkbox component.
 */
export const variant = ['outlined', 'filled'] as const

/**
 * Visual style variant of the checkbox.
 *
 * - `outlined` — hollow checkbox with an intent-colored border; fills on check (default)
 * - `filled`   — always has a tinted background, more prominent in forms
 *
 * @default 'outlined'
 */
export type Variant = (typeof variant)[number]

/**
 * Available size tokens for checkboxes.
 */
export const size = ['sm', 'md', 'lg'] as const

/**
 * Visual size of the checkbox.
 *
 * - `sm` — small, for dense lists
 * - `md` — standard size (default)
 * - `lg` — large, for touch-friendly or prominent forms
 *
 * @default 'md'
 */
export type Size = (typeof size)[number]

/**
 * Semantic color intent applied to the checkbox border and checked state.
 * @default 'primary'
 */
export type Intent = 'primary' | t
export type ClassName = string
export type Children = ReactNode
