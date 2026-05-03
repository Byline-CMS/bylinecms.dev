// generic types
import type { Intent as t } from '../../@types/shared.js'

/**
 * This file contains the types and prop-types for the Alert component.
 */

// typescript types

/**
 * Semantic color intent of the alert.
 *
 * Controls the alert's background color, left border accent, icon, and text.
 *
 * - `primary`   — informational blue-tinted alert (default)
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
