/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionAdminConfig, CollectionDefinition } from '@byline/core'
import cx from 'classnames'

import { PickerCell, resolveFallbackDisplayField, resolveRowLabel } from './relation-display'
import styles from './relation-summary.module.css'

// ---------------------------------------------------------------------------
// RelationSummary — selected-value tile for the relation field widget.
//
// Rendering priority (mirrors RelationPicker so the tile and picker rows
// look identical):
//   1. target `CollectionAdminConfig.picker` columns (full fidelity, with
//      formatters — e.g. MediaThumbnail + title)
//   2. explicit `displayField` prop (from source schema's RelationField)
//   3. `CollectionDefinition.useAsTitle`
//   4. first declared text field on the target
//   5. target UUID (only when nothing else is available — "resolved but
//      naked" or unpopulated)
//
// Value source priority:
//   1. `populated.document` — a `PopulatedRelationValue` attached by the
//      server-side populate pass on first page load.
//   2. `cachedRecord` — the raw document the picker just handed us after
//      a fresh pick (no server round trip needed).
//   3. neither — we have only the stored ref; fall through to UUID.
// ---------------------------------------------------------------------------

interface RelationSummaryProps {
  targetDefinition: CollectionDefinition
  targetAdminConfig: CollectionAdminConfig | null
  displayField?: string
  /** The raw relation value from the form. May be a plain ref or a populated envelope. */
  value: {
    targetDocumentId: string
    targetCollectionId: string
    _resolved?: boolean
    _cycle?: boolean
    document?: Record<string, any>
  }
  /**
   * A document record cached client-side from a recent picker selection.
   * Used when `value` is a plain ref (post-pick state) but we still want
   * the tile to render real display data without a refetch. Caller is
   * responsible for clearing/replacing this when the value's
   * `targetDocumentId` changes.
   */
  cachedRecord?: Record<string, any> | null
}

export function RelationSummary({
  targetDefinition,
  targetAdminConfig,
  displayField,
  value,
  cachedRecord,
}: RelationSummaryProps) {
  const pickerColumns = targetAdminConfig?.picker

  // Unresolved (deleted target).
  if (value._resolved === false) {
    return (
      <div className={cx('byline-relation-summary-stack', styles.stack)}>
        <span className={cx('byline-relation-summary-kind', styles.kind)}>
          {targetDefinition.labels.singular}
        </span>
        <span
          className={cx(
            'byline-relation-summary-value-mono byline-relation-summary-missing',
            styles['value-mono'],
            styles.missing
          )}
        >
          (target not found) {value.targetDocumentId}
        </span>
      </div>
    )
  }

  // Prefer the populated envelope's document; fall back to the cached
  // picker record; finally fall back to rendering just the raw ref.
  const record: Record<string, any> | null =
    (value._resolved === true && !value._cycle && value.document) || cachedRecord || null

  if (record && pickerColumns && pickerColumns.length > 0) {
    return (
      <div className={cx('byline-relation-summary-row', styles.row)}>
        {pickerColumns.map((col) => (
          <PickerCell key={String(col.fieldName)} column={col} record={record} />
        ))}
      </div>
    )
  }

  const resolvedDisplayField =
    displayField ??
    targetDefinition.useAsTitle ??
    resolveFallbackDisplayField(targetDefinition) ??
    null
  const label = record ? resolveRowLabel(record, resolvedDisplayField) : null

  return (
    <div className={cx('byline-relation-summary-stack', styles.stack)}>
      <span className={cx('byline-relation-summary-kind', styles.kind)}>
        {targetDefinition.labels.singular}
      </span>
      {label ? (
        <span className={cx('byline-relation-summary-value', styles.value)}>{label}</span>
      ) : (
        <span className={cx('byline-relation-summary-value-mono', styles['value-mono'])}>
          {value.targetDocumentId}
        </span>
      )}
    </div>
  )
}
