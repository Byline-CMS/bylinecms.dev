/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export interface LocaleBadgeProps {
  locale: string
}

/**
 * Small inline badge shown next to the label of a field that has
 * `localized: true` in its schema definition. Indicates which locale
 * the editor is currently working in.
 */
export const LocaleBadge = ({ locale }: LocaleBadgeProps) => (
  <span
    aria-hidden="true"
    title={`Localised \u2014 editing ${locale.toUpperCase()} content`}
    className={[
      'inline-flex items-center gap-0.5 ml-1.5 px-1.5 py-0.5 rounded',
      'text-[0.6rem] font-semibold uppercase tracking-widest leading-none',
      'bg-blue-100 dark:bg-yellow-900/40',
      'text-yellow-600 dark:text-yellow-400',
      'border border-blue-200 dark:border-yellow-700',
      'pointer-events-none select-none align-middle',
    ].join(' ')}
  >
    {locale}
  </span>
)
