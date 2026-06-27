/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  CollectionDefinition,
  ColumnDefinition,
  ColumnFormatter,
  RelationField,
} from '@byline/core'
import { getCollectionDefinition } from '@byline/core'

import { resolveFallbackDisplayField, resolveRowLabel } from './relation-display'

// ---------------------------------------------------------------------------
// Built-in list-view column formatter for `relation` fields. Renders the
// target's title (via the displayField → useAsTitle → first-text chain)
// instead of a raw `target_document_id`. For `hasMany` relations it renders
// the first few titles followed by "+N more".
//
// Requires the list read to populate relation columns (depth 1) — the list
// server fn does this for relation columns so each cell value arrives as a
// populated relation envelope (`{ targetDocumentId, _resolved, document }`)
// or, for hasMany, an array of them.
// ---------------------------------------------------------------------------

interface RelationEnvelope {
  targetDocumentId?: string
  _resolved?: boolean
  document?: Record<string, any>
}

/** Max titles shown for a hasMany cell before collapsing to "+N more". */
const MAX_SHOWN = 3

function labelFor(
  env: RelationEnvelope | null | undefined,
  displayField: string | null
): string | null {
  // Unresolved (deleted / out-of-scope target) or not populated → no title.
  if (env == null || env._resolved === false || env.document == null) return null
  return resolveRowLabel(env.document, displayField)
}

/**
 * Pure text projection of a relation cell: the target's title for a single
 * relation, or "A, B, +N more" for `hasMany`. Unresolved targets are skipped;
 * an all-empty cell yields `null` (the formatter renders a muted dash).
 *
 * `displayField` is the resolved chain
 * (`field.displayField` → target `useAsTitle` → first text field).
 */
export function formatRelationCellText(
  field: Pick<RelationField, 'hasMany'>,
  value: unknown,
  displayField: string | null
): string | null {
  const envelopes: RelationEnvelope[] = field.hasMany
    ? Array.isArray(value)
      ? (value as RelationEnvelope[])
      : []
    : value
      ? [value as RelationEnvelope]
      : []

  const labels = envelopes
    .map((env) => labelFor(env, displayField))
    .filter((l): l is string => l != null && l.length > 0)

  if (labels.length === 0) return null
  if (!field.hasMany) return labels[0] ?? null

  const shown = labels.slice(0, MAX_SHOWN)
  const extra = labels.length - shown.length
  return extra > 0 ? `${shown.join(', ')}, +${extra} more` : shown.join(', ')
}

/**
 * The built-in `{ component }` column formatter for a `relation` field. Resolves
 * the target collection's `useAsTitle` at render time and renders the cell text.
 */
export function relationColumnFormatter(field: RelationField): ColumnFormatter {
  return {
    component: ({ value }) => {
      const targetDef = getCollectionDefinition(field.targetCollection)
      const displayField =
        field.displayField ?? targetDef?.useAsTitle ?? resolveFallbackDisplayField(targetDef)
      const text = formatRelationCellText(field, value, displayField)
      return text != null ? (
        <span className="byline-relation-column">{text}</span>
      ) : (
        <span className="byline-relation-column-empty muted">—</span>
      )
    },
  }
}

/**
 * Return a copy of `columns` with {@link relationColumnFormatter} applied to any
 * `relation`-typed column that doesn't already declare its own formatter, so
 * relation cells render target titles by default. Other columns are untouched.
 */
export function applyRelationColumnFormatters(
  columns: ColumnDefinition[],
  definition: CollectionDefinition
): ColumnDefinition[] {
  return columns.map((col) => {
    if (col.formatter) return col
    const field = definition.fields.find((f) => f.name === String(col.fieldName))
    if (field?.type === 'relation') {
      return { ...col, formatter: relationColumnFormatter(field as RelationField) }
    }
    return col
  })
}
