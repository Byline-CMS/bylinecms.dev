// typescript types

// Arrays make available an iterator for easy storybook layout

/**
 * Available size tokens, ordered from smallest to largest.
 * Most components default to `'md'`.
 */
export const size = ['xs', 'sm', 'md', 'lg', 'xl'] as const

/**
 * Visual size of a component.
 *
 * - `xs` — extra-small, compact inline use
 * - `sm` — small, tight layouts
 * - `md` — standard size (default for most components)
 * - `lg` — large, prominent elements
 * - `xl` — extra-large, hero or display use
 *
 * @default 'md'
 */
export type Size = (typeof size)[number]

/**
 * Available semantic color intents.
 * Controls the visual meaning (color, icon) of a component.
 */
export const intent = [
  'primary',
  'secondary',
  'noeffect',
  'success',
  'info',
  'warning',
  'danger',
] as const

/**
 * Semantic color intent applied to a component.
 *
 * - `primary`   — brand/main action (blue by default)
 * - `secondary` — alternate/supporting action
 * - `noeffect`  — neutral, no color emphasis (gray)
 * - `success`   — positive outcome or confirmation (green)
 * - `info`      — informational, non-critical (cyan/blue)
 * - `warning`   — caution, needs attention (yellow/amber)
 * - `danger`    — destructive action or error state (red)
 *
 * @default 'primary'
 */
export type Intent = (typeof intent)[number]

/**
 * Status icon variants used inside notification components.
 */
export const icons = ['success', 'info', 'success', 'warning', 'danger'] as const

/**
 * Icon variant shown inside a notification (e.g. Toast, Alert).
 * Maps to the corresponding status icon.
 */
export type Icons = (typeof icons)[number]

/**
 * Screen corner positions for floating elements.
 */
export const position = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const

/**
 * Corner position for floating/overlay elements such as toasts and popovers.
 *
 * - `top-left`     — top-left corner of the viewport
 * - `top-right`    — top-right corner of the viewport (default for toasts)
 * - `bottom-left`  — bottom-left corner of the viewport
 * - `bottom-right` — bottom-right corner of the viewport
 *
 * @default 'top-right'
 */
export type Position = (typeof position)[number]
