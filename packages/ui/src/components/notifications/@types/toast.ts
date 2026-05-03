// generic types
import type { Icons as i, Position as p, Intent as t } from '../../@types/shared.js'

/**
 * This file contains the types and prop-types for the Toast component.
 */

// typescript types

/**
 * Semantic color intent of the toast notification.
 *
 * Controls the toast's background color, icon, and text style.
 *
 * - `primary`   — standard informational toast (default)
 * - `secondary` — alternate neutral style
 * - `noeffect`  — gray, no color emphasis
 * - `success`   — positive confirmation (green)
 * - `info`      — informational, non-critical (cyan/blue)
 * - `warning`   — caution, needs attention (yellow/amber)
 * - `danger`    — error or destructive state (red)
 *
 * @default 'primary'
 */
export type Intent = 'primary' | t

/**
 * Screen corner position for the toast viewport.
 *
 * - `top-left`     — top-left corner of the viewport
 * - `top-right`    — top-right corner of the viewport (default)
 * - `bottom-left`  — bottom-left corner of the viewport
 * - `bottom-right` — bottom-right corner of the viewport
 *
 * @default 'bottom-right'
 */
export type Position = 'top-right' | p

/**
 * Icon variant displayed inside the toast.
 * Maps to the corresponding status icon component.
 */
export type IconType = 'success' | i

/**
 * Custom data passed to each toast via the toast manager's `add()` method.
 */
export interface ToastData {
  intent?: Intent
  iconType?: IconType
  icon?: boolean
  close?: boolean
}
