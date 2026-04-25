/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionAdminConfig, CollectionDefinition } from '../@types/index.js'

/**
 * Validate every admin config in a configuration.
 *
 * Enforced rules (per admin config):
 *  1. Slug pairing — `admin.slug` matches exactly one `collection.path`.
 *  2. Placement — when `layout` is present, every top-level schema field
 *     name appears exactly once across the union of all `tabSet.tabs[].fields`,
 *     all `row.fields`, all `group.fields`, `layout.main`, and `layout.sidebar`.
 *  3. Name resolution — every string referenced in any `fields[]` array or
 *     layout region resolves to either a top-level schema field name or a
 *     declared primitive name. The literal `'path'` is explicitly rejected
 *     with a message pointing the user at `useAsPath`.
 *  4. No collisions — primitive names (across `tabSets` / `rows` / `groups`)
 *     are unique within an admin config and don't shadow schema field names.
 *  5. Nesting — `tabSets` only appear in `layout.main`; rows contain only
 *     schema field names; groups exclude tabSets and nested groups.
 *  6. `fields` map sanity — every key in `admin.fields` matches a top-level
 *     schema field name.
 *
 * Throws a plain `Error` (not a `BylineError`) because configuration
 * validation runs at startup, before the logger and error registry are
 * necessarily wired up.
 */
export function validateAdminConfigs(
  admins: readonly CollectionAdminConfig[] | undefined,
  collections: readonly CollectionDefinition[]
): void {
  if (admins == null || admins.length === 0) return

  const collectionsByPath = new Map<string, CollectionDefinition>()
  for (const collection of collections) {
    collectionsByPath.set(collection.path, collection)
  }

  for (const admin of admins) {
    validateOne(admin, collectionsByPath)
  }
}

function validateOne(
  admin: CollectionAdminConfig,
  collectionsByPath: Map<string, CollectionDefinition>
): void {
  // Rule 1 — slug pairing.
  const collection = collectionsByPath.get(admin.slug)
  if (collection == null) {
    throw new Error(
      `Admin config "${admin.slug}" has no matching collection (no collection with \`path: '${admin.slug}'\` was registered).`
    )
  }

  const slug = admin.slug
  const fail = (msg: string): never => {
    throw new Error(`Collection "${slug}": ${msg}`)
  }

  // Top-level schema field names — the population subject to placement
  // bookkeeping. Fields nested inside group/array/blocks are rendered by
  // their parent widget and are not addressable from layout.
  const topLevelFieldNames = new Set<string>()
  for (const field of collection.fields) {
    if ('name' in field) topLevelFieldNames.add(field.name)
  }

  // Build primitive lookup tables.
  const tabSets = admin.tabSets ?? []
  const rows = admin.rows ?? []
  const groups = admin.groups ?? []

  const tabSetNames = new Set<string>()
  const rowNames = new Set<string>()
  const groupNames = new Set<string>()

  // Rule 4 (collisions) — primitive names unique among themselves and
  // distinct from schema field names. Collected as we go so we can also
  // resolve names later.
  for (const set of tabSets) {
    if (tabSetNames.has(set.name)) {
      fail(`tab set name "${set.name}" is declared more than once.`)
    }
    if (topLevelFieldNames.has(set.name)) {
      fail(
        `tab set name "${set.name}" collides with a schema field of the same name. Rename the tab set.`
      )
    }
    tabSetNames.add(set.name)
  }
  for (const row of rows) {
    if (rowNames.has(row.name)) {
      fail(`row name "${row.name}" is declared more than once.`)
    }
    if (tabSetNames.has(row.name) || groupNames.has(row.name)) {
      fail(`row name "${row.name}" collides with another primitive of the same name.`)
    }
    if (topLevelFieldNames.has(row.name)) {
      fail(`row name "${row.name}" collides with a schema field of the same name. Rename the row.`)
    }
    rowNames.add(row.name)
  }
  for (const group of groups) {
    if (groupNames.has(group.name)) {
      fail(`group name "${group.name}" is declared more than once.`)
    }
    if (tabSetNames.has(group.name) || rowNames.has(group.name)) {
      fail(`group name "${group.name}" collides with another primitive of the same name.`)
    }
    if (topLevelFieldNames.has(group.name)) {
      fail(
        `group name "${group.name}" collides with a schema field of the same name. Rename the group.`
      )
    }
    groupNames.add(group.name)
  }

  // Helper: reject `'path'` references with a clear message regardless of
  // where they appear.
  const checkNotPath = (name: string, where: string): void => {
    if (name === 'path') {
      fail(
        `'path' is a system widget rendered automatically based on \`useAsPath\` and cannot be referenced from admin configs (found in ${where}). Remove the entry — the path widget already renders at the top of the sidebar when \`useAsPath\` is set.`
      )
    }
  }

  // Helper: resolve a name to one of the four kinds (or undefined).
  type Kind = 'field' | 'tabSet' | 'row' | 'group'
  const resolve = (name: string): Kind | undefined => {
    if (topLevelFieldNames.has(name)) return 'field'
    if (tabSetNames.has(name)) return 'tabSet'
    if (rowNames.has(name)) return 'row'
    if (groupNames.has(name)) return 'group'
    return undefined
  }

  // Rule 5 — nesting. Validate each primitive's contents.
  for (const set of tabSets) {
    if (set.tabs.length === 0) {
      fail(`tab set "${set.name}" declares no tabs.`)
    }
    const tabNames = new Set<string>()
    for (const tab of set.tabs) {
      if (tabNames.has(tab.name)) {
        fail(`tab set "${set.name}" declares tab "${tab.name}" more than once.`)
      }
      tabNames.add(tab.name)
      for (const name of tab.fields) {
        checkNotPath(name, `tab set "${set.name}" → tab "${tab.name}" fields`)
        const kind = resolve(name)
        if (kind == null) {
          fail(
            `tab set "${set.name}" → tab "${tab.name}" references "${name}", which is neither a top-level schema field nor a declared primitive (tabSet/row/group).`
          )
        }
        if (kind === 'tabSet') {
          fail(
            `tab set "${set.name}" → tab "${tab.name}" cannot contain tab set "${name}". Tab sets are top-level only.`
          )
        }
      }
    }
  }
  for (const row of rows) {
    if (row.fields.length === 0) {
      fail(`row "${row.name}" declares no fields.`)
    }
    for (const name of row.fields) {
      checkNotPath(name, `row "${row.name}" fields`)
      const kind = resolve(name)
      if (kind == null) {
        fail(
          `row "${row.name}" references "${name}", which is neither a top-level schema field nor a declared primitive.`
        )
      }
      if (kind !== 'field') {
        fail(`row "${row.name}" can only contain schema field names; "${name}" is a ${kind}.`)
      }
    }
  }
  for (const group of groups) {
    if (group.fields.length === 0) {
      fail(`group "${group.name}" declares no fields.`)
    }
    for (const name of group.fields) {
      checkNotPath(name, `group "${group.name}" fields`)
      const kind = resolve(name)
      if (kind == null) {
        fail(
          `group "${group.name}" references "${name}", which is neither a top-level schema field nor a declared primitive.`
        )
      }
      if (kind === 'tabSet') {
        fail(`group "${group.name}" cannot contain tab set "${name}". Tab sets are top-level only.`)
      }
      if (kind === 'group') {
        fail(`group "${group.name}" cannot contain another group ("${name}"). Groups do not nest.`)
      }
    }
  }

  // Rule 6 — `fields` map keys must match top-level schema field names.
  if (admin.fields != null) {
    for (const key of Object.keys(admin.fields)) {
      if (!topLevelFieldNames.has(key)) {
        fail(
          `\`fields["${key}"]\` references a name that is not a top-level schema field. Per-field overrides apply only to top-level schema fields.`
        )
      }
    }
  }

  // Rule 2 + 3 — layout: name resolution + bookkeeping (every schema field
  // placed exactly once). Skipped when no `layout` is declared (the
  // renderer's default-layout synthesis covers the trivial case).
  if (admin.layout == null) return

  // Validate that layout regions reference resolvable names with valid
  // kinds. Then walk into tab sets via their declared tabs to enumerate
  // every schema field actually placed somewhere.
  const placedFields = new Set<string>()

  const recordFieldPlacement = (name: string, where: string): void => {
    if (placedFields.has(name)) {
      fail(`schema field "${name}" is placed more than once (most recently in ${where}).`)
    }
    placedFields.add(name)
  }

  // Walk a `fields[]` list (from a tab, group, or layout region) and record
  // every schema field encountered. Recurses through groups and rows.
  const walkContents = (
    names: readonly string[],
    where: string,
    allow: { tabSet: boolean }
  ): void => {
    for (const name of names) {
      checkNotPath(name, where)
      const kind = resolve(name)
      if (kind == null) {
        fail(
          `${where} references "${name}", which is neither a top-level schema field nor a declared primitive.`
        )
      }
      if (kind === 'tabSet' && !allow.tabSet) {
        fail(
          `${where} cannot contain tab set "${name}". Tab sets are only allowed in \`layout.main\`.`
        )
      }

      if (kind === 'field') {
        recordFieldPlacement(name, where)
      } else if (kind === 'tabSet') {
        const set = tabSets.find((s) => s.name === name)
        if (set == null) return
        for (const tab of set.tabs) {
          walkContents(tab.fields, `tab set "${set.name}" → tab "${tab.name}"`, {
            tabSet: false,
          })
        }
      } else if (kind === 'row') {
        const row = rows.find((r) => r.name === name)
        if (row == null) return
        walkContents(row.fields, `row "${row.name}"`, { tabSet: false })
      } else if (kind === 'group') {
        const group = groups.find((g) => g.name === name)
        if (group == null) return
        walkContents(group.fields, `group "${group.name}"`, { tabSet: false })
      }
    }
  }

  walkContents(admin.layout.main, '`layout.main`', { tabSet: true })
  if (admin.layout.sidebar != null) {
    walkContents(admin.layout.sidebar, '`layout.sidebar`', { tabSet: false })
  }

  // Bookkeeping — every top-level schema field must be placed somewhere.
  for (const fieldName of topLevelFieldNames) {
    if (!placedFields.has(fieldName)) {
      fail(
        `schema field "${fieldName}" is not placed in any tab, row, group, or layout region. Add it to one of them, or remove the field from the schema.`
      )
    }
  }
}
