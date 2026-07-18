/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type CounterField,
  type FieldSet,
  isArrayField,
  isBlocksField,
  isGroupField,
} from '../@types/index.js'
import type { ICounterCommands } from '../@types/db-types.js'

/**
 * A counter-field site discovered during walk, paired with its
 * containing object so the caller can mutate the value in place.
 *
 * `parent[key] === field.name` at yield time; assignment is just
 * `parent[key] = newValue`.
 */
interface CounterSite {
  field: CounterField
  parent: Record<string, any>
  key: string
  /** Dotted path from the data root, e.g. `'facetId'` or `'meta.facetId'`. */
  path: string
}

/**
 * Walk a `(fields, data)` pair and yield every counter-field site,
 * descending into groups but never into arrays or blocks (which are
 * banned for counters at discovery time, see discoverCounterGroups).
 *
 * Unlike `walkFieldTree`, this walker yields counter sites *even when
 * the value is null or undefined* — that's the exact case where we
 * need to allocate a fresh value.
 *
 * A missing or non-object container for a group field is treated as
 * empty: the group is created on demand so the assigned value has
 * somewhere to land.
 */
function* walkCounterSites(
  fields: FieldSet,
  data: Record<string, any>,
  pathPrefix = ''
): Generator<CounterSite> {
  for (const field of fields) {
    const path = pathPrefix === '' ? field.name : `${pathPrefix}.${field.name}`

    if (field.type === 'counter') {
      yield { field, parent: data, key: field.name, path }
      continue
    }

    if (isGroupField(field)) {
      let container = data[field.name]
      if (container == null || typeof container !== 'object' || Array.isArray(container)) {
        // Materialise the group container so the counter site has a
        // parent to mutate. Counter fields nested in groups on
        // freshly-minted documents arrive with no group object at all.
        container = {}
        data[field.name] = container
      }
      yield* walkCounterSites(field.fields, container as Record<string, any>, path)
      continue
    }

    // arrays / blocks are banned at discovery time — they can't contain
    // counters, so we don't descend. All other value field types are
    // not our concern.
    if (isArrayField(field) || isBlocksField(field)) continue
  }
}

/**
 * Resolve a counter value already present in `previousData` at the same
 * dotted path as the site. Returns `undefined` if the value is missing or
 * not a finite number.
 *
 * `path` is a plain object accessor, **not** a field path in the sense of
 * `@byline/core` `paths/` — it walks data, never the schema, and stops at
 * any array because counters may not be declared inside `array` / `blocks`
 * (see `walkCounterSites`). It therefore needs no item selectors and no
 * block-type segments, which is why it does not use the shared grammar.
 */
function readPreviousValue(previousData: Record<string, any>, path: string): number | undefined {
  const segments = path.split('.')
  let cursor: unknown = previousData
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined
    cursor = (cursor as Record<string, any>)[segment]
  }
  return typeof cursor === 'number' && Number.isFinite(cursor) ? cursor : undefined
}

export interface AssignCounterValuesInput {
  fields: FieldSet
  /**
   * The document data being written. Mutated in place — counter sites
   * are overwritten with allocator-assigned values (on create / when
   * no previous value exists) or with the previous version's value
   * (on update). Caller-supplied counter values are NOT trusted, even
   * on create: they are always replaced by `nextCounterValue` or by
   * the previous version's value.
   */
  data: Record<string, any>
  /**
   * Reconstructed fields from the previous version (update path only).
   *
   * When provided, counter values are copied forward from here rather
   * than re-allocated — counter fields are immutable across versions
   * of the same document. If the previous version is missing a value
   * for a counter (e.g. the field was added to the collection after
   * the document was created), a new value is allocated lazily so
   * subsequent updates always see a populated counter.
   *
   * When omitted (create / duplicate / restore-as-new), every counter
   * site is freshly allocated.
   */
  previousData?: Record<string, any>
  counters: ICounterCommands
}

/**
 * Populate every counter field in `data` with its canonical value
 * before the document is flattened and persisted. Called by the
 * lifecycle layer immediately before `db.commands.documents
 * .createDocumentVersion` so the values land in `store_numeric` on
 * the same write.
 *
 * Behaviour by lifecycle path:
 *
 *   - create:   `previousData` is undefined → every counter field is
 *               freshly allocated, any caller-supplied value is
 *               overwritten.
 *
 *   - update:   `previousData` is the prior version's reconstructed
 *               fields → counter values are copied forward. Lazy
 *               backfill fires for any counter the prior version is
 *               missing (e.g. field added post-hoc).
 *
 *   - duplicate: caller strips counter values from the cloned source
 *               before invoking the create path → fresh allocation
 *               applies. (The strip itself is enforced by passing
 *               `previousData: undefined`; even if the clone retains
 *               the source's value, the create path overwrites it.)
 */
export async function assignCounterValues({
  fields,
  data,
  previousData,
  counters,
}: AssignCounterValuesInput): Promise<void> {
  const sites = Array.from(walkCounterSites(fields, data))
  if (sites.length === 0) return

  // For each site, decide what value to write and resolve any sequence
  // allocations in parallel. nextCounterValue is independent across
  // groups, so there's no ordering constraint.
  await Promise.all(
    sites.map(async (site) => {
      // Update path: try to carry forward.
      if (previousData !== undefined) {
        const carried = readPreviousValue(previousData, site.path)
        if (carried !== undefined) {
          site.parent[site.key] = carried
          return
        }
        // Lazy backfill — previous version had no value, but the
        // field is declared. Fall through to allocation so the
        // document is never left with a missing counter after an
        // update touches it.
      }

      const value = await counters.nextCounterValue(site.field.group)
      site.parent[site.key] = value
    })
  )
}
