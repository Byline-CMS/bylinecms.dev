# Admin Dashboard Collection Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an installation arrange admin dashboard collections into labelled,
ordered groups, and stop the dashboard showing collections the signed-in
administrator cannot read.

**Architecture:** An ordered registry `AdminConfig.collectionGroups` of
`{ name, label }` is declared once; each `CollectionAdminConfig` joins a group by
key via its existing (currently dead) `group` property, boot-validated in
`validateAdminConfigs`. Two pure, React-free functions in `@byline/core` do the
work — `filterReadableCollections` drops collections the actor cannot read, then
`groupCollectionsForAdmin` buckets what remains. The dashboard component composes
them in that order, which is why a group whose members are all filtered out
simply disappears: it becomes an empty bucket, and empty buckets are skipped.

**Tech Stack:** TypeScript, React, TanStack Start / Router, Vitest (node mode),
Biome, pnpm + Turborepo.

**Spec:** `specs/2026-08-21-collection-groups-design.md` — read it before Task 1.
The plan argues from the spec; where they disagree, the spec wins except for the
one deliberate refinement noted under Deviations below.

## Global Constraints

- **Formatting is Biome, not Prettier/ESLint.** 2-space indent, single quotes,
  **no semicolons**, LF endings, 100-character line width, ES5 trailing commas.
  Run `pnpm lint` (which auto-fixes) before every commit.
- **Import ordering is enforced by Biome:** Node builtins → URLs → React →
  TanStack → packages → local, with blank lines between groups.
- **Conventional commits, and `git commit -s` every time.** The DCO
  `Signed-off-by` trailer is the **only** permitted trailer. No `Co-Authored-By`,
  no AI attribution, no other trailers. Lowercase after the colon, past tense.
- **Never name client projects, clients, or their domains** in this repository.
  Examples use neutral names (`authors`, `partners`, `taxonomy`).
- **Test files are named `*.test.node.ts`** and run under Vitest in node mode.
- **Every new `@byline/core` source file** starts with the MPL-2.0 header block
  copied verbatim from a sibling file in the same directory.
- **`@byline/core` is React-free.** Nothing in Tasks 1–3 may import React.
- Every file path below is relative to the repository root
  `/Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev`.

## Deviations from the spec

The spec's Testing section says ability filtering "is bound to React and router
context and is not reachable from core's node tests." Task 3 improves on that by
extracting the decision into a pure `filterReadableCollections` function in
`@byline/core`, which **is** node-testable. Only the wiring — reading
`is_super_admin` / `abilities` off router context — stays manual-only. This is a
strict improvement in coverage and changes no behaviour the spec describes.

---

### Task 1: Group registry types and boot validation

Adds the configuration surface and makes a malformed registry fail at startup.
No rendering yet.

**Files:**
- Modify: `packages/core/src/@types/admin-types.ts` — add
  `CollectionGroupDefinition`; restate the doc comment on
  `CollectionAdminConfig.group` (line 230-231)
- Modify: `packages/core/src/@types/site-config.ts` — add `collectionGroups` to
  `AdminConfig` (interface begins line 156); extend the `admin-types.js` import
  on line 13
- Modify: `packages/core/src/config/validate-admin-configs.ts` — add
  `validateCollectionGroups`; call it from `validateAdminConfigs` (line 105)
- Modify: `packages/core/src/config/config.ts:78` — pass the registry through
- Modify: `packages/core/src/index.ts:39-42` — export `validateCollectionGroups`
- Test: `packages/core/src/config/validate-admin-configs.test.node.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface CollectionGroupDefinition { name: string; label: string }`,
    exported from `@byline/core` via the existing `export *` barrels.
  - `AdminConfig.collectionGroups?: CollectionGroupDefinition[]`
  - `validateCollectionGroups(collectionGroups: readonly CollectionGroupDefinition[] | undefined, admins: readonly CollectionAdminConfig[] | undefined): void`
  - `validateAdminConfigs` gains an optional third parameter
    `collectionGroups?: readonly CollectionGroupDefinition[]`.

- [ ] **Step 1: Add the `CollectionGroupDefinition` type**

In `packages/core/src/@types/admin-types.ts`, immediately **above** the
`PreviewDocument` interface (search for `export interface PreviewDocument`), add:

```ts
/**
 * One labelled group of collections on the admin dashboard.
 *
 * Declared in display order on `AdminConfig.collectionGroups` and referenced by
 * `name` from `CollectionAdminConfig.group`. Array order is the order headings
 * appear on the dashboard; a group with no member collections is not rendered
 * at all, so no heading ever sits above an empty section.
 */
export interface CollectionGroupDefinition {
  /**
   * Stable key referenced by `CollectionAdminConfig.group`. Boot-validated —
   * a reference to an undeclared name throws at startup rather than silently
   * producing an extra heading.
   */
  name: string
  /**
   * Heading text rendered above this group's collections.
   *
   * A plain string, deliberately not translated: `CollectionDefinition.labels`
   * are themselves rendered untranslated on the dashboard, so translating group
   * headings alone would put a localised heading above English card titles.
   * Translated headings belong to a later, uniform collection-label i18n pass.
   */
  label: string
}
```

- [ ] **Step 2: Restate the `group` property on `CollectionAdminConfig`**

In the same file, replace these two lines (currently at 230-231):

```ts
  /** Group name for organising collections in the admin sidebar. */
  group?: string
```

with:

```ts
  /**
   * Dashboard group this collection belongs to. Must name an entry in
   * `AdminConfig.collectionGroups`; an unknown name throws at startup.
   *
   * Omit to place the collection in the leading ungrouped band, which renders
   * above the first group heading with no heading of its own.
   *
   * @see CollectionGroupDefinition
   */
  group?: string
```

The old comment referred to a sidebar that has never listed collections. The
property itself was dead — nothing read it — and is being revived here.

- [ ] **Step 3: Add `collectionGroups` to `AdminConfig`**

In `packages/core/src/@types/site-config.ts`, extend the existing import on
line 13 to include the new type:

```ts
import type {
  BlockAdminConfig,
  CollectionAdminConfig,
  CollectionGroupDefinition,
} from './admin-types.js'
```

Then, inside `interface AdminConfig extends BaseConfig`, directly after the
`admin?: CollectionAdminConfig[]` property, add:

```ts
  /**
   * Ordered registry of dashboard collection groups. Array order is display
   * order. A collection joins a group by setting `CollectionAdminConfig.group`
   * to an entry's `name`.
   *
   * Omit entirely to keep the flat, ungrouped dashboard grid — this property is
   * purely additive and changes nothing when absent.
   *
   * Boot-validated by `validateAdminConfigs`: duplicate names, blank names or
   * labels, and references to undeclared names all throw.
   *
   * @see CollectionGroupDefinition
   */
  collectionGroups?: CollectionGroupDefinition[]
```

- [ ] **Step 4: Write the failing tests**

Append to `packages/core/src/config/validate-admin-configs.test.node.ts`. Note
these go through `validateAdminConfigs` (what `defineAdminConfig` actually
calls), not the helper directly, so the wiring is covered too. The file already
declares a `collection` fixture with `path: 'news'` at the top — reuse it.

```ts
describe('validateAdminConfigs — collection groups', () => {
  const groups = [
    { name: 'media', label: 'Media' },
    { name: 'taxonomy', label: 'Taxonomies' },
  ]

  it('accepts a valid registry and a valid reference', () => {
    expect(() =>
      validateAdminConfigs([{ slug: 'news', group: 'media' }], [collection], groups)
    ).not.toThrow()
  })

  it('accepts a collection with no group when a registry is declared', () => {
    expect(() => validateAdminConfigs([{ slug: 'news' }], [collection], groups)).not.toThrow()
  })

  it('is a no-op when no registry and no group references are present', () => {
    expect(() => validateAdminConfigs([{ slug: 'news' }], [collection])).not.toThrow()
  })

  it('rejects a duplicate group name', () => {
    expect(() =>
      validateAdminConfigs(
        [{ slug: 'news' }],
        [collection],
        [
          { name: 'media', label: 'Media' },
          { name: 'media', label: 'Media Library' },
        ]
      )
    ).toThrow(/declared more than once/)
  })

  it('rejects a blank group name', () => {
    expect(() =>
      validateAdminConfigs([{ slug: 'news' }], [collection], [{ name: '  ', label: 'Media' }])
    ).toThrow(/blank `name`/)
  })

  it('rejects a blank group label', () => {
    expect(() =>
      validateAdminConfigs([{ slug: 'news' }], [collection], [{ name: 'media', label: '' }])
    ).toThrow(/blank `label`/)
  })

  it('rejects a group reference that names no declared group', () => {
    expect(() =>
      validateAdminConfigs([{ slug: 'news', group: 'medai' }], [collection], groups)
    ).toThrow(/does not name a declared collection group/)
  })

  it('names the declared groups in the unresolved-reference error', () => {
    expect(() =>
      validateAdminConfigs([{ slug: 'news', group: 'medai' }], [collection], groups)
    ).toThrow(/"media", "taxonomy"/)
  })

  it('rejects a group reference when no registry was declared at all', () => {
    expect(() => validateAdminConfigs([{ slug: 'news', group: 'media' }], [collection])).toThrow(
      /was not declared/
    )
  })

  // Registry sanity must not be skipped by the `admins` early return.
  it('validates the registry even when there are no admin configs', () => {
    expect(() =>
      validateAdminConfigs(
        [],
        [collection],
        [
          { name: 'media', label: 'Media' },
          { name: 'media', label: 'Media Library' },
        ]
      )
    ).toThrow(/declared more than once/)
  })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

```bash
cd packages/core && pnpm vitest run src/config/validate-admin-configs.test.node.ts
```

Expected: the new `describe` block fails. Most cases fail as "expected function
to throw" (validation does not exist yet); the two `not.toThrow()` cases may pass
incidentally. That is fine — the point is that the throwing cases do not throw.

- [ ] **Step 6: Implement `validateCollectionGroups`**

In `packages/core/src/config/validate-admin-configs.ts`, add
`CollectionGroupDefinition` to the existing type import from `'../@types/index.js'`,
then add this function directly **above** `export function validateAdminConfigs`:

```ts
/**
 * Validate the dashboard collection-group registry and every reference to it.
 *
 * Enforced rules:
 *  1. Each `collectionGroups` entry has a non-blank `name` and `label`.
 *  2. No two entries share a `name`.
 *  3. Every `CollectionAdminConfig.group` names a declared entry. This single
 *     rule covers both a typographical error and the case where `group` was set
 *     but the registry was never declared.
 *
 * Throws a plain `Error` for the same reason the rest of this module does —
 * configuration validation runs at startup, before the logger and error
 * registry are necessarily wired up.
 */
export function validateCollectionGroups(
  collectionGroups: readonly CollectionGroupDefinition[] | undefined,
  admins: readonly CollectionAdminConfig[] | undefined
): void {
  const declared = new Set<string>()

  for (const group of collectionGroups ?? []) {
    const name = typeof group.name === 'string' ? group.name.trim() : ''
    const label = typeof group.label === 'string' ? group.label.trim() : ''

    if (name === '') {
      throw new Error(
        'A `collectionGroups` entry has a blank `name`. Each entry needs a non-empty key for `CollectionAdminConfig.group` to reference.'
      )
    }
    if (label === '') {
      throw new Error(
        `Collection group "${name}" has a blank \`label\`. The label is the heading rendered above the group on the dashboard.`
      )
    }
    if (declared.has(name)) {
      throw new Error(
        `Collection group "${name}" is declared more than once in \`collectionGroups\`. Group names must be unique.`
      )
    }
    declared.add(name)
  }

  for (const admin of admins ?? []) {
    if (admin.group == null) continue
    if (declared.has(admin.group)) continue

    const known =
      declared.size === 0
        ? '`collectionGroups` was not declared, or is empty'
        : `declared groups: ${[...declared].map((name) => `"${name}"`).join(', ')}`

    throw new Error(
      `Collection "${admin.slug}": \`group: '${admin.group}'\` does not name a declared collection group (${known}). Add it to \`AdminConfig.collectionGroups\`, or remove the \`group\` property.`
    )
  }
}
```

- [ ] **Step 7: Call it from `validateAdminConfigs`**

Change the signature and add the call. The call goes **before** the existing
early return, so a malformed registry is caught even when no admin config
references it:

```ts
export function validateAdminConfigs(
  admins: readonly CollectionAdminConfig[] | undefined,
  collections: readonly CollectionDefinition[],
  collectionGroups?: readonly CollectionGroupDefinition[]
): void {
  // Registry sanity runs before the early return below, so a malformed registry
  // still fails fast in an installation that declares no admin configs.
  validateCollectionGroups(collectionGroups, admins)

  if (admins == null || admins.length === 0) return

  const collectionsByPath = new Map<string, CollectionDefinition>()
  for (const collection of collections) {
    collectionsByPath.set(collection.path, collection)
  }

  for (const admin of admins) {
    validateOne(admin, collectionsByPath)
  }
}
```

Also add rule 8 to that function's existing numbered doc comment, after rule 7:

```
 *  8. Collection groups — the `collectionGroups` registry is well-formed
 *     (non-blank, unique names) and every `admin.group` names a declared
 *     entry. See `validateCollectionGroups`.
```

- [ ] **Step 8: Pass the registry from `defineAdminConfig`**

In `packages/core/src/config/config.ts`, line 78, change:

```ts
  validateAdminConfigs(config.admin, config.collections)
```

to:

```ts
  validateAdminConfigs(config.admin, config.collections, config.collectionGroups)
```

- [ ] **Step 9: Export the new validator**

In `packages/core/src/index.ts`, extend the existing export block at lines 39-42:

```ts
export {
  validateAdminConfigs,
  validateBlockAdminConfigs,
  validateCollectionGroups,
} from './config/validate-admin-configs.js'
```

`CollectionGroupDefinition` needs no explicit export — `src/index.ts:18` does
`export * from './@types/index.js'`, which re-exports `admin-types.js`.

- [ ] **Step 10: Run the tests to verify they pass**

```bash
cd packages/core && pnpm vitest run src/config/validate-admin-configs.test.node.ts
```

Expected: PASS, all cases including the pre-existing ones.

- [ ] **Step 11: Typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: both clean. `pnpm lint` auto-fixes formatting; re-stage anything it
changes.

- [ ] **Step 12: Commit**

```bash
git add packages/core/src/@types/admin-types.ts \
        packages/core/src/@types/site-config.ts \
        packages/core/src/config/validate-admin-configs.ts \
        packages/core/src/config/validate-admin-configs.test.node.ts \
        packages/core/src/config/config.ts \
        packages/core/src/index.ts
git commit -s -m "feat(core): added collection group registry and boot validation"
```

---

### Task 2: `groupCollectionsForAdmin` bucketing

The pure function that turns a collection list plus a registry into ordered,
renderable buckets. Knows nothing about actors or abilities.

**Files:**
- Create: `packages/core/src/config/group-collections.ts`
- Test: `packages/core/src/config/group-collections.test.node.ts`
- Modify: `packages/core/src/index.ts` — export the function and its type

**Interfaces:**
- Consumes: `CollectionGroupDefinition` from Task 1.
- Produces:
  - `interface CollectionGroupBucket { name: string | null; label: string | null; collections: CollectionDefinition[] }`
  - `groupCollectionsForAdmin(collections: readonly CollectionDefinition[], admin: readonly CollectionAdminConfig[] | undefined, collectionGroups: readonly CollectionGroupDefinition[] | undefined): CollectionGroupBucket[]`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/config/group-collections.test.node.ts`:

```ts
/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { groupCollectionsForAdmin } from './group-collections.js'
import type { CollectionAdminConfig, CollectionDefinition } from '../@types/index.js'

const define = (path: string): CollectionDefinition => ({
  path,
  labels: { singular: path, plural: path },
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
})

const pages = define('pages')
const news = define('news')
const images = define('images')
const authors = define('authors')
const categories = define('categories')

const groups = [
  { name: 'media', label: 'Media' },
  { name: 'authorities', label: 'People & Organisations' },
  { name: 'taxonomy', label: 'Taxonomies' },
]

const admin: CollectionAdminConfig[] = [
  { slug: 'images', group: 'media' },
  { slug: 'authors', group: 'authorities' },
  { slug: 'categories', group: 'taxonomy' },
]

describe('groupCollectionsForAdmin', () => {
  it('returns one ungrouped bucket when no registry is declared', () => {
    const result = groupCollectionsForAdmin([pages, news], admin, undefined)
    expect(result).toEqual([{ name: null, label: null, collections: [pages, news] }])
  })

  it('returns one ungrouped bucket when the registry is empty', () => {
    const result = groupCollectionsForAdmin([pages, news], admin, [])
    expect(result).toEqual([{ name: null, label: null, collections: [pages, news] }])
  })

  it('emits the ungrouped band first, then groups in registry order', () => {
    const result = groupCollectionsForAdmin(
      [images, pages, categories, news, authors],
      admin,
      groups
    )
    expect(result.map((b) => b.name)).toEqual([null, 'media', 'authorities', 'taxonomy'])
  })

  it('omits the ungrouped bucket entirely when every collection is grouped', () => {
    const result = groupCollectionsForAdmin([images, authors, categories], admin, groups)
    expect(result.map((b) => b.name)).toEqual(['media', 'authorities', 'taxonomy'])
  })

  it('skips a declared group that has no member collections', () => {
    const result = groupCollectionsForAdmin([images, categories], admin, groups)
    expect(result.map((b) => b.name)).toEqual(['media', 'taxonomy'])
  })

  it('returns an empty array when there are no collections at all', () => {
    expect(groupCollectionsForAdmin([], admin, groups)).toEqual([])
  })

  it('carries each group label through to its bucket', () => {
    const result = groupCollectionsForAdmin([authors], admin, groups)
    expect(result[0]).toEqual({
      name: 'authorities',
      label: 'People & Organisations',
      collections: [authors],
    })
  })

  it('preserves collection declaration order within a bucket', () => {
    const more = define('videos')
    const result = groupCollectionsForAdmin(
      [more, images],
      [...admin, { slug: 'videos', group: 'media' }],
      groups
    )
    expect(result[0]?.collections).toEqual([more, images])
  })

  it('places a collection with no admin config in the ungrouped band', () => {
    const result = groupCollectionsForAdmin([pages, images], admin, groups)
    expect(result[0]).toEqual({ name: null, label: null, collections: [pages] })
  })

  it('treats an undeclared group name as ungrouped rather than throwing', () => {
    // Boot validation rejects this configuration, but the function stays total
    // so a renderer can never crash on a stale or hand-built config object.
    const result = groupCollectionsForAdmin([pages], [{ slug: 'pages', group: 'ghost' }], groups)
    expect(result).toEqual([{ name: null, label: null, collections: [pages] }])
  })

  it('ignores admin configs whose collection is not registered', () => {
    const result = groupCollectionsForAdmin([pages], admin, groups)
    expect(result).toEqual([{ name: null, label: null, collections: [pages] }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/core && pnpm vitest run src/config/group-collections.test.node.ts
```

Expected: FAIL — cannot resolve `./group-collections.js`.

- [ ] **Step 3: Implement the function**

Create `packages/core/src/config/group-collections.ts`:

```ts
/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  CollectionAdminConfig,
  CollectionGroupDefinition,
} from '../@types/admin-types.js'
import type { CollectionDefinition } from '../@types/collection-types.js'

/**
 * One renderable section of the admin dashboard: a heading (or none) and the
 * collections beneath it.
 */
export interface CollectionGroupBucket {
  /** Registry key, or `null` for the leading ungrouped band. */
  name: string | null
  /** Heading text, or `null` when the band renders without a heading. */
  label: string | null
  collections: CollectionDefinition[]
}

/**
 * Bucket collections into ordered dashboard sections.
 *
 * Rules:
 *  - The ungrouped band is emitted first, and omitted entirely when empty.
 *  - Declared groups follow in `collectionGroups` order.
 *  - A declared group with no members is skipped, so no heading ever appears
 *    above an empty section.
 *  - Collection declaration order is preserved within each bucket.
 *  - An absent or empty registry yields a single ungrouped bucket holding every
 *    collection — the flat grid Byline rendered before groups existed.
 *
 * This function is deliberately total: a `group` naming no declared entry is
 * treated as ungrouped rather than throwing. `validateCollectionGroups` rejects
 * that configuration at startup, so the fallback only ever covers a stale or
 * hand-built config object, where crashing the dashboard would be the worse
 * outcome.
 *
 * It takes no actor and knows nothing about abilities. Callers that need to
 * hide collections filter the `collections` argument first — see
 * `filterReadableCollections`. That ordering is what makes a group whose
 * members are all hidden disappear along with its heading: it arrives here with
 * no members and is skipped by the rule above.
 */
export function groupCollectionsForAdmin(
  collections: readonly CollectionDefinition[],
  admin: readonly CollectionAdminConfig[] | undefined,
  collectionGroups: readonly CollectionGroupDefinition[] | undefined
): CollectionGroupBucket[] {
  const groupByCollectionPath = new Map<string, string>()
  for (const entry of admin ?? []) {
    if (entry.group != null) groupByCollectionPath.set(entry.slug, entry.group)
  }

  const membersByGroup = new Map<string, CollectionDefinition[]>()
  for (const group of collectionGroups ?? []) {
    membersByGroup.set(group.name, [])
  }

  const ungrouped: CollectionDefinition[] = []
  for (const collection of collections) {
    const groupName = groupByCollectionPath.get(collection.path)
    const members = groupName == null ? undefined : membersByGroup.get(groupName)
    if (members == null) {
      ungrouped.push(collection)
      continue
    }
    members.push(collection)
  }

  const buckets: CollectionGroupBucket[] = []
  if (ungrouped.length > 0) {
    buckets.push({ name: null, label: null, collections: ungrouped })
  }
  for (const group of collectionGroups ?? []) {
    const members = membersByGroup.get(group.name) ?? []
    if (members.length === 0) continue
    buckets.push({ name: group.name, label: group.label, collections: members })
  }

  return buckets
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/core && pnpm vitest run src/config/group-collections.test.node.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Export from the package root**

In `packages/core/src/index.ts`, immediately after the
`export { resolveRoutes } from './config/routes.js'` line (line 38), add:

```ts
export {
  type CollectionGroupBucket,
  groupCollectionsForAdmin,
} from './config/group-collections.js'
```

`pnpm lint` will move it into the correct sorted position if it is wrong.

- [ ] **Step 6: Typecheck, lint, and run the full core suite**

```bash
pnpm typecheck && pnpm lint && cd packages/core && pnpm test
```

Expected: all clean, all passing.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/config/group-collections.ts \
        packages/core/src/config/group-collections.test.node.ts \
        packages/core/src/index.ts
git commit -s -m "feat(core): added groupCollectionsForAdmin dashboard bucketing"
```

---

### Task 3: `filterReadableCollections`

The pure ability filter. Extracting it from the component is what makes the
gating decision unit-testable — see Deviations above.

**Files:**
- Create: `packages/core/src/auth/filter-readable-collections.ts`
- Test: `packages/core/src/auth/filter-readable-collections.test.node.ts`
- Modify: `packages/core/src/index.ts` — export the function and its type

**Interfaces:**
- Consumes: `collectionAbilityKey` from
  `packages/core/src/auth/register-collection-abilities.js` (already exists;
  signature `collectionAbilityKey(path: string, verb: CollectionAbilityVerb): string`,
  returning `collections.<path>.<verb>`).
- Produces:
  - `interface ActorAbilitySnapshot { isSuperAdmin: boolean; abilities: readonly string[] }`
  - `filterReadableCollections(collections: readonly CollectionDefinition[], snapshot: ActorAbilitySnapshot): CollectionDefinition[]`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/auth/filter-readable-collections.test.node.ts`:

```ts
/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { filterReadableCollections } from './filter-readable-collections.js'
import type { CollectionDefinition } from '../@types/index.js'

const define = (path: string): CollectionDefinition => ({
  path,
  labels: { singular: path, plural: path },
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
})

const news = define('news')
const pages = define('pages')
const media = define('media')
const all = [news, pages, media]

describe('filterReadableCollections', () => {
  it('returns every collection for a super admin, regardless of abilities', () => {
    expect(filterReadableCollections(all, { isSuperAdmin: true, abilities: [] })).toEqual(all)
  })

  it('returns nothing when the actor holds no abilities', () => {
    expect(filterReadableCollections(all, { isSuperAdmin: false, abilities: [] })).toEqual([])
  })

  it('returns only the collections whose read ability is held', () => {
    const result = filterReadableCollections(all, {
      isSuperAdmin: false,
      abilities: ['collections.news.read', 'collections.media.read'],
    })
    expect(result).toEqual([news, media])
  })

  it('preserves declaration order', () => {
    const result = filterReadableCollections(all, {
      isSuperAdmin: false,
      abilities: ['collections.media.read', 'collections.news.read'],
    })
    expect(result.map((c) => c.path)).toEqual(['news', 'media'])
  })

  it('does not treat a non-read verb as granting visibility', () => {
    const result = filterReadableCollections(all, {
      isSuperAdmin: false,
      abilities: [
        'collections.news.create',
        'collections.news.update',
        'collections.news.publish',
        'collections.news.delete',
        'collections.news.changeStatus',
        'collections.news.reindex',
      ],
    })
    expect(result).toEqual([])
  })

  it('does not match on a prefix of a collection path', () => {
    const result = filterReadableCollections([define('news-categories')], {
      isSuperAdmin: false,
      abilities: ['collections.news.read'],
    })
    expect(result).toEqual([])
  })

  it('ignores unrelated admin abilities', () => {
    const result = filterReadableCollections(all, {
      isSuperAdmin: false,
      abilities: ['admin.users.read', 'admin.roles.read'],
    })
    expect(result).toEqual([])
  })

  it('returns a new array rather than the input', () => {
    const result = filterReadableCollections(all, { isSuperAdmin: true, abilities: [] })
    expect(result).not.toBe(all)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/core && pnpm vitest run src/auth/filter-readable-collections.test.node.ts
```

Expected: FAIL — cannot resolve `./filter-readable-collections.js`.

- [ ] **Step 3: Implement the function**

Create `packages/core/src/auth/filter-readable-collections.ts`:

```ts
/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from '../@types/collection-types.js'
import { collectionAbilityKey } from './register-collection-abilities.js'

/**
 * The ability facts a rendering surface needs about the current administrator.
 * Mirrors the snapshot the admin route places on router context in
 * `beforeLoad` — deliberately a plain data shape so this module stays
 * React-free and transport-agnostic.
 */
export interface ActorAbilitySnapshot {
  isSuperAdmin: boolean
  abilities: readonly string[]
}

/**
 * Narrow a collection list to those the administrator can read.
 *
 * `read` is the gate because everything a dashboard card offers — the link to
 * the list view, and the per-status counts — requires
 * `collections.<path>.read` and is rejected server-side without it. An
 * administrator who cannot read a collection would otherwise see a card whose
 * status tiles all read zero, which is indistinguishable from a collection that
 * is genuinely empty.
 *
 * **Cosmetic only.** This is an affordance, never a security boundary.
 * `assertActorCanPerform` remains the enforcement point on every read and write
 * path; hiding a card only stops the interface advertising something the server
 * will refuse. Never rely on this function to keep data from anyone.
 *
 * Super-admin short-circuits, mirroring `AdminAuth.assertAbility` and the
 * client-side `useAbilities` hook.
 */
export function filterReadableCollections(
  collections: readonly CollectionDefinition[],
  snapshot: ActorAbilitySnapshot
): CollectionDefinition[] {
  if (snapshot.isSuperAdmin) return [...collections]

  const held = new Set(snapshot.abilities)
  return collections.filter((collection) =>
    held.has(collectionAbilityKey(collection.path, 'read'))
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/core && pnpm vitest run src/auth/filter-readable-collections.test.node.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Export from the package root**

In `packages/core/src/index.ts`, add alongside the other auth exports (search for
`collectionAbilityKey` near line 24):

```ts
export {
  type ActorAbilitySnapshot,
  filterReadableCollections,
} from './auth/filter-readable-collections.js'
```

- [ ] **Step 6: Typecheck, lint, full core suite**

```bash
pnpm typecheck && pnpm lint && cd packages/core && pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/auth/filter-readable-collections.ts \
        packages/core/src/auth/filter-readable-collections.test.node.ts \
        packages/core/src/index.ts
git commit -s -m "feat(core): added read-ability filter for dashboard collections"
```

---

### Task 4: Render grouped buckets on the dashboard

Wires Tasks 2 into the UI. Ability gating arrives in Task 5 — keep them separate
so the grouping can be reviewed and eyeballed on its own.

**Files:**
- Modify: `packages/host-tanstack-start/src/admin-shell/chrome/dashboard.tsx`
- Modify: `packages/host-tanstack-start/src/admin-shell/chrome/dashboard.module.css`

**Interfaces:**
- Consumes: `groupCollectionsForAdmin`, `CollectionGroupBucket` from Task 2.
- Produces: no new exported surface. `AdminDashboard`'s props are unchanged
  (`{ statsMap: Record<string, CollectionStatusCount[]> }`).

There is no unit test here: `packages/host-tanstack-start` runs Vitest in **node
mode only** (`"test": "vitest run --mode=node"`) with no jsdom environment, so
React components in this package are not unit-testable. The logic worth testing
was extracted into Task 2 precisely for that reason. Verification is typecheck,
lint, and the visual check in Step 6.

- [ ] **Step 1: Extract the card into its own component**

In `dashboard.tsx`, add this component directly **above** `AdminDashboard`. The
body is lifted verbatim from the existing `.map` callback — do not redesign it:

```tsx
function CollectionCard({
  collection,
  stats,
}: {
  collection: CollectionDefinition
  stats: CollectionStatusCount[] | undefined
}) {
  const { t } = useTranslation('byline-admin')
  const total = stats?.reduce((sum, s) => sum + s.count, 0) ?? 0
  const workflowStatuses = getWorkflowStatuses(collection)

  return (
    <Card>
      <Link
        to={getAdminRoutePath('collections', '$collection')}
        params={{ collection: collection.path }}
        className={cx('byline-dashboard-card-link', styles.cardLink)}
      >
        <Card.Header>
          <div className={cx('byline-dashboard-card-header', styles.cardHeader)}>
            <Card.Title className={cx('byline-dashboard-card-title', styles.cardTitle)}>
              <span className={cx('byline-dashboard-title-text', styles.titleText)}>
                {collection.labels.plural}
              </span>
              <span className={cx('muted byline-dashboard-title-meta', styles.titleMeta)}>
                {t('dashboard.totalCount', { count: total })}
              </span>
            </Card.Title>
            <Card.Description className="muted">
              {t('dashboard.collectionDescription', { label: collection.labels.plural })}
            </Card.Description>
          </div>
        </Card.Header>
      </Link>
      <Card.Content>
        {stats !== undefined ? (
          <div className={cx('byline-dashboard-stat-grid', styles.statGrid)}>
            {workflowStatuses.map((ws) => {
              const entry = stats.find((s) => s.status === ws.name)
              return (
                <StatTile
                  key={ws.name}
                  ws={ws}
                  count={entry?.count ?? 0}
                  collectionPath={collection.path}
                />
              )
            })}
          </div>
        ) : (
          <Link
            to={getAdminRoutePath('collections', '$collection')}
            params={{ collection: collection.path }}
            className={cx('byline-dashboard-empty-link', styles.emptyLink)}
          >
            <p>{t('dashboard.collectionDescription', { label: collection.labels.plural })}</p>
          </Link>
        )}
      </Card.Content>
    </Card>
  )
}
```

- [ ] **Step 2: Update the imports**

Change the `@byline/core` import at the top of `dashboard.tsx` from:

```tsx
import type { WorkflowStatus } from '@byline/core'
import { getAdminConfig, getWorkflowStatuses } from '@byline/core'
```

to:

```tsx
import type { CollectionDefinition, WorkflowStatus } from '@byline/core'
import { getAdminConfig, getWorkflowStatuses, groupCollectionsForAdmin } from '@byline/core'
```

- [ ] **Step 3: Replace the flat map with bucketed sections**

Replace the whole body of `AdminDashboard` (currently `dashboard.tsx:65-136`,
the flat `config.collections.map(...)` inside a single grid `div`) with:

```tsx
export function AdminDashboard({ statsMap }: AdminDashboardProps) {
  const config = getAdminConfig()
  const buckets = groupCollectionsForAdmin(
    config.collections,
    config.admin,
    config.collectionGroups
  )

  return (
    <Section>
      <Container>
        {buckets.map((bucket) => (
          <section
            key={bucket.name ?? '__ungrouped__'}
            className={cx('byline-dashboard-group', styles.group)}
          >
            {bucket.label !== null && (
              <h2 className={cx('byline-dashboard-group-heading', styles.groupHeading)}>
                {bucket.label}
              </h2>
            )}
            <div className={cx('byline-dashboard-grid', styles.grid)}>
              {bucket.collections.map((collection) => (
                <CollectionCard
                  key={collection.path}
                  collection={collection}
                  stats={statsMap[collection.path]}
                />
              ))}
            </div>
          </section>
        ))}
      </Container>
    </Section>
  )
}
```

`useTranslation` moves into `CollectionCard`, so `AdminDashboard` no longer calls
it. If Biome flags the now-unused `t` binding, remove it — do not keep a dead
variable.

- [ ] **Step 4: Add the group styles**

Append to `dashboard.module.css`:

```css
/* Group sections — one per dashboard collection group, plus the leading
   ungrouped band, which renders with no heading. */

.group,
:global(.byline-dashboard-group) {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.group + .group,
:global(.byline-dashboard-group) + :global(.byline-dashboard-group) {
  margin-top: 2.5rem;
}

.groupHeading,
:global(.byline-dashboard-group-heading) {
  margin: 0;
  padding-bottom: 0.5rem;
  border-bottom: var(--border-width-thin) var(--border-style-solid) var(--gray-200);
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--gray-600);
}

:is([data-theme="dark"], :global(.dark)) .groupHeading,
:is([data-theme="dark"], :global(.dark)) :global(.byline-dashboard-group-heading) {
  border-bottom-color: var(--gray-700);
  color: var(--gray-400);
}
```

Then add the two new handles to the override list in that file's header comment,
after the `.byline-dashboard-grid` line:

```
 *   .byline-dashboard-group            — one section per group (and the
 *                                        heading-less ungrouped band)
 *   .byline-dashboard-group-heading    — the group's heading
```

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 6: Verify visually, including the server-rendered HTML**

```bash
pnpm dev
```

Open `http://localhost:5173/admin`. With no `collectionGroups` declared yet
(Task 6 adds one), the dashboard must look **exactly as it did before** — one
flat grid, no headings. That is the regression check for the default path.

Then confirm the markup is server-rendered rather than assembled on hydration:

```bash
curl -s http://localhost:5173/admin | grep -c "byline-dashboard-group"
```

Expected: a non-zero count. The dashboard sits under `_byline`, whose
`beforeLoad` registers the admin config before child loaders run, so the group
markup must be present in the initial HTML. A zero count means the SSR fallback
in `packages/core/src/config/config.ts:120-132` is being taken — stop and report
it rather than working around it.

- [ ] **Step 7: Commit**

```bash
git add packages/host-tanstack-start/src/admin-shell/chrome/dashboard.tsx \
        packages/host-tanstack-start/src/admin-shell/chrome/dashboard.module.css
git commit -s -m "feat(admin): rendered dashboard collections in labelled groups"
```

---

### Task 5: Ability gating and the empty state

**Files:**
- Modify: `packages/host-tanstack-start/src/routes/create-admin-dashboard-route.tsx`
- Modify: `packages/host-tanstack-start/src/admin-shell/chrome/dashboard.tsx`
- Modify: all eight locale files in `packages/i18n/src/admin/` — `en.json`,
  `fr.json`, `es.json`, `de.json`, `it.json`, `ko.json`, `th.json`, `zh-CN.json`

**Interfaces:**
- Consumes: `filterReadableCollections`, `ActorAbilitySnapshot` from Task 3;
  `useAbilities` from `packages/host-tanstack-start/src/integrations/abilities.tsx`
  (existing; returns `{ has, hasAny, isSuperAdmin }`).
- Produces: no new exported surface.

- [ ] **Step 1: Add the empty-state translation key to every locale**

The i18n boot validator treats a key present in one locale but missing from
another as key drift and emits a warning, so all eight files change together.
Keys are flat dotted strings at the top level of each JSON object. Add
`"dashboard.noCollections"` next to the existing `dashboard.*` keys in each file:

| File | Value |
|---|---|
| `en.json` | `You do not have access to any collections. Ask an administrator to grant you read access.` |
| `fr.json` | `Vous n'avez accès à aucune collection. Demandez à un administrateur de vous accorder un accès en lecture.` |
| `es.json` | `No tienes acceso a ninguna colección. Pide a un administrador que te conceda acceso de lectura.` |
| `de.json` | `Sie haben auf keine Sammlung Zugriff. Bitten Sie einen Administrator um Lesezugriff.` |
| `it.json` | `Non hai accesso a nessuna raccolta. Chiedi a un amministratore di concederti l'accesso in lettura.` |
| `ko.json` | `접근할 수 있는 컬렉션이 없습니다. 관리자에게 읽기 권한을 요청하세요.` |
| `th.json` | `คุณไม่มีสิทธิ์เข้าถึงคอลเลกชันใด ๆ โปรดติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์การอ่าน` |
| `zh-CN.json` | `您没有任何集合的访问权限。请联系管理员授予读取权限。` |

Each translation uses that locale's established term for "collection", matching
the existing `dashboard.collectionDescription` value in the same file
(`Collection`, `Colección`, `Sammlung`, `Raccolta`, `컬렉션`, `คอลเลกชัน`, `集合`).

The string contains no ICU placeholders, so the apostrophes in the French and
Italian values need no escaping — this matches existing entries such as
`common.actions.goToHomepage` in `fr.json`.

- [ ] **Step 2: Gate the loader so it stops fetching unreadable stats**

In `create-admin-dashboard-route.tsx`, add the import:

```ts
import { filterReadableCollections, getAdminConfig } from '@byline/core'
```

and replace the `loader` (currently lines 22-39) with:

```ts
    loader: async ({
      context,
    }: {
      context: { user: { is_super_admin: boolean; abilities: string[] } }
    }) => {
      const { collections } = getAdminConfig()

      // Only fetch counts for collections this administrator can read. Without
      // the filter, `getCollectionStats` fires for every collection and the
      // ones it cannot read throw inside `countByStatus`, get swallowed, and
      // land as an empty array — rendering every status tile as zero, which is
      // indistinguishable from a genuinely empty collection.
      const visible = filterReadableCollections(collections, {
        isSuperAdmin: context.user.is_super_admin,
        abilities: context.user.abilities,
      })

      const statsMap: Record<string, CollectionStatusCount[]> = {}

      await Promise.all(
        visible
          .filter((c) => c.showStats === true)
          .map(async (c) => {
            try {
              statsMap[c.path] = await getCollectionStats(c.path)
            } catch {
              statsMap[c.path] = []
            }
          })
      )

      return { statsMap }
    },
```

The `user` object comes from the admin layout route's `beforeLoad`, which
returns `{ user, activeLocale }` (see
`packages/host-tanstack-start/src/routes/create-admin-layout-route.tsx:50-61`).
The inline `context` type is needed because the dynamic route path bypasses
route-tree typing — the same reason the file already carries a
`biome-ignore … noExplicitAny` on `createFileRoute`.

- [ ] **Step 3: Expose the raw ability list from `useAbilities`**

`useAbilities` currently returns only predicates, but `filterReadableCollections`
takes the ability array. Extend it rather than reading router context a second
time in the component — one route-context read, one place to change.

In `packages/host-tanstack-start/src/integrations/abilities.tsx`, change the
`useAbilities` return type and body:

```tsx
export function useAbilities(): {
  has: (ability: string) => boolean
  hasAny: (abilities: readonly string[]) => boolean
  isSuperAdmin: boolean
  abilities: readonly string[]
} {
  const { user } = useAbilityRouteContext()
  const has = (ability: string): boolean => user.is_super_admin || user.abilities.includes(ability)
  const hasAny = (abilities: readonly string[]): boolean =>
    user.is_super_admin || abilities.some((key) => user.abilities.includes(key))
  return { has, hasAny, isSuperAdmin: user.is_super_admin, abilities: user.abilities }
}
```

This is additive — every existing caller destructures only what it needs.

- [ ] **Step 4: Gate the rendered cards and add the empty state**

In `dashboard.tsx`, change the `@byline/core` value import to:

```tsx
import {
  filterReadableCollections,
  getAdminConfig,
  getWorkflowStatuses,
  groupCollectionsForAdmin,
} from '@byline/core'
```

and add the abilities import alongside the other local imports:

```tsx
import { useAbilities } from '../../integrations/abilities.jsx'
```

Then replace the whole of `AdminDashboard` with:

```tsx
export function AdminDashboard({ statsMap }: AdminDashboardProps) {
  const config = getAdminConfig()
  const { t } = useTranslation('byline-admin')
  const { isSuperAdmin, abilities } = useAbilities()

  // Filter before bucketing. A group left with no readable members arrives at
  // `groupCollectionsForAdmin` empty and is skipped, so its heading disappears
  // along with it — there is no group-level ability concept anywhere.
  const visible = filterReadableCollections(config.collections, { isSuperAdmin, abilities })
  const buckets = groupCollectionsForAdmin(visible, config.admin, config.collectionGroups)

  if (buckets.length === 0) {
    return (
      <Section>
        <Container>
          <p className="muted">{t('dashboard.noCollections')}</p>
        </Container>
      </Section>
    )
  }

  return (
    <Section>
      <Container>
        {buckets.map((bucket) => (
          <section
            key={bucket.name ?? '__ungrouped__'}
            className={cx('byline-dashboard-group', styles.group)}
          >
            {bucket.label !== null && (
              <h2 className={cx('byline-dashboard-group-heading', styles.groupHeading)}>
                {bucket.label}
              </h2>
            )}
            <div className={cx('byline-dashboard-grid', styles.grid)}>
              {bucket.collections.map((collection) => (
                <CollectionCard
                  key={collection.path}
                  collection={collection}
                  stats={statsMap[collection.path]}
                />
              ))}
            </div>
          </section>
        ))}
      </Container>
    </Section>
  )
}
```

`AdminDashboard` calls `useTranslation` again here (Task 4 moved it into
`CollectionCard`) because the empty state needs `t`. That is correct — both
components call it.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 6: Verify manually with a restricted role**

This is the step the unit tests cannot cover. In the running app:

1. Sign in as a super admin. Confirm every collection card still appears.
2. Create a role at `/admin/roles` granting `collections.<path>.read` for one
   collection only, assign it to a non-super-admin user, and sign in as them.
3. Confirm: only that collection's card appears; no other card is present; the
   status tiles show real counts rather than zeros.
4. Confirm the browser network panel shows **no** failing stats request for the
   collections that are now hidden.
5. Assign a role with no collection read abilities at all and confirm the empty
   state message renders instead of a blank page.

- [ ] **Step 7: Commit**

```bash
git add packages/host-tanstack-start/src/routes/create-admin-dashboard-route.tsx \
        packages/host-tanstack-start/src/admin-shell/chrome/dashboard.tsx \
        packages/host-tanstack-start/src/integrations/abilities.tsx \
        packages/i18n/src/admin/
git commit -s -m "fix(admin): hid dashboard collections the administrator cannot read"
```

Note the `fix:` type rather than `feat:` — per the spec's Background section this
corrects misleading all-zero counts on inaccessible collections, not just a
missing affordance.

---

### Task 6: Reference app adoption and documentation

Exercises the feature in the repository's own app and documents it.

**Files:**
- Modify: `apps/webapp/byline/admin.config.ts`
- Modify: `apps/webapp/byline/collections/media/admin.ts`
- Modify: `apps/webapp/byline/collections/news-categories/admin.ts`
- Create: `docs/09-admin-ui/03-collection-groups.md`
- Modify: `docs/09-admin-ui/index.md`
- Modify: `docs/10-api-reference/01-configuration.md` (`AdminConfig` section,
  lines 121-157)

**Interfaces:**
- Consumes: everything from Tasks 1-5. Produces no new code surface.

- [ ] **Step 1: Declare a registry in the reference app**

In `apps/webapp/byline/admin.config.ts`, inside the `config` object, directly
above the existing `admin: [...]` line, add:

```ts
  // Dashboard grouping. `docs`, `news`, and `pages` deliberately declare no
  // group — they render in the leading ungrouped band above these headings,
  // which is what an installation gets while it is adopting groups gradually.
  collectionGroups: [
    { name: 'media', label: 'Media' },
    { name: 'taxonomy', label: 'Taxonomies' },
  ],
```

- [ ] **Step 2: Join the two collections to their groups**

In `apps/webapp/byline/collections/media/admin.ts`, add `group: 'media'` to the
exported admin config, immediately after its `slug` property.

In `apps/webapp/byline/collections/news-categories/admin.ts`, add
`group: 'taxonomy'` immediately after its `slug` property.

- [ ] **Step 3: Verify the reference app renders groups**

```bash
pnpm dev
```

At `http://localhost:5173/admin`, expect: Docs, News, and Pages cards first with
no heading; then a `MEDIA` heading over the Media card; then a `TAXONOMIES`
heading over the News Categories card.

Then verify the boot validator by temporarily changing `group: 'media'` to
`group: 'medai'` in the media admin config. Expect the app to fail with the
message from Task 1 naming the declared groups. Revert the typo.

- [ ] **Step 4: Write the documentation page**

Create `docs/09-admin-ui/03-collection-groups.md`. It must follow the repository
documentation standard: YAML front matter with `title`, `path`, and a
one-sentence `summary`; a single H1 whose text matches the front matter `title`
**exactly**; a `Companions:` list immediately below it. Address the reader as
"you". Name concrete actors ("Byline's admin user interface", "the server"). Use
em dashes, sentence case, and code-formatted paths.

```markdown
---
title: "Collection groups"
path: "collection-groups"
summary: "How to arrange the admin dashboard's collections into labelled, ordered groups, and how dashboard cards are filtered to the collections an administrator can read."
---

# Collection groups

Companions:
- [Configuration API](../10-api-reference/01-configuration.md) — the exact `AdminConfig` contract these options belong to.
- [Authentication and authorization](../07-auth-and-security/01-authn-authz.md) — the seven collection abilities, and where they are actually enforced.
```

The body must cover, in this order:

1. What the feature is and when you reach for it — an installation with enough
   collections that one flat grid of cards stops being readable.
2. Declaring the registry on `AdminConfig.collectionGroups`, with a runnable
   example. State that array order is display order.
3. Joining a collection to a group with `CollectionAdminConfig.group`, with a
   runnable example. State that the value is a key, not a heading.
4. The ungrouped band — collections with no `group` render first, with no
   heading, so you can adopt groups gradually.
5. That a group with no member collections renders nothing at all.
6. What boot validation rejects: duplicate names, blank names or labels, and a
   `group` naming no declared entry.
7. That group labels are plain strings and are not translated, and why —
   `CollectionDefinition.labels` are rendered untranslated too, so a localised
   heading would sit above English card titles.
8. Read-ability gating: a card appears only when you hold
   `collections.<path>.read`, a group whose members are all hidden disappears
   with them, and — stated plainly — this is a cosmetic affordance;
   `assertActorCanPerform` is the enforcement boundary.

Use neutral example names (`authors`, `partners`, `taxonomy`). Do not name any
client, project, or domain.

- [ ] **Step 5: Link the page from the section index**

In `docs/09-admin-ui/index.md`, append to the existing bullet list, matching the
established two-line wrapped style:

```markdown
- [Collection groups](./03-collection-groups.md) — arranging dashboard
  collections into labelled groups, and filtering cards to the collections an
  administrator can read.
```

- [ ] **Step 6: Update the API reference**

In `docs/10-api-reference/01-configuration.md`, in the `AdminConfig` section:

Add `collectionGroups?: CollectionGroupDefinition[]` to the interface code block
(after the `admin?:` line), add this row to the property table after the `admin`
row:

```markdown
| `collectionGroups` | `[]` | Ordered registry of dashboard collection groups. Array order is display order. Collections join a group via `CollectionAdminConfig.group`. Omit for a flat dashboard. |
```

and add the property to the worked example in that section:

```ts
  collectionGroups: [{ name: 'media', label: 'Media' }],
```

- [ ] **Step 7: Verify the documentation**

```bash
pnpm docs:check && git diff --check
```

Expected: both clean. `docs:check` runs
`pnpm --filter @byline/webapp docs:check`.

- [ ] **Step 8: Full verification before the final commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all clean, all passing. Report the actual output — if anything fails,
say so with the output rather than describing the work as complete.

- [ ] **Step 9: Commit**

```bash
git add apps/webapp/byline/admin.config.ts \
        apps/webapp/byline/collections/media/admin.ts \
        apps/webapp/byline/collections/news-categories/admin.ts \
        docs/09-admin-ui/03-collection-groups.md \
        docs/09-admin-ui/index.md \
        docs/10-api-reference/01-configuration.md
git commit -s -m "docs: documented admin dashboard collection groups"
```

---

## Release notes

Not a task, but do not lose it: the spec's Downstream impact section requires the
changeset for this work to call out the one behavioural change for existing
installations — an administrator who previously saw a card with all-zero counts
for a collection they cannot read will no longer see that card. The
configuration surface itself is purely additive and non-breaking.

## Follow-ups discovered during design

Neither is in scope, and neither is tracked yet:

- **Create-only roles are unusable.** A role holding `collections.<path>.create`
  without `.read` has no working path into a collection — the create route
  redirects into the edit view on success, and the edit view requires `read`.
  Worth a GitHub issue.
- **`CLAUDE.md` names are stale.** It refers to `defineClientConfig` and
  `ClientConfig`; the exported API is `defineAdminConfig` and `AdminConfig`
  (`packages/core/src/config/config.ts:76`). One-line correction.
