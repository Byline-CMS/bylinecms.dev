/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  Block,
  BlockAdminConfig,
  CollectionAdminConfig,
  CollectionDefinition,
  Field,
} from '../@types/index.js'

/**
 * Result of resolving a dotted, index-free schema path against a field set.
 */
type SchemaPathResolution = 'ok' | 'blocks' | 'unresolved'

/**
 * Resolve a dotted schema path (`faq.answer`, `files.filesGroup.publicationFile`)
 * against a field set. Schema paths address field *declarations*: every
 * segment names a field, intermediate segments must be `group` / `array`
 * structure fields, and no segment carries an item index. Returns:
 *
 *  - `'ok'`         — the path resolves to a field declaration;
 *  - `'blocks'`     — the path tries to traverse a `type: 'blocks'` field
 *                     (blocks resolve their own admin config from the
 *                     blockType-keyed registry, so this is always an error);
 *  - `'unresolved'` — a segment doesn't name a field, or a value field
 *                     appears mid-path.
 */
function resolveSchemaPath(fields: readonly Field[], path: string): SchemaPathResolution {
  const segments = path.split('.')
  let current: readonly Field[] = fields

  for (let i = 0; i < segments.length; i++) {
    const name = segments[i]
    const field = current.find((f) => 'name' in f && f.name === name)
    if (field == null) return 'unresolved'
    if (i === segments.length - 1) return 'ok'

    if (field.type === 'group' || field.type === 'array') {
      current = field.fields
    } else if (field.type === 'blocks') {
      return 'blocks'
    } else {
      return 'unresolved'
    }
  }
  return 'unresolved'
}

/**
 * Shared validation for a `fields{}` override map (collection- or block-level):
 * keys must be dotted, index-free schema paths that resolve to a field
 * declaration without traversing a `blocks` field. `subject` names the config
 * in error messages (`Collection "docs"` / `Block "faqBlock"`).
 */
function validateFieldAdminKeys(
  keys: readonly string[],
  resolve: (key: string) => SchemaPathResolution,
  fail: (msg: string) => never
): void {
  for (const key of keys) {
    if (key.includes('[')) {
      fail(
        `\`fields["${key}"]\` contains an item index. Field override keys are index-free schema paths addressing field declarations (e.g. "faq.answer"), not instance paths (e.g. "faq[0].answer").`
      )
    }
    const resolution = resolve(key)
    if (resolution === 'blocks') {
      fail(
        `\`fields["${key}"]\` traverses a \`type: 'blocks'\` field. Blocks resolve their own overrides from the blockType-keyed \`blockAdmin\` registry — register a block admin config for the inner block instead.`
      )
    }
    if (resolution === 'unresolved') {
      fail(
        `\`fields["${key}"]\` does not resolve to a field declaration. Keys are dotted, index-free schema paths whose intermediate segments are \`group\` / \`array\` fields (e.g. "faq.answer").`
      )
    }
  }
}

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
 *  6. `fields` map sanity — every key in `admin.fields` is a dotted,
 *     index-free schema path resolving to a field declaration (top-level
 *     name or a path through group/array fields; never through blocks).
 *  7. `defaultSort` sanity — `field` resolves to a top-level schema field
 *     or a document-level column (`createdAt` / `updatedAt` / `path`), the
 *     direction (when given) is `asc` | `desc`, and the option is rejected
 *     on `orderable: true` collections (manual ordering owns their default
 *     sort and the drag-to-reorder canonical-view check assumes it).
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

/**
 * Validate every block admin config in a configuration.
 *
 * Enforced rules (per `ClientConfig.blockAdmin` entry):
 *  1. Block pairing — `blockType` matches a block declared on at least one
 *     `type: 'blocks'` field across the registered collections (blocks have
 *     no global registry; the collections walk is the source of truth).
 *  2. Uniqueness — no two entries share a `blockType`.
 *  3. `fields` map sanity — every key is a dotted, index-free schema path
 *     resolving to a field declaration of the block (top-level name or a
 *     path through group/array fields; never through a nested blocks field).
 *     When the same `blockType` appears in several collections, a key is
 *     accepted if it resolves in any declaration site (union semantics).
 *
 * Throws a plain `Error` for the same reason `validateAdminConfigs` does —
 * this runs at startup, before the logger is necessarily wired up.
 */
export function validateBlockAdminConfigs(
  blockAdmins: readonly BlockAdminConfig[] | undefined,
  collections: readonly CollectionDefinition[]
): void {
  if (blockAdmins == null || blockAdmins.length === 0) return

  // Collect blockType → declaration sites across every registered collection
  // (including blocks nested inside groups/arrays/blocks). Structural drift
  // between same-blockType declarations is possible, so keys validate against
  // the union of sites.
  const blocksByType = new Map<string, Block[]>()

  const walkBlock = (block: Block): void => {
    let sites = blocksByType.get(block.blockType)
    if (sites == null) {
      sites = []
      blocksByType.set(block.blockType, sites)
    }
    sites.push(block)
    walkFields(block.fields)
  }

  const walkFields = (fields: readonly Field[]): void => {
    for (const field of fields) {
      if (field.type === 'blocks') {
        for (const block of field.blocks) walkBlock(block)
      } else if ('fields' in field && Array.isArray(field.fields)) {
        walkFields(field.fields)
      }
    }
  }

  for (const collection of collections) {
    walkFields(collection.fields)
  }

  const seen = new Set<string>()
  for (const entry of blockAdmins) {
    // Rule 2 — uniqueness.
    if (seen.has(entry.blockType)) {
      throw new Error(
        `Block admin config "${entry.blockType}" is registered more than once in \`blockAdmin\`.`
      )
    }
    seen.add(entry.blockType)

    // Rule 1 — block pairing.
    const sites = blocksByType.get(entry.blockType)
    if (sites == null) {
      throw new Error(
        `Block admin config "${entry.blockType}" has no matching block (no \`type: 'blocks'\` field of any registered collection declares a block with \`blockType: '${entry.blockType}'\`).`
      )
    }

    // Rule 3 — `fields` keys must be schema paths resolving within the block
    // (union across declaration sites). 'blocks' beats 'unresolved' in the
    // union so the traversal error surfaces when any site has the nested
    // blocks field the key tried to walk through.
    if (entry.fields != null) {
      validateFieldAdminKeys(
        Object.keys(entry.fields),
        (key) => {
          let best: SchemaPathResolution = 'unresolved'
          for (const block of sites) {
            const resolution = resolveSchemaPath(block.fields, key)
            if (resolution === 'ok') return 'ok'
            if (resolution === 'blocks') best = 'blocks'
          }
          return best
        },
        (msg: string): never => {
          throw new Error(`Block "${entry.blockType}": ${msg}`)
        }
      )
    }
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

  // Rule 7 — defaultSort / itemViewSort sanity. The list read applies these
  // specs verbatim (host list server fn → parseSort), so a bad field name
  // would silently fall back to `created_at desc` at request time — fail
  // loudly at boot instead. Both options share one rule set.
  const validateSortSpec = (
    spec: { field: unknown; direction?: unknown } | undefined,
    optionName: 'defaultSort' | 'itemViewSort'
  ): void => {
    if (spec == null) return
    const { field, direction } = spec
    const documentColumns = new Set(['createdAt', 'updatedAt', 'path'])
    if (collection.orderable === true) {
      fail(
        `${optionName} is not allowed on an orderable collection — manual ordering owns the sort (order_key asc).`
      )
    }
    if (typeof field !== 'string' || field.length === 0) {
      fail(`${optionName}.field must be a non-empty string.`)
    }
    if (!topLevelFieldNames.has(field as string) && !documentColumns.has(field as string)) {
      fail(
        `${optionName}.field "${String(field)}" is not a top-level schema field or a document column (createdAt, updatedAt, path).`
      )
    }
    if (direction != null && direction !== 'asc' && direction !== 'desc') {
      fail(`${optionName}.direction must be 'asc' or 'desc' (got "${String(direction)}").`)
    }
  }
  validateSortSpec(admin.defaultSort, 'defaultSort')
  validateSortSpec(admin.itemViewSort, 'itemViewSort')

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

  // Rule 6 — `fields` map keys must be schema paths resolving to a field
  // declaration of the collection.
  if (admin.fields != null) {
    validateFieldAdminKeys(
      Object.keys(admin.fields),
      (key) => resolveSchemaPath(collection.fields, key),
      fail
    )
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
