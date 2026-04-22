/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, Field, FieldType } from '../@types/index.js'

/**
 * Field names that cannot be declared in a collection schema because they
 * collide with system-managed attributes on `documentVersions`. Exported
 * so storage-layer reconstruction can skip orphan rows that may exist in
 * store tables from installations whose schemas declared these names as
 * user fields before they were promoted to system attributes.
 */
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set(['path'])

const USE_AS_PATH_SOURCE_TYPES = new Set<FieldType>([
  'text',
  'textArea',
  'select',
  'date',
  'datetime',
  'time',
])

function walkFields(fields: readonly Field[], visit: (field: Field) => void): void {
  for (const field of fields) {
    visit(field)
    if (field.type === 'group' || field.type === 'array') {
      walkFields(field.fields, visit)
    } else if (field.type === 'blocks') {
      for (const block of field.blocks) {
        walkFields(block.fields, visit)
      }
    }
  }
}

/**
 * Validate every collection in a configuration.
 *
 * Enforced rules:
 *  - No field (at any nesting depth) may be named `path`. The `path`
 *    column on `documentVersions` is system-managed; collections opt
 *    into derived paths via `useAsPath`.
 *  - When `useAsPath` is set, the referenced field must exist at the
 *    top level of the collection and be of a type the slugifier can
 *    sensibly consume (text-like or date-like).
 *
 * Throws a plain `Error` (not a `BylineError`) because configuration
 * validation runs at startup, before the logger and error registry are
 * necessarily wired up.
 */
export function validateCollections(collections: readonly CollectionDefinition[]): void {
  for (const collection of collections) {
    walkFields(collection.fields, (field) => {
      if ('name' in field && RESERVED_FIELD_NAMES.has(field.name)) {
        throw new Error(
          `Collection "${collection.path}" declares a field named "${field.name}", which is a reserved system attribute. Use \`useAsPath: '<sourceField>'\` on the collection definition instead.`
        )
      }
    })

    if (collection.useAsPath != null) {
      const source = collection.fields.find(
        (f): f is Extract<Field, { name: string }> => 'name' in f && f.name === collection.useAsPath
      )
      if (source == null) {
        throw new Error(
          `Collection "${collection.path}" sets \`useAsPath: '${collection.useAsPath}'\` but no top-level field with that name exists.`
        )
      }
      if (!USE_AS_PATH_SOURCE_TYPES.has(source.type)) {
        throw new Error(
          `Collection "${collection.path}" sets \`useAsPath: '${collection.useAsPath}'\` but field "${collection.useAsPath}" has type "${source.type}". Supported source types: ${[...USE_AS_PATH_SOURCE_TYPES].join(', ')}.`
        )
      }
    }
  }
}
