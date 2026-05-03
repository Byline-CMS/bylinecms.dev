import type { Intent, Size } from '../../@types/shared.js'

/**
 * Available behavioural variants for the Chip component.
 */
export const chipVariant = ['assist', 'selectable', 'removable', 'selectable-removable'] as const

/**
 * Behavioural variant of the chip.
 *
 * - `assist`               — non-interactive display chip, purely informational
 * - `selectable`           — toggles on/off when clicked (like a filter tag)
 * - `removable`            — shows a dismiss/close button to remove the chip
 * - `selectable-removable` — combines toggle selection with a dismiss button
 */
export type ChipVariant = (typeof chipVariant)[number]

/**
 * Semantic color intent of the chip. Inherits all values from the shared `Intent` type.
 * Controls the chip's background and text color.
 * @default 'primary'
 */
export type ChipIntent = Intent

/**
 * Visual size of the chip. Inherits all values from the shared `Size` type.
 * @default 'md'
 */
export type ChipSize = Size
