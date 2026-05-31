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
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set(['path', 'availableLocales'])

/**
 * Per-reserved-name hint pointing the user at the collection-level directive
 * that replaces declaring the name as a field.
 */
const RESERVED_FIELD_HINTS: Readonly<Record<string, string>> = {
  path: "Use `useAsPath: '<sourceField>'` on the collection definition instead.",
  availableLocales: 'Use `advertiseLocales: true` on the collection definition instead.',
}

const USE_AS_PATH_SOURCE_TYPES = new Set<FieldType>([
  'text',
  'textArea',
  'select',
  'date',
  'datetime',
  'time',
])

/**
 * True when any field in the tree (at any nesting depth) is `localized`.
 * Used to gate `advertiseLocales` — advertising content locales is only
 * meaningful when the collection has locale-varying content.
 */
function hasLocalizedField(fields: readonly Field[]): boolean {
  let found = false
  walkFields(fields, (field) => {
    if ('localized' in field && field.localized === true) {
      found = true
    }
  })
  return found
}

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
 *  - No field may be named `availableLocales`; collections opt into the
 *    editorial available-locales control via `advertiseLocales: true`.
 *  - When `advertiseLocales` is `true`, the collection must have at least
 *    one `localized` field — advertising content locales is meaningless
 *    otherwise.
 *
 * Throws a plain `Error` (not a `BylineError`) because configuration
 * validation runs at startup, before the logger and error registry are
 * necessarily wired up.
 */
export function validateCollections(collections: readonly CollectionDefinition[]): void {
  for (const collection of collections) {
    walkFields(collection.fields, (field) => {
      if ('name' in field && RESERVED_FIELD_NAMES.has(field.name)) {
        const hint = RESERVED_FIELD_HINTS[field.name] ?? ''
        throw new Error(
          `Collection "${collection.path}" declares a field named "${field.name}", which is a reserved system attribute.${hint ? ` ${hint}` : ''}`
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

    if (collection.advertiseLocales === true && !hasLocalizedField(collection.fields)) {
      throw new Error(
        `Collection "${collection.path}" sets \`advertiseLocales: true\` but has no localized fields. The available-locales control advertises content locales, which is only meaningful when at least one field is \`localized\`.`
      )
    }
  }
}
