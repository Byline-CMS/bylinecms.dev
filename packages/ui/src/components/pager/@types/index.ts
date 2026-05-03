/**
 * Available layout variants for the Pagination component.
 */
export const variant = ['default', 'classic', 'dashboard'] as const

/**
 * Layout variant of the pagination control.
 *
 * - `default`   — numbered page buttons with previous/next arrows (default)
 * - `classic`   — previous/next arrows with a direct page number input
 * - `dashboard` — compact variant optimised for data tables and dashboards
 *
 * @default 'default'
 */
export type Variant = (typeof variant)[number]
