/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type CollectionDefinition,
  type CounterField,
  type Field,
  type FieldSet,
  isArrayField,
  isBlocksField,
  isGroupField,
} from '../@types/index.js'
import type { IDbAdapter } from '../@types/db-types.js'
import type { BylineLogger } from '../lib/logger.js'

/**
 * One counter-field site discovered during walk. Carries the source
 * collection and dotted field path so error messages can point at the
 * exact location.
 */
interface CounterFieldSite {
  collectionPath: string
  fieldPath: string
  field: CounterField
}

/**
 * Walk a collection's field tree and yield every `counter` field site.
 *
 * Banned locations are thrown immediately (not yielded): a `counter`
 * inside an `array` or `blocks` structure would mean a single document
 * carries multiple counter values, which collapses the "one ID per
 * term" assumption that makes URLs like `?t=1&t=4&t=9` meaningful.
 *
 * Counters inside a `group` are allowed — groups don't repeat, so
 * there's still exactly one counter value per document.
 */
function* findCounterFields(
  fields: FieldSet,
  collectionPath: string,
  pathPrefix = '',
  insideRepeating: { kind: 'array' | 'blocks'; fieldPath: string } | null = null
): Generator<CounterFieldSite> {
  for (const field of fields) {
    const fieldPath = pathPrefix === '' ? field.name : `${pathPrefix}.${field.name}`

    if (field.type === 'counter') {
      if (insideRepeating !== null) {
        throw new Error(
          `discoverCounterGroups: counter field '${fieldPath}' in collection ` +
            `'${collectionPath}' is nested inside a ${insideRepeating.kind} field ` +
            `('${insideRepeating.fieldPath}'). Counter fields produce a single ` +
            `allocator-assigned value per document and cannot live inside ` +
            `repeating structure — move the field to the collection root or ` +
            `into a non-repeating group.`
        )
      }
      yield { collectionPath, fieldPath, field }
      continue
    }

    if (isGroupField(field)) {
      yield* findCounterFields(field.fields, collectionPath, fieldPath, insideRepeating)
      continue
    }

    if (isArrayField(field)) {
      yield* findCounterFields(field.fields, collectionPath, fieldPath, {
        kind: 'array',
        fieldPath,
      })
      continue
    }

    if (isBlocksField(field)) {
      for (const block of field.blocks) {
        yield* findCounterFields(block.fields, collectionPath, `${fieldPath}.${block.blockType}`, {
          kind: 'blocks',
          fieldPath,
        })
      }
      continue
    }
    // Other value fields produce no counter sites; nothing to recurse into.
    void (field satisfies Field)
  }
}

export interface DiscoverCounterGroupsInput {
  definitions: readonly CollectionDefinition[]
  db: IDbAdapter
  logger?: BylineLogger
}

/**
 * Discover every distinct counter `group` declared across the provided
 * collections and ensure each one is registered with the database
 * adapter (creating its backing sequence as needed). Called once at
 * startup from `initBylineCore()`, after `ensureCollections`.
 *
 * Returns a `Map<groupName, sequenceName>` of the registered groups,
 * suitable for caching on the core instance if downstream callers ever
 * need to inspect the resolved sequence names without round-tripping.
 *
 * Throws on:
 *   - a counter field nested inside `array` or `blocks` (see
 *     {@link findCounterFields} — structural ban)
 *   - any `ensureCounterGroup` failure (treated as a fatal config error)
 */
export async function discoverCounterGroups({
  definitions,
  db,
  logger,
}: DiscoverCounterGroupsInput): Promise<Map<string, string>> {
  // Aggregate distinct group names across all collections. We track the
  // first site we saw each group at so the log line can point a human
  // at where the group was declared.
  const groupSites = new Map<string, CounterFieldSite>()
  for (const definition of definitions) {
    for (const site of findCounterFields(definition.fields, definition.path)) {
      if (!groupSites.has(site.field.group)) {
        groupSites.set(site.field.group, site)
      }
    }
  }

  if (groupSites.size === 0) {
    return new Map()
  }

  // Reconcile each group concurrently — sequences are independent so
  // there's no ordering constraint, and ensureCounterGroup is idempotent
  // and safe under concurrent calls (CREATE SEQUENCE IF NOT EXISTS +
  // ON CONFLICT DO NOTHING).
  const results = await Promise.all(
    Array.from(groupSites.entries()).map(async ([groupName, site]) => {
      const { sequenceName } = await db.commands.counters.ensureCounterGroup(groupName)
      logger?.debug(
        {
          counterGroup: groupName,
          sequenceName,
          firstSeenIn: `${site.collectionPath}.${site.fieldPath}`,
        },
        'counter group registered'
      )
      return [groupName, sequenceName] as const
    })
  )

  const registered = new Map(results)
  logger?.info({ counterGroupCount: registered.size }, 'counter groups reconciled')
  return registered
}
