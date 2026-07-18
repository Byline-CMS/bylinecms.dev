/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { formatDeclarationPath, walkFieldDeclarations } from '../paths/index.js'
import { fieldTypeToStore } from '../storage/field-store-map.js'
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

/**
 * Field types `listSearch` may name — the types persisted to the text
 * store, since the admin list-view search box is an `ILIKE` over
 * `store_text`. Derived from the canonical field→store mapping so the two
 * can't drift.
 */
const LIST_SEARCH_SOURCE_TYPES: ReadonlySet<string> = new Set(
  Object.entries(fieldTypeToStore)
    .filter(([, mapping]) => mapping?.storeType === 'text')
    .map(([type]) => type)
)

const USE_AS_PATH_SOURCE_TYPES = new Set<FieldType>([
  'text',
  'textArea',
  'select',
  'date',
  'datetime',
  'time',
  // Numeric identity fields. `derivePath` stringifies the value before
  // slugifying, so an integer or an allocator-assigned `counter` becomes a
  // clean numeric slug (e.g. `1`, `42`). A replacement slugifier can branch
  // on `collectionPath` to reshape it further — e.g. zero-padding a serial
  // number to a fixed width. `float` / `decimal` are deliberately excluded:
  // their string form carries a `.` which does not belong in a path segment.
  'integer',
  'counter',
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
 * Path-aware variant of `walkFields` — visits every field with its
 * declaration path (e.g. `files.filesGroup.generateThumbnail`) so validation
 * errors can point at the exact declaration site.
 *
 * Delegates to the shared grammar's canonical walk. It previously descended
 * into blocks without recording the block type, which made the emitted path
 * ambiguous whenever two blocks in one field declared the same field name —
 * both rendered as `content.alt`, and the message could not say which was at
 * fault. `walkFieldDeclarations` carries the block type through.
 */
function walkFieldsWithPath(
  fields: readonly Field[],
  visit: (field: Field, fieldPath: string) => void
): void {
  walkFieldDeclarations(fields, (field, segments) => {
    visit(field, formatDeclarationPath(segments))
  })
}

/**
 * Top-level field names a collection's `search` config references (body +
 * facets + filters). Used to reject `virtual` on searchable fields —
 * search indexing reads persisted values, which virtual fields never have.
 */
function searchReferencedFieldNames(collection: CollectionDefinition): Set<string> {
  const names = new Set<string>()
  const search = collection.search
  if (search == null) return names
  for (const decl of search.body ?? []) {
    names.add(typeof decl === 'string' ? decl : decl.field)
  }
  for (const decl of search.facets ?? []) {
    names.add(typeof decl === 'string' ? decl : decl.field)
  }
  for (const name of search.filters ?? []) {
    names.add(name)
  }
  return names
}

/**
 * Enforce the `virtual` field constraints for one collection. See
 * `BaseField.virtual` in field-types.ts for the contract these rules back:
 *
 *   - virtual ⇒ `optional: true` OR a `defaultValue` — the value is absent
 *     on every read, so a required virtual field could never validate on a
 *     subsequent save.
 *   - `counter` fields cannot be virtual (allocator-assigned, and the
 *     lifecycle layer must be able to carry the value forward).
 *   - Upload-capable `file` / `image` fields cannot be virtual — their
 *     stored bytes are a side effect that "not persisting" can't undo.
 *   - Fields referenced by `useAsTitle` / `useAsPath` / `search` cannot be
 *     virtual — those subsystems read persisted values.
 */
function validateVirtualFields(collection: CollectionDefinition): void {
  const searchNames = searchReferencedFieldNames(collection)

  walkFieldsWithPath(collection.fields, (field, fieldPath) => {
    if (field.virtual !== true) return

    const hasDefault = 'defaultValue' in field && field.defaultValue !== undefined
    if (field.optional !== true && !hasDefault) {
      throw new Error(
        `Collection "${collection.path}" declares virtual field "${fieldPath}" without ` +
          '`optional: true` or a `defaultValue`. Virtual values are never persisted, so the ' +
          'field is absent on every read — a required virtual field could never validate on a ' +
          'subsequent save.'
      )
    }

    if (field.type === 'counter') {
      throw new Error(
        `Collection "${collection.path}" declares virtual counter field "${fieldPath}". ` +
          'Counter values are allocator-assigned and carried forward across versions — they ' +
          'cannot be virtual.'
      )
    }

    if ((field.type === 'file' || field.type === 'image') && field.upload != null) {
      throw new Error(
        `Collection "${collection.path}" declares virtual upload field "${fieldPath}". ` +
          'Upload fields write bytes to storage as a side effect, which "not persisting" the ' +
          'field value cannot undo — remove `virtual` or the `upload` block.'
      )
    }

    // Collection-level directives read persisted values; a virtual source
    // would resolve to nothing on every read. These only apply to top-level
    // fields (nested paths never match a directive's field name).
    const isTopLevel = !fieldPath.includes('.')
    if (isTopLevel) {
      if (collection.useAsTitle === field.name) {
        throw new Error(
          `Collection "${collection.path}" sets \`useAsTitle: '${field.name}'\` but that field ` +
            'is virtual — titles are read from persisted values.'
        )
      }
      if (collection.useAsPath === field.name) {
        throw new Error(
          `Collection "${collection.path}" sets \`useAsPath: '${field.name}'\` but that field ` +
            'is virtual — paths are derived from persisted values.'
        )
      }
      if (searchNames.has(field.name)) {
        throw new Error(
          `Collection "${collection.path}" references virtual field "${field.name}" in its ` +
            '`search` config — search indexing reads persisted values, which virtual fields ' +
            'never have.'
        )
      }
    }
  })
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
 *    sensibly consume (text-like, date-like, or a numeric identity
 *    field — `integer` / `counter`).
 *  - No field may be named `availableLocales`; collections opt into the
 *    editorial available-locales control via `advertiseLocales: true`.
 *  - When `advertiseLocales` is `true`, the collection must have at least
 *    one `localized` field — advertising content locales is meaningless
 *    otherwise.
 *  - A collection may not set both `tree: true` and `orderable: true`. A
 *    document-tree owns ordering per-parent on the tree edge, so
 *    `byline_documents.order_key` is inert for it.
 *  - Each `listSearch` entry must name an existing top-level field whose
 *    type is persisted to the text store (the admin list-view search box
 *    is an `ILIKE` over `store_text`), and the field may not be virtual.
 *  - `virtual` fields must satisfy the constraints in
 *    {@link validateVirtualFields} (optional-or-default, no counters, no
 *    upload fields, not referenced by useAsTitle / useAsPath / search).
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

    for (const name of collection.listSearch ?? []) {
      const source = collection.fields.find(
        (f): f is Extract<Field, { name: string }> => 'name' in f && f.name === name
      )
      if (source == null) {
        throw new Error(
          `Collection "${collection.path}" names '${name}' in \`listSearch\` but no top-level field with that name exists.`
        )
      }
      if (!LIST_SEARCH_SOURCE_TYPES.has(source.type)) {
        throw new Error(
          `Collection "${collection.path}" names '${name}' in \`listSearch\` but field "${name}" has type "${source.type}". The list-view search box matches text-store fields only (${[...LIST_SEARCH_SOURCE_TYPES].join(', ')}).`
        )
      }
      if (source.virtual === true) {
        throw new Error(
          `Collection "${collection.path}" names virtual field '${name}' in \`listSearch\` — list-view search reads persisted values, which virtual fields never have.`
        )
      }
    }

    if (collection.advertiseLocales === true && !hasLocalizedField(collection.fields)) {
      throw new Error(
        `Collection "${collection.path}" sets \`advertiseLocales: true\` but has no localized fields. The available-locales control advertises content locales, which is only meaningful when at least one field is \`localized\`.`
      )
    }

    if (collection.tree === true && collection.orderable === true) {
      throw new Error(
        `Collection "${collection.path}" sets both \`tree: true\` and \`orderable: true\`. A document-tree collection owns ordering on the tree edge (per-parent), so \`byline_documents.order_key\` is inert — set only \`tree: true\`.`
      )
    }

    validateVirtualFields(collection)
    validateUploadLocations(collection)
  }
}

/**
 * Enforce the `upload.location` shape for every upload-capable field. The
 * value is a declarative storage-key scope handed to storage providers
 * (`<location>/<uuid>-<filename>`), so it must be a clean POSIX-style
 * segment path:
 *
 *   - non-empty string, forward slashes only;
 *   - no leading / trailing / duplicate slashes;
 *   - segments of `A–Z a–z 0–9 . _ -` only (no spaces, no backslashes);
 *   - no `.` or `..` segments (path traversal).
 */
function validateUploadLocations(collection: CollectionDefinition): void {
  walkFieldsWithPath(collection.fields, (field, fieldPath) => {
    if (field.type !== 'file' && field.type !== 'image') return
    const location = field.upload?.location
    if (location === undefined) return

    const fail = (reason: string): never => {
      throw new Error(
        `Collection "${collection.path}" field "${fieldPath}" has invalid \`upload.location\` ` +
          `${JSON.stringify(location)}: ${reason}`
      )
    }

    if (typeof location !== 'string' || location.length === 0) {
      fail('must be a non-empty string.')
    }
    if (location.startsWith('/') || location.endsWith('/')) {
      fail('must not start or end with a slash.')
    }
    const segments = location.split('/')
    for (const segment of segments) {
      if (segment.length === 0) {
        fail('must not contain duplicate slashes.')
      }
      if (segment === '.' || segment === '..') {
        fail('must not contain `.` or `..` segments.')
      }
      if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
        fail(`segment "${segment}" contains unsupported characters (allowed: A–Z a–z 0–9 . _ -).`)
      }
    }
  })
}
