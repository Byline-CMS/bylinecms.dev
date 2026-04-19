/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Relation projection helpers.
 *
 * Translate a source collection's relation fields into a `PopulateMap`
 * projection that fetches just enough data from each target to render
 * a relation-summary tile on the admin edit view (picker columns,
 * `useAsTitle`, plus an optional source-side `displayField` override).
 *
 * Consumed by the admin webapp's edit-route server fn so relation tiles
 * arrive pre-hydrated on first paint — no client-side fetch per relation.
 */

import type {
  CollectionAdminConfig,
  CollectionDefinition,
  Field,
  FieldSet,
  RelationField,
} from '../@types/index.js'
import type { PopulateMap } from './populate.js'

/**
 * Union of the target-collection field names needed to render a
 * relation-summary tile for the given source relation field.
 *
 *   - `sourceField.displayField` (explicit per-relation override)
 *   - target's `useAsTitle`
 *   - target's first declared text field (safety fallback)
 *   - every `picker[].fieldName` on the target admin config that maps
 *     to a real schema field (picker columns may reference metadata
 *     like `status` or `updated_at` which ride on the document row
 *     and don't need a projection entry)
 */
export function resolveRelationProjection(
  sourceField: RelationField,
  targetDef: CollectionDefinition | null,
  targetAdmin: CollectionAdminConfig | null
): string[] {
  const out = new Set<string>()
  if (sourceField.displayField) out.add(sourceField.displayField)
  if (targetDef?.useAsTitle) out.add(targetDef.useAsTitle)
  const firstText = targetDef?.fields.find((f) => f.type === 'text')?.name
  if (firstText) out.add(firstText)
  if (targetAdmin?.picker) {
    for (const col of targetAdmin.picker) {
      const name = String(col.fieldName)
      if (targetDef?.fields.some((f) => f.name === name)) out.add(name)
    }
  }
  return Array.from(out)
}

export type RelationTargetResolver = (targetPath: string) => {
  def: CollectionDefinition | null
  admin: CollectionAdminConfig | null
}

/**
 * Walk a source collection's `FieldSet` (recursing into `group`, `array`,
 * and `blocks`), locate every `RelationField`, and produce a `PopulateMap`
 * keyed by relation field name with a `{ select }` projection suitable
 * for rendering the summary tile on the admin edit view.
 *
 * Relation field names must be unique within the source schema; if the
 * same name appears twice with different targets the first wins.
 *
 * Relations whose target is unknown fall back to `true` (default
 * projection — identity field + row metadata) so populate still attaches
 * *something* to the leaf.
 */
export function buildRelationSummaryPopulateMap(
  fields: FieldSet,
  resolve: RelationTargetResolver
): PopulateMap {
  const map: PopulateMap = {}
  walkFields(fields, map, resolve)
  return map
}

function walkFields(fields: FieldSet, map: PopulateMap, resolve: RelationTargetResolver): void {
  for (const field of fields as readonly Field[]) {
    switch (field.type) {
      case 'relation': {
        if (map[field.name] !== undefined) break
        const { def, admin } = resolve(field.targetCollection)
        const select = resolveRelationProjection(field, def, admin)
        map[field.name] = select.length > 0 ? { select } : true
        break
      }
      case 'group':
      case 'array':
        walkFields(field.fields, map, resolve)
        break
      case 'blocks':
        for (const block of field.blocks) {
          walkFields(block.fields, map, resolve)
        }
        break
      default:
        break
    }
  }
}
