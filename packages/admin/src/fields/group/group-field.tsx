/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useMemo } from 'react'

import type { Field, FieldAdminConfig, GroupField as GroupFieldType } from '@byline/core'
import { ErrorText } from '@byline/ui/react'
import cx from 'classnames'

import { sliceFieldAdmin } from '../../fields/field-admin'
import { placeholderForField } from '../../fields/field-helpers'
import { FieldRenderer } from '../../fields/field-renderer'
import { useFieldError } from '../../forms/form-context'
import styles from './group-field.module.css'

// ---------------------------------------------------------------------------
// GroupField — renders a fixed-order group of child fields wrapped in a
// single div. No drag-and-drop. No add/remove.
// The outer div carries the field type ('group') and field name as classes
// so consumers can target individual groups via CSS.
//
// Stable override handles: `.byline-field-group`, `.byline-field-group-header`,
// `.byline-field-group-title`, `.byline-field-group-help`,
// `.byline-field-group-body`.
// ---------------------------------------------------------------------------

interface GroupFieldProps {
  field: GroupFieldType
  defaultValue: any
  path: string
  /**
   * Threaded to child fields — governs only the *drag* affordance of any
   * `array` children (structural add/remove always renders; see ArrayField).
   * Defaults to `true` (conservative): arrays inside plain schema groups
   * stay drag-free. `BlocksField` passes `false` on its synthesized group so
   * arrays directly inside blocks are fully sortable — safe because each
   * `DraggableSortable` is an independent DndContext with grip-scoped
   * listeners.
   */
  disableSorting?: boolean
  /**
   * Collection path forwarded to upload-capable child fields (`file` / `image`),
   * which need it to reach the `/upload` endpoint. Without it those fields fall
   * back to their empty placeholder and never render an upload widget.
   */
  collectionPath?: string
  /**
   * Active content locale, forwarded to child fields so localized widgets
   * nested inside the group (e.g. a `localized` richText) can render their
   * locale badge.
   */
  contentLocale?: string
  /**
   * Per-child-field admin overrides (`components` slots, richtext `editor`),
   * keyed by dotted, index-free schema paths relative to this group
   * ('caption', 'faq.answer'). Threaded by `BlocksField` from the site-wide
   * `ClientConfig.blockAdmin` registry (block children render through a
   * synthesized group) and by `FieldRenderer` for plain schema groups, whose
   * map arrives pre-sliced from the collection admin config. Exact-name
   * entries apply to the child itself; deeper entries are re-sliced and
   * threaded on (see `sliceFieldAdmin`).
   */
  fieldAdmin?: Record<string, FieldAdminConfig>
}

export const GroupField = ({
  field,
  defaultValue,
  path,
  disableSorting = true,
  collectionPath,
  contentLocale,
  fieldAdmin,
}: GroupFieldProps) => {
  const fieldError = useFieldError(field.name)
  // Default value for a group field is a plain object: { rating: 5, comment: '...' }
  // Normalize to a plain object if not already one.
  const groupData = useMemo(() => {
    if (defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
      return defaultValue
    }
    // Fallback: build a placeholder object from child field definitions
    const placeholder: Record<string, any> = {}
    for (const childField of field.fields as Field[]) {
      placeholder[childField.name] = placeholderForField(childField)
    }
    return placeholder
  }, [defaultValue, field.fields])

  return (
    <div className={`byline-field-group ${field.name}`}>
      {field.label && (
        <div className={cx('byline-field-group-header', styles.header)}>
          <h3 className={cx('byline-field-group-title', styles.title)}>
            {field.label}{' '}
            {!field.optional && (
              <span className={cx('byline-field-group-required', styles.required)}>*</span>
            )}
          </h3>
          {field.helpText && (
            <p className={cx('byline-field-group-help', styles.help)}>{field.helpText}</p>
          )}
        </div>
      )}
      <div className={cx('byline-field-group-body', styles.body)}>
        {(field.fields as Field[]).map((innerField) => {
          return (
            <FieldRenderer
              key={innerField.name}
              field={innerField}
              defaultValue={groupData[innerField.name]}
              basePath={path}
              disableSorting={disableSorting}
              collectionPath={collectionPath}
              contentLocale={contentLocale}
              components={fieldAdmin?.[innerField.name]?.components}
              editor={fieldAdmin?.[innerField.name]?.editor}
              fieldAdmin={sliceFieldAdmin(fieldAdmin, innerField.name)}
            />
          )
        })}
      </div>
      {fieldError && <ErrorText id={`${field.name}-error`} text={fieldError} />}
    </div>
  )
}
