/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, ColumnDefinition } from '@byline/core'
import cx from 'classnames'

// ---------------------------------------------------------------------------
// Shared render helpers used by both the relation picker modal rows and
// the relation-summary tile on the edit form. Kept in lock-step so a row
// rendered in the picker looks identical to the selected tile.
// ---------------------------------------------------------------------------

/**
 * Render a single row cell from a `ColumnDefinition`, reading the value
 * from the document's `fields` (with a fallback to top-level metadata like
 * `status`, `updated_at`, `path`). Honours both formatter shapes — plain
 * function → its return value, `{ component }` → the component is rendered.
 */
export function PickerCell({
  column,
  record,
}: {
  column: ColumnDefinition
  record: Record<string, any>
}) {
  const name = String(column.fieldName)
  const value = record?.fields?.[name] ?? record?.[name]

  let content: any
  if (column.formatter) {
    if (typeof column.formatter === 'function') {
      content = column.formatter(value, record)
    } else {
      const Comp = column.formatter.component
      content = <Comp value={value} record={record} />
    }
  } else if (value == null) {
    content = null
  } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    content = String(value)
  } else {
    content = null
  }

  return (
    <div
      className={cx(
        'min-w-0 text-sm text-gray-100 truncate',
        column.align === 'center' && 'text-center',
        column.align === 'right' && 'text-right',
        column.className
      )}
    >
      {content}
    </div>
  )
}

/** First top-level `text` field name on a collection, or null. */
export function resolveFallbackDisplayField(
  def: CollectionDefinition | null | undefined
): string | null {
  if (!def) return null
  const textField = def.fields.find((f) => f.type === 'text')
  return textField?.name ?? null
}

/** Resolve the row's primary label text from the document. */
export function resolveRowLabel(
  doc: Record<string, any> | null | undefined,
  displayField: string | null
): string | null {
  if (!doc) return null
  if (displayField) {
    const v = doc.fields?.[displayField]
    if (typeof v === 'string' && v.length > 0) return v
  }
  if (typeof doc.fields?.title === 'string' && doc.fields.title.length > 0) {
    return doc.fields.title as string
  }
  if (typeof doc.path === 'string' && doc.path.length > 0) return doc.path as string
  return null
}

/**
 * Build the `fields` projection for the picker listing. Unions:
 *   - caller-supplied `displayField`
 *   - target schema's `useAsTitle`
 *   - every `fieldName` declared in the admin config's `picker` columns
 *   - `title` (metadata fallback for rows with no explicit picker columns)
 *
 * Returns `undefined` when no target definition is available, leaving the
 * listing endpoint to decide its own default projection.
 */
export function resolveSelectFields(
  def: CollectionDefinition | null | undefined,
  displayField: string | undefined,
  pickerColumns: ColumnDefinition[] | undefined
): string[] | undefined {
  if (!def) return undefined
  const out = new Set<string>()
  if (displayField) out.add(displayField)
  if (def.useAsTitle) out.add(def.useAsTitle)
  const fallback = resolveFallbackDisplayField(def)
  if (fallback) out.add(fallback)
  if (pickerColumns) {
    for (const col of pickerColumns) {
      const name = String(col.fieldName)
      if (def.fields.some((f) => f.name === name)) out.add(name)
    }
  }
  if (def.fields.some((f) => f.name === 'title')) out.add('title')
  if (out.size === 0) return undefined
  return Array.from(out)
}
