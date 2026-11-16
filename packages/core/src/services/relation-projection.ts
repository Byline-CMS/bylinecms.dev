/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
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
 *   - every item-view column `fieldName` on the target admin config that
 *     maps to a real schema field (item-view columns may reference metadata
 *     like `status` or `updated_at` which ride on the document row and don't
 *     need a projection entry)
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
  const itemViewColumns = targetAdmin?.itemView
  if (itemViewColumns) {
    for (const col of itemViewColumns) {
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
 * Caller-supplied relation-summary projections, keyed by source relation
 * field name, each listing target field names. Serializable, so a route
 * loader can compute it where the admin config is registered and send it
 * to the server with the read.
 */
export type RelationProjections = Record<string, string[]>

/**
 * Compute the relation-summary projection for every relation field in a
 * source `FieldSet` (recursing into `group`, `array`, and `blocks`), keyed by
 * relation field name. Route loaders call this where the target admin
 * configs are registered and pass the result to the server, so the server's
 * projection does not depend on which configs its own runtime has loaded.
 */
export function buildRelationProjections(
  fields: FieldSet,
  resolve: RelationTargetResolver
): RelationProjections {
  const out: RelationProjections = {}
  forEachRelationField(fields, (field) => {
    if (out[field.name] !== undefined) return
    const { def, admin } = resolve(field.targetCollection)
    out[field.name] = resolveRelationProjection(field, def, admin)
  })
  return out
}

/**
 * Walk a source collection's `FieldSet` (recursing into `group`, `array`,
 * and `blocks`), locate every `RelationField`, and produce a `PopulateMap`
 * keyed by relation field name with a `{ select }` projection suitable
 * for rendering the summary tile on the admin edit view.
 *
 * `requested` carries caller-supplied projections (see
 * {@link buildRelationProjections}). Each requested name is kept only when it
 * names a top-level field on the relation's target schema; entries for
 * relation names the source schema does not declare are ignored. Requested
 * names are added to the projection the server resolves on its own, so a
 * server runtime without the target admin config still fetches every field
 * the summary tile renders.
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
  resolve: RelationTargetResolver,
  requested?: RelationProjections
): PopulateMap {
  const map: PopulateMap = {}
  forEachRelationField(fields, (field) => {
    if (map[field.name] !== undefined) return
    const { def, admin } = resolve(field.targetCollection)
    const select = new Set(resolveRelationProjection(field, def, admin))
    const extra =
      requested != null && Object.hasOwn(requested, field.name) ? requested[field.name] : undefined
    if (def != null && Array.isArray(extra)) {
      for (const name of extra) {
        if (typeof name === 'string' && def.fields.some((f) => f.name === name)) select.add(name)
      }
    }
    map[field.name] = select.size > 0 ? { select: Array.from(select) } : true
  })
  return map
}

function forEachRelationField(fields: FieldSet, visit: (field: RelationField) => void): void {
  for (const field of fields as readonly Field[]) {
    switch (field.type) {
      case 'relation':
        visit(field)
        break
      case 'group':
      case 'array':
        forEachRelationField(field.fields, visit)
        break
      case 'blocks':
        for (const block of field.blocks) {
          forEachRelationField(block.fields, visit)
        }
        break
      default:
        break
    }
  }
}
