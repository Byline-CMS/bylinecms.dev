/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ReactNode } from 'react'

import cx from 'classnames'

interface GroupProps {
  /** Optional heading rendered as a `<legend>` above the cluster. */
  label?: string
  children: ReactNode
  className?: string
}

/**
 * Labelled fieldset clustering related fields together.
 *
 * Used by `FormRenderer` when a `CollectionAdminConfig` declares a `groups`
 * primitive. Renders a bordered, padded `<fieldset>` with an optional
 * `<legend>` for the label.
 */
export const Group = ({ label, children, className }: GroupProps) => {
  return (
    <fieldset
      className={cx(
        'border border-gray-200 dark:border-gray-700 rounded-md p-3 flex flex-col gap-4',
        className
      )}
    >
      {label && <legend className="px-1 text-sm font-medium">{label}</legend>}
      {children}
    </fieldset>
  )
}
