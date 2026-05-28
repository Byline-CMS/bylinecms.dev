/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useFieldValue } from '@byline/admin/react'
import type { FieldHelpTextSlotProps, SlotComponent } from '@byline/core'

import { LengthIndicator } from './length-indicator'
import styles from './summary-length.module.css'

/**
 * Custom HelpText slot component for summary-style textArea fields.
 *
 * Renders the field's `helpText` description alongside a live character-count
 * indicator that updates reactively as the user types. Wire it up via the
 * `components.HelpText` slot in the collection's `CollectionAdminConfig.fields`
 * or directly on the field definition's `components` property.
 *
 * @example
 * ```ts
 * // In CollectionAdminConfig
 * fields: { summary: { components: { HelpText: SummaryLength } } }
 * ```
 */
export const SummaryLength: SlotComponent<FieldHelpTextSlotProps> = ({ path, helpText }) => {
  const value = useFieldValue<string>(path)

  return (
    <div className={styles.wrap}>
      <LengthIndicator minLength={100} maxLength={300} text={value} />
      {helpText && <p className={styles['help-text']}>{helpText}</p>}
    </div>
  )
}
