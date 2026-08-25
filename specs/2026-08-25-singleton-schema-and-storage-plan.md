# Singleton Schema and Storage Implementation Plan

> **For implementers:** Work the tasks in order. Each task is an independent
> red → green → commit cycle with its own tests; do not start a task before its
> predecessor is committed. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a singleton declarable, validated, fingerprinted, and persistable — the
schema surface and the database cardinality guarantee — without yet adding any lifecycle,
client, or admin behaviour.

**Architecture:** `CollectionDefinition` becomes a discriminated union over a shared
document base, with `defineSingleton()` as authoring sugar that stamps `singleton: true`.
Singletons stay in the one existing `collections` tuple, so startup validation, fingerprinting,
hook attachment, and ability registration remain a single pipeline. Cardinality is enforced
in the database by an adapter-owned `byline_singleton_documents` mapping table, present in
both canonical adapters and pinned by the shared conformance suite.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, MySQL, Vitest, Biome, pnpm/Turborepo.

**Spec:** `specs/2026-08-25-singleton-documents-design.md` — this plan implements **Phase 1**
(“schema, storage, and types”) only.

## Global Constraints

- Biome formatting: 2-space indent, single quotes, no semicolons, 100-char line width,
  trailing commas (ES5).
- **Lint scope:** during a task, format only the files you touched:
  `pnpm exec biome check --write <paths>`. Root `pnpm lint` runs once, in final
  verification, and its diff must be inspected before committing.
- **Focused test runs:** pass the filter directly, with no `--` separator.
- Conventional commits, lowercase after the colon, past tense.
- Every commit MUST be made with `git commit -s`. The DCO `Signed-off-by` trailer is the
  ONLY permitted trailer.
- Integration tests need both test databases: run `pnpm db:init:test` (Postgres) and
  `pnpm db:init:test:mysql` (MySQL) once each, then `pnpm test:integration`. See
  `docs/12-testing.md`. Adapter conformance suites are `*.integration.test.ts` and run only
  in vitest's **integration** mode — the default `test` script (`--mode=node`) does not
  collect them.
- **Migration workflow** (repo convention): use Drizzle generate while developing, then
  hand-write the numbered SQL script under `packages/db-<engine>/sql/` at feature
  completion. Next free numbers are **`0009`** for `db-postgres` and **`0004`** for
  `db-mysql`. The ownership guard is CI-enforced — do not edit another package's SQL.

## Scope boundary

This plan ends with singletons **declarable and storable**, not yet usable. There is no
`updateSingleton`, no `SingletonHandle`, no admin route. Those are Plan 3 (spec Phase 2) and
Plan 4 (spec Phase 3).

This plan is independent of `specs/2026-08-25-form-renderer-contracts-plan.md`. That plan's
`FormAdminConfig` is consumed by the admin host in Plan 4, not here; the two can land in
either order.

## Deviations from the spec's Phase 1

Two Phase-1 bullets are deliberately not implemented here. Both are stated so a reviewer sees
a decision rather than a gap.

1. **Admin-config discriminated union (`SingletonAdminConfig`, `defineSingletonAdmin`)** moves
   to Plan 4. Its only consumer is the admin host; landing the type here would mean shipping
   presentation config that nothing reads for two plans, and it would be written against a
   route surface that does not exist yet. Nothing in Plan 3 needs it.
2. **Hook-family validation against the definition discriminant** moves to Plan 3. Singleton
   hooks (`beforeSave` / `afterSave`) are defined in that plan; validating a hook family
   before the families exist has nothing to check.

A third, smaller deviation is recorded inline in Task 3: the stored resource kind is read
from the existing `byline_collections.config` JSON rather than a new `kind` column, which
keeps this plan to exactly one new table.

---

### Task 1: Turn `CollectionDefinition` into a discriminated union

Today `CollectionDefinition` is a single interface (`collection-types.ts:1157`). Splitting it
into a union over a shared base is what lets a singleton live in the same tuple while making
collection-only options unrepresentable at the definition site.

**Files:**
- Modify: `packages/core/src/@types/collection-types.ts:1157-1390`
- Test: `packages/core/src/@types/singleton-definition.test.node.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DocumentDefinitionBase` — `path`, `fields`, `workflow?`, `version?`. **Not** `hooks`.
  - `MultiCollectionDefinition extends DocumentDefinitionBase` — `singleton?: false`,
    `labels: { singular, plural }`, plus every existing collection-only member.
  - `SingletonDefinition extends DocumentDefinitionBase` — `singleton: true`, `label: string`.
  - `CollectionDefinition = MultiCollectionDefinition | SingletonDefinition` (name preserved).
  - `defineSingleton<const S>(definition: S & SingletonDefinition): S`.
  - `isSingleton(def: CollectionDefinition): def is SingletonDefinition`.

  Tasks 2, 3, 4, and 8 all narrow via `isSingleton`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/@types/singleton-definition.test.node.ts`:

```ts
/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { defineCollection, defineSingleton, isSingleton } from './collection-types.js'

describe('defineSingleton', () => {
  it('stamps the singleton discriminant', () => {
    const def = defineSingleton({
      path: 'site-settings',
      label: 'Site settings',
      fields: [{ name: 'name', label: 'Site name', type: 'text' }],
    })
    expect(def.singleton).toBe(true)
    expect(def.path).toBe('site-settings')
  })

  it('narrows through isSingleton', () => {
    const singleton = defineSingleton({
      path: 'site-settings',
      label: 'Site settings',
      fields: [{ name: 'name', label: 'Site name', type: 'text' }],
    })
    const collection = defineCollection({
      path: 'pages',
      labels: { singular: 'Page', plural: 'Pages' },
      fields: [{ name: 'title', label: 'Title', type: 'text' }],
    })
    expect(isSingleton(singleton)).toBe(true)
    expect(isSingleton(collection)).toBe(false)
  })

  it('rejects a collection-only option at the definition site', () => {
    defineSingleton({
      path: 'site-settings',
      label: 'Site settings',
      // @ts-expect-error — `orderable` is `?: never` on SingletonDefinition.
      // The directive suppresses only the NEXT line, so it must sit here and
      // not above `defineSingleton(`. If it ever stops erroring, the union has
      // gone soft and runtime validation (Task 2) is all that is left.
      orderable: true,
      fields: [{ name: 'name', label: 'Site name', type: 'text' }],
    })
  })

  it('preserves literal path types for the generated registries', () => {
    const def = defineSingleton({
      path: 'site-settings',
      label: 'Site settings',
      fields: [{ name: 'name', label: 'Site name', type: 'text' }],
    })
    // Compile-time: `path` must stay the literal 'site-settings', not widen to
    // `string`, or Task 8's path registries collapse. `pnpm typecheck` enforces.
    const path: 'site-settings' = def.path
    expect(path).toBe('site-settings')
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm --filter @byline/core test singleton-definition`

Expected: FAIL — `defineSingleton` and `isSingleton` are not exported.

- [ ] **Step 3: Extract the shared base**

In `packages/core/src/@types/collection-types.ts`, rename the existing
`export interface CollectionDefinition {` to `interface DocumentDefinitionBase {` and move
out of it everything that is collection-only, leaving only: `path`, `fields`, `workflow`,
`version`. **Keep every member's existing JSDoc with the member** — the comment on `version`
carries contracts that are not reconstructible from its name.

`hooks` does **not** belong in the base. The existing `CollectionHooks` family is
collection-shaped (`beforeCreate`, `afterUpdate`, `beforeDelete`, tree hooks) and a singleton
supports none of it — its lifecycle is a single `beforeSave` / `afterSave` pair defined in
Plan 3. Leaving `hooks` shared would let a singleton silently accept `beforeCreate` and have
it never fire. Move `hooks` to `MultiCollectionDefinition` and declare `hooks?: never` on
`SingletonDefinition` for now; Plan 3 replaces that with `hooks?: SingletonHooks | SingletonHooksLoader`.

- [ ] **Step 4: Declare the two variants and the union**

```ts
/** A collection of many documents — Byline's original and default resource kind. */
export interface MultiCollectionDefinition extends DocumentDefinitionBase {
  /** Absent or `false` on a multi-document collection. */
  singleton?: false
  labels: { singular: string; plural: string }
  /** A multi-document collection uses `labels`, never the singleton's `label`. */
  label?: never
  hooks?: CollectionHooks | CollectionHooksLoader
  // ...every existing collection-only member, moved here verbatim with its JSDoc:
  // search, listSearch, useAsTitle, useAsPath, advertiseLocales, buildDocumentPath,
  // linksInEditor, showStats, orderable, tree
}

/**
 * A single named document slot for an installation — the resource Payload CMS
 * calls a Global. Cardinality is zero-or-one: the slot exists as soon as the
 * definition is registered, and its document is materialised by the first save.
 *
 * Collection-only options are absent by construction: there is no list to sort,
 * search, or paginate, no sibling documents to order or arrange in a tree, and
 * no public slug (`path` is internal metadata; see the design spec).
 */
export interface SingletonDefinition extends DocumentDefinitionBase {
  singleton: true
  /** Singular display label. A singleton has no plural form. */
  label: string

  // Collection-only options declared as `?: never`. Merely *omitting* them is
  // not enough: TypeScript infers an object literal's excess properties into
  // the generic parameter of `defineSingleton`, so `orderable: true` would be
  // silently absorbed and only caught later by runtime validation. Declaring
  // them `never` makes the mistake a compile error at the definition site,
  // which is what the spec means by "absent or `never`".
  labels?: never
  // Singleton lifecycle hooks arrive in Plan 3 as `beforeSave` / `afterSave`.
  // Until then this is `never` rather than the collection hook family, which
  // a singleton would accept but never fire.
  hooks?: never
  useAsTitle?: never
  useAsPath?: never
  orderable?: never
  tree?: never
  search?: never
  listSearch?: never
  advertiseLocales?: never
  showStats?: never
  linksInEditor?: never
  buildDocumentPath?: never
}

export type CollectionDefinition = MultiCollectionDefinition | SingletonDefinition
```

- [ ] **Step 5: Add the factory and the guard**

```ts
/**
 * Type-safe factory for a singleton definition. Adds the `singleton: true`
 * discriminant so authors never write it themselves, and locks in literal
 * types for `path` and field names so the generated path registries resolve
 * precisely. Mirrors `defineCollection`.
 */
export function defineSingleton<const S extends Omit<SingletonDefinition, 'singleton'>>(
  definition: S & Omit<SingletonDefinition, 'singleton'>
): S & { singleton: true } {
  return { ...definition, singleton: true }
}

/** Narrows a definition to the singleton variant. */
export function isSingleton(def: CollectionDefinition): def is SingletonDefinition {
  return def.singleton === true
}
```

Constrain `defineCollection`'s parameter to `MultiCollectionDefinition` so it cannot accept a
singleton.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @byline/core test singleton-definition && pnpm typecheck`

Expected: the new tests PASS. **Typecheck will surface every site that reads a
collection-only member off a bare `CollectionDefinition`** — that is the point of the union.
Fix each by narrowing with `isSingleton(def)` (or `def.singleton !== true`) before the access.
Do not cast, and do not add the member back to the base.

One fallout site is known in advance and is not optional:
`packages/db-postgres/src/modules/storage/storage-commands.ts:115` reads
`config.labels.singular` unconditionally when inserting the collection row, and the MySQL
adapter has the equivalent. A singleton has `label`, not `labels`, so this throws at
registration. Fix both with:

```ts
        singular: isSingleton(config) ? config.label : (config.labels.singular || path),
```

and the matching `plural` (a singleton has none — reuse `config.label`). Search both adapters
for `labels.` before declaring this task done.

- [ ] **Step 7: Run the full core suite**

Run: `pnpm --filter @byline/core test`

Expected: PASS.

- [ ] **Step 8: Format and commit**

```bash
# Stage the adapter fallout from Step 6 as well — the union and the narrowing
# it forces are one change, and splitting them leaves a non-typechecking commit.
pnpm exec biome check --write packages/core/src/@types/collection-types.ts packages/core/src/@types/singleton-definition.test.node.ts packages/db-postgres/src/modules/storage/storage-commands.ts packages/db-mysql/src/modules/storage/storage-commands.ts
git add packages/core/src/@types/collection-types.ts packages/core/src/@types/singleton-definition.test.node.ts packages/db-postgres/src packages/db-mysql/src
# Add any other file `pnpm typecheck` forced you to narrow in Step 6 — run
# `git status` and confirm nothing it flagged is left unstaged.
git commit -s -m "feat(core): made CollectionDefinition a discriminated union with defineSingleton"
```

---

### Task 2: Reject collection-only configuration on a singleton at startup

The union stops a *typed* author writing `orderable` on a singleton. Runtime validation
catches untyped JavaScript, cast values, and configuration loaded from JSON. It follows the
existing `validate-collections.ts` pattern (see the `tree`/`orderable` guard at line 341).

**Files:**
- Modify: `packages/core/src/config/validate-collections.ts`
- Test: `packages/core/src/config/validate-collections.test.node.ts` (extend)

**Interfaces:**
- Consumes: `isSingleton`, `SingletonDefinition` from Task 1.
- Produces: no new exports. `validateCollections` throws on an invalid singleton.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/config/validate-collections.test.node.ts`:

```ts
describe('validateCollections — singletons', () => {
  const singleton = (extra: Record<string, unknown>) =>
    ({
      path: 'site-settings',
      label: 'Site settings',
      singleton: true,
      fields: [{ name: 'name', label: 'Site name', type: 'text' }],
      ...extra,
    }) as any

  it('rejects orderable on a singleton', () => {
    expect(() => validateCollections([singleton({ orderable: true })])).toThrow(/orderable/)
  })

  it('rejects tree on a singleton', () => {
    expect(() => validateCollections([singleton({ tree: true })])).toThrow(/tree/)
  })

  it('rejects useAsPath on a singleton', () => {
    expect(() => validateCollections([singleton({ useAsPath: 'name' })])).toThrow(/useAsPath/)
  })

  it('rejects search configuration on a singleton', () => {
    expect(() => validateCollections([singleton({ search: { body: ['name'] } })])).toThrow(
      /search/
    )
  })

  it('rejects advertiseLocales on a singleton', () => {
    expect(() => validateCollections([singleton({ advertiseLocales: true })])).toThrow(
      /advertiseLocales/
    )
  })

  it('accepts a well-formed singleton', () => {
    expect(() => validateCollections([singleton({})])).not.toThrow()
  })

  it('rejects a relation whose target is a singleton', () => {
    const singletonTarget = singleton({})
    const referrer = {
      path: 'news',
      labels: { singular: 'Article', plural: 'News' },
      fields: [
        {
          name: 'settings',
          label: 'Settings',
          type: 'relation',
          targetCollection: 'site-settings',
        },
      ],
    } as any
    expect(() => validateCollections([singletonTarget, referrer])).toThrow(/singleton/i)
  })

  it('rejects labels on a singleton at runtime', () => {
    // The union makes this a compile error, but untyped JS and cast config
    // still reach validation.
    expect(() =>
      validateCollections([singleton({ labels: { singular: 'S', plural: 'P' } })])
    ).toThrow(/labels|label/i)
  })

  it('still applies field-level validation to a singleton', () => {
    // Upload-location validation is field-level and must not be skipped for
    // singletons — a settings singleton's hero image is exactly this case.
    expect(() =>
      validateCollections([
        singleton({
          fields: [
            {
              name: 'heroImage',
              label: 'Hero image',
              type: 'image',
              upload: { location: '/leading-slash-is-invalid' },
            },
          ],
        }),
      ])
    ).toThrow(/location/)
  })

  // Added by Step 3b — this check does not exist before this task.
  it('rejects a singleton whose path collides with a collection', () => {
    const collection = {
      path: 'site-settings',
      labels: { singular: 'Setting', plural: 'Settings' },
      fields: [{ name: 'title', label: 'Title', type: 'text' }],
    } as any
    expect(() => validateCollections([collection, singleton({})])).toThrow(/site-settings/)
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm --filter @byline/core test validate-collections`

Expected: every rejection case FAILS (nothing throws yet) — including the duplicate-path,
relation-to-singleton, and runtime-`labels` cases, none of which have an implementation. The
"accepts" case passes.

- [ ] **Step 3: Implement the guard**

Inside `validateCollections`'s per-collection loop, before the existing collection-only
checks, add:

```ts
    if (isSingleton(collection)) {
      const forbidden = [
        'labels',
        'orderable',
        'tree',
        'useAsPath',
        'useAsTitle',
        'search',
        'listSearch',
        'advertiseLocales',
        'showStats',
        'linksInEditor',
        'buildDocumentPath',
      ] as const
      for (const option of forbidden) {
        if ((collection as Record<string, unknown>)[option] !== undefined) {
          throw new Error(
            `Singleton "${collection.path}" sets \`${option}\`, which is a multi-document collection option. A singleton holds at most one document, so there is no list to sort, search, or paginate and no public slug. Remove \`${option}\`.`
          )
        }
      }
      if (typeof (collection as { label?: unknown }).label !== 'string') {
        throw new Error(
          `Singleton "${collection.path}" must declare a \`label\`. Singletons have no plural form, so they use \`label\` rather than \`labels\`.`
        )
      }
      // NO `continue` here — see below.
    }
```

**Do not `continue` after this block.** The validators that follow are a mix of
collection-only and field-level checks, and a singleton needs the field-level ones just as
much as a collection does:

| Validator | Applies to a singleton? |
|---|---|
| `validateUploadLocations` | **Yes** — a singleton's default hero/OG image is an upload-capable field, and its `upload.location` needs the same shape checks |
| `validateVirtualFields` | **Yes** — virtual-field rules are per field, independent of cardinality |
| `validateSearchFields` | No — but it is inert anyway, since `search` is already rejected above |

Skipping them would let a singleton declare a malformed `upload.location` that no other pass
catches. Instead, guard only the checks that genuinely assume `labels` or list semantics,
leaving the field-level validators to run for both kinds.

- [ ] **Step 3b: Add the duplicate-path check — it does not exist today**

`validateCollections` has **no** duplicate-path validation. (Searching for "duplicate" in that
file finds only upload-location slash rules.) Registering two definitions on the same path
currently produces two `byline_collections` rows and undefined resolution. The spec requires
rejecting it across the combined namespace, and singletons sharing the tuple make it reachable
in a new way, so add it here — before the per-collection loop:

```ts
  const seenPaths = new Set<string>()
  for (const collection of collections) {
    if (seenPaths.has(collection.path)) {
      throw new Error(
        `Two definitions are registered on path "${collection.path}". Collections and singletons share one path namespace, so a collection and a singleton cannot both be called "${collection.path}".`
      )
    }
    seenPaths.add(collection.path)
  }
```

- [ ] **Step 3c: Reject a relation whose only target is a singleton**

A singleton is not a relation target in this release (spec non-goals). Nothing rejects it
today, so a `relation` field pointing at a singleton path would fail opaquely at populate
time. Walk each definition's fields (use `walkFieldDeclarations` from
`packages/core/src/paths/`) and throw when a `relation` field's `targetCollection` resolves to
a definition with `singleton === true`:

```ts
      throw new Error(
        `Field "${fieldPath}" on "${collection.path}" targets "${target.path}", which is a singleton. A singleton holds at most one document and is not a relation target in this release — reference its values directly instead.`
      )
```

- [ ] **Step 3d: Reject `labels` on a singleton at runtime**

The union makes `labels` a compile error, but untyped JavaScript and cast configuration still
reach validation. Add `labels` to the forbidden-option list in Step 3 so the runtime message
is as clear as the type error: a singleton has no plural form and uses `label`.

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm --filter @byline/core test validate-collections`

Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
pnpm exec biome check --write packages/core/src/config/validate-collections.ts packages/core/src/config/validate-collections.test.node.ts
git add packages/core/src/config/validate-collections.ts packages/core/src/config/validate-collections.test.node.ts
git commit -s -m "feat(core): rejected multi-collection options on singleton definitions"
```

---

### Task 3: Fingerprint the resource kind and reject kind changes

`canonicalCollection` (`collection-fingerprint.ts:169`) builds the hash that drives schema
versioning. Kind must participate, so that flipping a path between collection and singleton
is detected rather than silently accepted.

`reconcileCollection` (`collection-bootstrap.ts`) then rejects the change outright. It does
**not** need a new `kind` column: `byline_collections.config` is `jsonb NOT NULL` and already
stores the whole definition, so the stored kind is `existing.config.singleton === true`. This
is a deliberate simplification of the spec's "the stored registration must record
`kind: 'singleton'`" — the requirement is satisfied by the existing config column, and
avoiding a migration here keeps Task 5/6 to one new table.

**Files:**
- Modify: `packages/core/src/storage/collection-fingerprint.ts:169-179`
- Modify: `packages/core/src/services/collection-bootstrap.ts` (`reconcileCollection`)
- Test: `packages/core/src/storage/collection-fingerprint.test.node.ts` (extend)
- Test: `packages/core/src/services/collection-bootstrap.test.node.ts` (extend)

**Interfaces:**
- Consumes: `isSingleton` from Task 1.
- Produces: no new exports. Fingerprints differ by kind; bootstrap throws on a kind change.

- [ ] **Step 1: Write the failing fingerprint test**

Append to `packages/core/src/storage/collection-fingerprint.test.node.ts`:

```ts
it('distinguishes a singleton from a collection with the same shape', async () => {
  const fields = [{ name: 'name', label: 'Site name', type: 'text' }] as any
  const asCollection = await fingerprintCollection({
    path: 'site-settings',
    labels: { singular: 'Setting', plural: 'Settings' },
    fields,
  } as any)
  const asSingleton = await fingerprintCollection({
    path: 'site-settings',
    label: 'Site settings',
    singleton: true,
    fields,
  } as any)
  expect(asSingleton).not.toBe(asCollection)
})
```

- [ ] **Step 2: Write the failing bootstrap test**

This file has **no** `makeFakeDb` helper. It builds a full `IDbAdapter` literal inline, with
`vi.fn(fail)` for every method the test must not reach and real implementations only for the
ones it does. Follow that shape exactly — copy the existing adapter literal from the nearest
test in the file and change only `getCollectionByPath`:

```ts
it('rejects changing a registered path from collection to singleton', async () => {
  const getCollectionByPath = vi.fn(async () => ({
    id: 'col-1',
    path: 'site-settings',
    version: 1,
    schema_hash: 'stale',
    // The stored kind lives here — `config` is `jsonb NOT NULL` and holds the
    // whole definition, so no `kind` column is needed.
    config: { path: 'site-settings', fields: [] },
  }))

  // ...build the same `db` literal the neighbouring tests use, substituting
  // this `getCollectionByPath` and leaving `commands.collections.create` and
  // `.update` as `vi.fn(fail)` — reaching either would mean the kind guard
  // did not fire.

  await expect(
    ensureCollections({
      definitions: [
        {
          path: 'site-settings',
          label: 'Site settings',
          singleton: true,
          fields: [{ name: 'name', label: 'Site name', type: 'text' }],
        } as any,
      ],
      db,
    })
  ).rejects.toThrow(/kind/i)
})
```

Leaving `create`/`update` as `fail` is the load-bearing part: it proves the guard rejects
*before* any write, rather than after a partial reconcile.

**Add the mirror case too.** The guard is symmetric and must be tested in both directions —
a singleton demoted to a collection is just as much a data migration as the reverse, and a
one-sided `if` would pass a single-direction test:

```ts
it('rejects changing a registered path from singleton to collection', async () => {
  const getCollectionByPath = vi.fn(async () => ({
    id: 'col-1',
    path: 'site-settings',
    version: 1,
    schema_hash: 'stale',
    config: { path: 'site-settings', singleton: true, fields: [] },
  }))
  // ...same adapter literal...
  await expect(
    ensureCollections({
      definitions: [
        {
          path: 'site-settings',
          labels: { singular: 'Setting', plural: 'Settings' },
          fields: [{ name: 'title', label: 'Title', type: 'text' }],
        } as any,
      ],
      db,
    })
  ).rejects.toThrow(/kind/i)
})
```

- [ ] **Step 3: Run and verify both fail**

Run: `pnpm --filter @byline/core test collection-fingerprint` then
`pnpm --filter @byline/core test collection-bootstrap`

Expected: FAIL — identical hashes, and no kind check in bootstrap.

- [ ] **Step 4: Add kind to the fingerprint**

In `canonicalCollection` (`collection-fingerprint.ts:169`), add the discriminant. Emit it
only for singletons so every existing collection's hash is unchanged and no installation
sees a spurious version bump on upgrade:

```ts
function canonicalCollection(def: CollectionDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {
    path: def.path,
    fields: def.fields.map(canonicalField),
  }
  // Emitted only for singletons: adding an unconditional `kind` would change
  // every existing collection's hash and bump every stored schema version on
  // upgrade, for no shape change.
  if (isSingleton(def)) out.kind = 'singleton'
  if (def.workflow) out.workflow = canonicalWorkflow(def.workflow)
  if (!isSingleton(def)) {
    if (def.useAsPath !== undefined) out.useAsPath = def.useAsPath
    if (def.useAsTitle !== undefined) out.useAsTitle = def.useAsTitle
    if (def.advertiseLocales !== undefined) out.advertiseLocales = def.advertiseLocales
  }
  return out
}
```

- [ ] **Step 5: Reject the kind change in bootstrap**

In `reconcileCollection`, immediately after `existing` is fetched and found non-null:

```ts
  const storedConfig = (existing.config ?? {}) as { singleton?: boolean }
  const storedIsSingleton = storedConfig.singleton === true
  const incomingIsSingleton = isSingleton(definition)
  if (storedIsSingleton !== incomingIsSingleton) {
    throw new Error(
      `Registered schema "${definition.path}" changed kind from ` +
        `${storedIsSingleton ? 'singleton' : 'collection'} to ` +
        `${incomingIsSingleton ? 'singleton' : 'collection'}. Cardinality and supported ` +
        'operations differ between the two, so this needs an explicit data migration — ' +
        'not a schema-version bump. Register the new kind under a different path, migrate ' +
        'the documents, then retire the old one.'
    )
  }
```

- [ ] **Step 6: Run and verify both pass**

Run: `pnpm --filter @byline/core test collection-fingerprint && pnpm --filter @byline/core test collection-bootstrap`

Expected: PASS.

- [ ] **Step 7: Confirm no existing hash churned**

Run: `pnpm --filter @byline/core test`

Expected: PASS. Any pre-existing fingerprint assertion that changes value means the `kind`
key leaked into the collection path — revisit Step 4.

- [ ] **Step 8: Format and commit**

```bash
pnpm exec biome check --write packages/core/src/storage/collection-fingerprint.ts packages/core/src/storage/collection-fingerprint.test.node.ts packages/core/src/services/collection-bootstrap.ts packages/core/src/services/collection-bootstrap.test.node.ts
git add packages/core/src/storage/collection-fingerprint.ts packages/core/src/storage/collection-fingerprint.test.node.ts packages/core/src/services/collection-bootstrap.ts packages/core/src/services/collection-bootstrap.test.node.ts
git commit -s -m "feat(core): fingerprinted the resource kind and rejected kind changes at startup"
```

---

### Task 4: Declare the singleton mapping command and query interfaces

`IDbAdapter` (`db-types.ts:230`) groups `commands` and `queries` by subject. The mapping gets
its own pair so adapters implement one small, well-named surface.

**Files:**
- Modify: `packages/core/src/@types/db-types.ts`
- Test: none of its own — the contract is exercised by Task 7's conformance suite against
  both real adapters. A mock-based test here would assert only that TypeScript compiles.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ISingletonCommands` — `setMapping(collectionId, documentId): Promise<void>`,
    `clearMapping(collectionId): Promise<void>`.
  - `ISingletonQueries` — `getMappedDocumentId(collectionId): Promise<string | null>`.

  The `IDbAdapter.commands.singletons` / `queries.singletons` members are added by Task 6,
  after both adapters implement them. Plan 3's `updateSingleton` consumes all of it.

- [ ] **Step 1: Declare the interfaces**

In `packages/core/src/@types/db-types.ts`, next to `ICollectionCommands`:

```ts
/**
 * Writes to the singleton slot → document mapping
 * (`byline_singleton_documents`). The mapping is the cardinality authority: a
 * singleton's identity must not depend on a document `path` (locale-bearing and
 * re-anchorable) or on a well-known generated UUID.
 *
 * `setMapping` is called inside the same transaction as the document create it
 * accompanies, so the content version and the mapping commit together.
 */
export interface ISingletonCommands {
  /**
   * Record `documentId` as the singleton document for `collectionId`.
   * The primary key on `collection_id` makes a competing concurrent insert
   * fail rather than produce a second slot.
   */
  setMapping(collectionId: string, documentId: string): Promise<void>
  /**
   * Remove the mapping. Not part of the public singleton API — the supported
   * surface has no delete. Present for internal tooling and test cleanup.
   */
  clearMapping(collectionId: string): Promise<void>
}

/** Reads of the singleton slot → document mapping. */
export interface ISingletonQueries {
  /**
   * The mapped document id, or `null` when the slot has never been saved.
   * `null` is the normal pre-materialisation state, not an error.
   */
  getMappedDocumentId(collectionId: string): Promise<string | null>
}
```

**Do NOT add `singletons` to `IDbAdapter` in this task.** Widening the required shape here
would leave `@byline/db-postgres` and `@byline/db-mysql` failing `pnpm typecheck` across three
commits — breaking the pre-push gate, CI, and `git bisect` for anyone landing unrelated work
in between. The interfaces are declared here and *wired into `IDbAdapter` at the end of
Task 6*, once both adapters can satisfy it in the same commit. Every commit in this plan
typechecks.

- [ ] **Step 2: Verify the workspace still typechecks**

Run: `pnpm typecheck`

Expected: PASS. Nothing consumes the new interfaces yet — that is intentional.

- [ ] **Step 3: Format and commit**

```bash
pnpm exec biome check --write packages/core/src/@types/db-types.ts
git add packages/core/src/@types/db-types.ts
git commit -s -m "feat(core): added the singleton mapping command and query interfaces"
```

---

### Task 5: Implement the PostgreSQL mapping table

**Files:**
- Modify: `packages/db-postgres/src/database/schema/index.ts`
- Create: `packages/db-postgres/src/modules/storage/singletons.ts`
- Create: `packages/db-postgres/sql/0009_add-singleton-documents.sql`
- Modify: the adapter factory that assembles `commands` / `queries`
- Test: covered by Task 7's conformance suite

**Interfaces:**
- Consumes: `ISingletonCommands` / `ISingletonQueries` from Task 4.
- Produces: `SingletonCommands` and `SingletonQueries` classes, each taking the adapter's
  `DBManager`. Task 6 wires both adapters' instances into `IDbAdapter`.

- [ ] **Step 1: Add the Drizzle table and the supporting unique key**

In `packages/db-postgres/src/database/schema/index.ts`, alongside `documents`:

```ts
export const singletonDocuments = pgTable(
  'byline_singleton_documents',
  {
    collection_id: uuid('collection_id').primaryKey(),
    document_id: uuid('document_id').notNull().unique(),
  },
  (table) => [
    foreignKey({
      name: 'fk_singleton_documents_document',
      columns: [table.collection_id, table.document_id],
      foreignColumns: [documents.collection_id, documents.id],
    }).onDelete('cascade'),
  ]
)
```

The composite foreign key proves the mapped document belongs to the registered schema. It
requires a supporting unique constraint on `byline_documents (collection_id, id)`, which
does not exist today — `id` alone is the primary key. Add it to the `documents` table's
extras callback:

```ts
    unique('uq_documents_collection_id_id').on(table.collection_id, table.id),
```

- [ ] **Step 2: Write the numbered migration**

Create `packages/db-postgres/sql/0009_add-singleton-documents.sql`:

`packages/db-postgres/sql/README.md` imposes two hard requirements, and this script creates a
table so **both** apply: every script must be **idempotent**, and every script containing
`CREATE TABLE` must carry the canonical ownership guard immediately before `COMMIT`. The guard
is CI-enforced by `src/database/ownership-guard.test.node.ts`, which fails the build on a
missing `-- byline:ownership-guard` marker or reassignment block.

```sql
-- 0009_add-singleton-documents.sql
--
-- Adds the singleton slot -> document mapping that enforces zero-or-one
-- cardinality for `singleton: true` schemas, plus the supporting unique key the
-- mapping's composite ownership foreign key requires.
--
-- Not a table-only change: `byline_documents` has `id` as its sole primary key,
-- so the composite FK needs `UNIQUE (collection_id, id)` added here.

BEGIN;

-- ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS form, so guard on the
-- catalogue to keep the script re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_documents_collection_id_id'
  ) THEN
    ALTER TABLE byline_documents
      ADD CONSTRAINT uq_documents_collection_id_id UNIQUE (collection_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS byline_singleton_documents (
  collection_id uuid PRIMARY KEY,
  document_id   uuid NOT NULL UNIQUE,
  CONSTRAINT fk_singleton_documents_document
    FOREIGN KEY (collection_id, document_id)
    REFERENCES byline_documents (collection_id, id)
    ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- byline:ownership-guard
-- (copy the block VERBATIM from any existing 000N script that creates a table,
-- e.g. 0007_add-recurring-tasks.sql — it names no table, so there is nothing
-- to customise, and re-running it is a no-op once ownership is correct.)
-- ---------------------------------------------------------------------------

COMMIT;
```

Copy the guard body from an existing script rather than retyping it; the CI check compares
for the reassignment statement, not just the marker comment.

- [ ] **Step 3: Implement commands and queries**

Create `packages/db-postgres/src/modules/storage/singletons.ts`, following the module shape
of its siblings in that directory:

**These must join the ambient transaction.** Byline propagates transactions through
`AsyncLocalStorage`, and adapter modules pick that up by holding a `DBManager` and resolving
the executor *per access* — see `CollectionCommands` in
`packages/db-postgres/src/modules/storage/storage-commands.ts:102-108`. A factory that closes
over a plain connection handle would write the mapping outside `withTransaction`, and Plan 3's
whole guarantee is that the content version and the mapping commit together. Follow the class
pattern exactly:

```ts
export class SingletonCommands implements ISingletonCommands {
  constructor(private dbManager: DBManager) {}

  /**
   * The executor for this call — the ambient transaction when a
   * `withTransaction` boundary is open, otherwise the pool. Resolved per
   * access so every `this.db.*` below transparently joins an enclosing
   * transaction with no call-site change. See docs/03-architecture/03-transactions.md.
   */
  private get db(): DatabaseConnection {
    return this.dbManager.get()
  }

  async setMapping(collectionId: string, documentId: string): Promise<void> {
    await this.db
      .insert(singletonDocuments)
      .values({ collection_id: collectionId, document_id: documentId })
  }

  async clearMapping(collectionId: string): Promise<void> {
    await this.db
      .delete(singletonDocuments)
      .where(eq(singletonDocuments.collection_id, collectionId))
  }
}

export class SingletonQueries implements ISingletonQueries {
  constructor(private dbManager: DBManager) {}

  private get db(): DatabaseConnection {
    return this.dbManager.get()
  }

  async getMappedDocumentId(collectionId: string): Promise<string | null> {
    const rows = await this.db
      .select({ documentId: singletonDocuments.document_id })
      .from(singletonDocuments)
      .where(eq(singletonDocuments.collection_id, collectionId))
      .limit(1)
    return rows[0]?.documentId ?? null
  }
}
```

`setMapping` deliberately does **not** use `ON CONFLICT DO NOTHING`. A competing insert must
surface as a constraint violation so Plan 3's `updateSingleton` can detect that it lost a
first-save race, rather than silently continuing with an orphaned document.

- [ ] **Step 4: Expose them from the adapter**

Instantiate `new SingletonCommands(dbManager)` / `new SingletonQueries(dbManager)` alongside
the adapter's other command and query modules, passing the same `DBManager` instance they
receive. Do **not** add `singletons` to the `IDbAdapter`-typed object yet — the interface
member arrives in Task 6, once MySQL can satisfy it in the same commit.

- [ ] **Step 5: Generate and apply the Drizzle migration**

The repo runs two migration streams: Drizzle during development, and the hand-written
numbered script for deployed databases. Step 2 wrote the second; this writes the first.
`drizzle:migrate` alone applies nothing new — the migration has to be **generated** from the
schema change first:

```bash
cd postgres && ./postgres.sh up -d
cd - && pnpm drizzle:generate    # emits a new file under src/database/migrations
pnpm drizzle:migrate
pnpm typecheck
```

Expected: a new migration file appears under
`packages/db-postgres/src/database/migrations/` (stage it), and typecheck PASSES for the
whole workspace — Task 4 deliberately did not widen `IDbAdapter`, so nothing is broken
anywhere at this point.

- [ ] **Step 5b: Synchronize the CLI migration template**

`AGENTS.md:62` requires it outright: *"Keep `packages/cli/src/templates/migrations`
synchronized with db-postgres Drizzle migrations."* The release squash mentioned in
`packages/db-postgres/sql/README.md` happens **later** and does not license a drifting
scaffold in between —
`packages/cli/scripts/check-package-artifact.mjs:29` says so explicitly ("a development branch
may add migrations before the release squash"). Commit `24be87b6` is the worked precedent: a
feature commit that copied both adapters' generated migrations *and* their `meta/_journal.json`
into the templates.

Copy the newly generated migration into `packages/cli/src/templates/migrations/postgres/` and
update that directory's `meta/_journal.json` to match. Do not hand-format anything under
`meta/`.

- [ ] **Step 5c: Update the schema pins**

`packages/db-postgres/src/database/schema/schema-pins.test.node.ts` pins the adapter's table
and column inventory; `24be87b6` updated it in both adapters when adding a table. Add the
`byline_singleton_documents` pin and the new `byline_documents` unique key, then run
`pnpm --filter @byline/db-postgres test schema-pins`.

- [ ] **Step 6: Format and commit**

```bash
pnpm exec biome check --write packages/db-postgres/src/database/schema/index.ts packages/db-postgres/src/modules/storage/singletons.ts
git add packages/db-postgres/src/database/schema/index.ts packages/db-postgres/src/modules/storage/singletons.ts packages/db-postgres/sql/0009_add-singleton-documents.sql packages/db-postgres/src/database/migrations packages/db-postgres/src/database/schema/schema-pins.test.node.ts packages/cli/src/templates/migrations/postgres
git commit -s -m "feat(db-postgres): added the singleton document mapping table"
```

---

### Task 6: Implement the MySQL mapping table and close the adapter seam

> **Granularity note.** Tasks 6–8 are written as **contract, tests, and gates** rather than
> line-by-line edits. They touch call sites spread across six packages, and an earlier draft
> that named specific lines was wrong more often than right. Discover the sites at
> implementation time with `rg` and `pnpm typecheck` — both are precise and current, which a
> written line number is not. What is *not* negotiable is the required behaviour and the gates
> below.

**Required behaviour**

1. MySQL has a `byline_singleton_documents` table with the same shape and constraints as the
   PostgreSQL one from Task 5: `collection_id` primary key, `document_id` unique, and a
   composite foreign key `(collection_id, document_id) → byline_documents (collection_id, id)`
   with `ON DELETE CASCADE`. Columns are `char(36) CHARACTER SET ascii COLLATE ascii_bin`
   (`packages/db-mysql/src/database/schema/common.ts:22`), never `uuid`.
2. `byline_documents` gains `UNIQUE (collection_id, id)` — MySQL additionally requires an
   index on a foreign key's referenced columns, which this supplies.
3. `SingletonCommands` / `SingletonQueries` exist in `@byline/db-mysql` with the same class
   shape as Task 5: constructor takes `DBManager`, `private get db()` resolves the executor
   **per access** so calls join an ambient `withTransaction`. A captured handle is a defect,
   not a style choice.
4. `setMapping` is insert-only. A competing insert must reject, never upsert or no-op.
5. `IDbAdapter.commands.singletons` and `queries.singletons` become **required** members, and
   both adapters supply them — in this one commit, so the workspace never fails to typecheck.

**Artifacts**

- `packages/db-mysql/src/database/schema/index.ts` — table + unique key
- `packages/db-mysql/src/modules/storage/singletons.ts` — the two classes
- `packages/db-mysql/sql/0004_add-singleton-documents.sql` — hand-written upgrade script
- Generated Drizzle migration under `packages/db-mysql/src/database/migrations/`
- `packages/cli/src/templates/migrations/mysql/` — migration **and** `meta/_journal.json`,
  synchronized per `AGENTS.md:62` and precedent commit `24be87b6`
- `packages/db-mysql/src/database/schema/schema-pins.test.node.ts` — updated pins
- `packages/core/src/@types/db-types.ts` — the two required `IDbAdapter` members
- Every explicitly `IDbAdapter`-annotated test fixture — see gate 4

**Migration constraints.** `packages/db-mysql/sql/README.md` requires idempotency, and MySQL
has no `IF NOT EXISTS` form for any `ALTER TABLE` variant, so the unique key needs an explicit
`information_schema` guard (a `SET @have := (SELECT COUNT(*) FROM
information_schema.TABLE_CONSTRAINTS …)` + `PREPARE`/`EXECUTE` dance). `CREATE TABLE` takes
`IF NOT EXISTS`. MySQL DDL is non-transactional, so every statement guards itself. There is no
ownership guard in the MySQL stream — that requirement is PostgreSQL-only.

- [ ] **Step 1: Write the schema and both classes**
- [ ] **Step 2: Write the hand-written upgrade script**
- [ ] **Step 3: Generate and apply the Drizzle migration**

```bash
pnpm drizzle:generate
pnpm drizzle:migrate
```

- [ ] **Step 4: Synchronize the CLI template and schema pins**
- [ ] **Step 5: Close the seam in `IDbAdapter` and fix every typed fixture**

Widening a required member breaks every test fixture **annotated** `IDbAdapter` that builds
its object literal by hand. Find them, do not guess:

```bash
rg -l "IDbAdapter" --glob "*.test*.ts" packages
pnpm typecheck
```

`packages/core/src/services/collection-bootstrap.test.node.ts` is one known instance. Stub the
new members with `vi.fn(fail)` — never a working stub — so a test that unexpectedly reaches
the mapping fails loudly. Fixtures that are structurally typed or `as any` compile untouched;
leave them alone.

**Gates — all must pass before commit**

- [ ] `pnpm typecheck` clean across the workspace
- [ ] `pnpm test` green (this is the gate that catches missed fixtures)
- [ ] `pnpm --filter @byline/db-mysql test schema-pins` green
- [ ] The upgrade script is re-runnable: apply it twice against a scratch database and confirm
      the second run is a no-op
- [ ] `node packages/cli/scripts/check-package-artifact.mjs` passes (bundled baselines present
      for both adapters)
- [ ] `git status` shows no unstaged file that `pnpm typecheck` forced you to touch

- [ ] **Step 6: Format and commit**

```bash
pnpm exec biome check --write packages/db-mysql/src packages/core/src/@types/db-types.ts
git add packages/db-mysql/src packages/db-mysql/sql packages/core/src/@types/db-types.ts \
        packages/cli/src/templates/migrations/mysql packages/db-postgres/src
# ...plus every fixture Step 5 changed. Confirm with `git status` before committing.
git commit -s -m "feat(db-mysql): added the singleton document mapping and closed the adapter seam"
```

---

### Task 7: Pin the mapping contract in the shared conformance suite

**Required behaviour**

`@byline/db-conformance` gains a `singletonMappingSuite` that runs against **both** engines and
asserts every adapter-observable property of the mapping. The suite must cover:

1. `getMappedDocumentId` returns `null` for a registered singleton never saved — the normal
   pre-materialisation state, not an error.
2. `setMapping` then `getMappedDocumentId` round-trips the document id.
3. A second `setMapping` for the same `collection_id` **rejects**, and the original mapping
   survives. This is the cardinality guarantee and the reason `setMapping` is not an upsert.
4. Mapping the same `document_id` under a different `collection_id` rejects.
5. Mapping a document owned by a **different collection** rejects. This is the case that
   justifies the composite ownership key over a plain `document_id` reference — do not omit it.
6. `clearMapping` removes the mapping and leaves the document intact.
7. **A mapping written inside `withTransaction` disappears when that transaction rolls back.**
   This is the only case that proves the `DBManager` per-access accessor actually joins the
   ambient transaction; without it the class-based design in Tasks 5–6 is untested.

**Explicitly out of scope:** the `ON DELETE CASCADE` behaviour. `IDocumentCommands` has no
hard-delete (`deleteDocumentLocale` is the only delete-shaped member), so the cascade is not
drivable through the adapter API. It is a schema property asserted by the migration, and this
package covers adapter-observable behaviour only. Do not reach past the adapter into the raw
pool to test it — that is a white-box test belonging in the adapter's own package, as the
header of `suites/document-tree.ts` explains for a comparable case.

**Harness contract.** `ConformanceHooks` (`packages/db-conformance/src/index.ts:68`) exposes
exactly four required members: `createAdapter(collections)`, `migrate()`, `truncate()`,
`teardown()`. There is no `registerCollection` or `createDocument` helper — suites register
collections via `adapter.commands.collections.create(...)` and mint documents via
`adapter.commands.documents.createDocumentVersion(...)`. Read `suites/document-tree.ts:77-112`
and copy its setup, teardown, and `createDoc` helper rather than inventing signatures.

**Isolation.** `hooks.truncate()` runs once per suite in `beforeAll`, not per test. Any case
that leaves a mapping behind must clear it, or use its own collection registered in
`beforeAll`. Do not rely on execution order.

**Wiring.** Read `packages/db-postgres/tests/conformance.integration.test.ts` and
`packages/db-mysql/tests/conformance.integration.test.ts` first and register the suite **the
same way those files already register the others** — either inside the aggregate
`runAdapterConformanceSuite` or as a named call in both runners. Doing both double-registers
it and every case runs twice.

- [ ] **Step 1: Write the suite** (`packages/db-conformance/src/suites/singleton-mapping.ts`)
- [ ] **Step 2: Export it** from `packages/db-conformance/src/index.ts`, alongside the other
      named suite exports (lines 45-59)
- [ ] **Step 3: Register it in both integration runners**
- [ ] **Step 4: Run both engines**

These suites are `*.integration.test.ts` and run **only** in vitest's integration mode. The
default `pnpm --filter @byline/db-postgres test` is `--mode=node` and will not collect them at
all, reporting a misleading pass.

```bash
pnpm db:init:test        # once, Postgres
pnpm db:init:test:mysql  # once, MySQL
pnpm --filter @byline/db-postgres test:integration
pnpm --filter @byline/db-mysql test:integration
```

**Gates**

- [ ] All seven cases pass on PostgreSQL
- [ ] All seven cases pass on MySQL
- [ ] The rollback case fails if you temporarily change `private get db()` to a constructor-
      captured handle — run that experiment once; a rollback test that passes either way is
      worthless
- [ ] Each suite registered exactly once (case count matches expectation, no duplicates)

- [ ] **Step 5: Format and commit**

```bash
pnpm exec biome check --write packages/db-conformance/src
git add packages/db-conformance/src packages/db-postgres/tests packages/db-mysql/tests
git commit -s -m "test(db-conformance): pinned the singleton mapping contract for both adapters"
```

---

### Task 8: Emit singleton registries in the generated types

**Required behaviour**

The generated `collection-types.ts` currently emits, inside a
`declare module '@byline/generated-types'` block: `CollectionFieldsByPath`,
`CollectionFieldsAllLocalesByPath`, `CollectionPath`, and a second
`declare module '@byline/client'` block registering `collections` on `Register`. Singletons
need the parallel surface:

1. `SingletonFieldsByPath` and `SingletonFieldsAllLocalesByPath`, holding **only** singleton
   entries. Note the emitter writes these as **type aliases** (`export type X = {`), not
   interfaces — see `packages/core/src/codegen/index.ts:492`. Match that style.
2. `SingletonPath = keyof SingletonFieldsByPath`, mirroring how `CollectionPath` is derived
   (`codegen/index.ts:500`), not a hand-built literal union.
3. Singleton entries **excluded** from the two collection registries. An app with no
   singletons emits empty registries, so `SingletonPath` resolves to `never` with no special
   case, and both names always exist so downstream imports stay unconditional.
4. The `@byline/client` `Register` merge gains
   `singletons: import('@byline/generated-types').SingletonFieldsByPath`.
5. **Do not add an optional `singletons` member to the base `Register` interface.**
   `packages/client/src/register.ts:38` is deliberately `export interface Register {}` — the
   empty declaration-merge target — and consumers read through the conditional
   `RegisteredCollections` fallback at line 35. The matching `RegisteredSingletons` fallback
   is Plan 3's job, added the same conditional-`infer` way. Emitting the augmentation now is
   correct; widening the base interface is not.
6. Both versioned constants move together: `FORMAT_VERSION` `2 → 3` (`codegen/index.ts:13`)
   **and** `HASH_DOMAIN` `…:v2 → …:v3` (line 14). Leaving the hash domain behind lets one hash
   value mean two different formats.
7. `InferCollectionRegistry` (`collection-types.ts:1407`) maps over **every** tuple member, so
   a singleton would land in the inferred collection registry and break the exactness
   contracts. It needs a filtered counterpart — a collection-only inference plus a singleton
   inference — so the two sides can be compared independently.

**Artifacts**

- `packages/core/src/codegen/index.ts` and every fixture under `codegen/fixtures/`
  (compared byte-for-byte; a stale fixture fails the suite)
- `packages/core/src/@types/collection-types.ts` — the filtered inference helpers
- `apps/webapp/byline/collection-types.contract.ts` — the app-owned exactness contract, today
  collection-only (line 26); extend it to assert the singleton registries the same way
- Both CLI template contracts and their committed generated samples
  (`packages/cli/src/templates/{byline,byline-examples}/`), regenerated, not hand-edited
- `packages/cli/src/ui-template-contract.test.ts` if it enumerates generated names
- `apps/webapp/byline/generated/collection-types.ts`, regenerated

**Red/green.** Extend `packages/core/src/codegen/index.test.node.ts` with a case emitting one
collection and one singleton. Assert the derived forms and the exclusion — and write the
negative assertion against the **type-alias** syntax the emitter actually produces:

```ts
expect(source).toContain('export type SingletonPath = keyof SingletonFieldsByPath')
expect(source).toContain('export type CollectionPath = keyof CollectionFieldsByPath')
expect(source).toMatch(/export type SingletonFieldsByPath = \{[^}]*'site-settings'/)
// The emitter writes `export type X = {`, never `export interface X {`. A regex
// asserting `interface` here matches nothing and passes vacuously — which is
// exactly the bug an earlier draft of this plan shipped.
expect(source).not.toMatch(/export type CollectionFieldsByPath = \{[^}]*'site-settings'/)
expect(source).toContain("singletons: import('@byline/generated-types').SingletonFieldsByPath")
```

- [ ] **Step 1: Write the failing codegen test**
- [ ] **Step 2: Run it and confirm it fails** —
      `pnpm --filter @byline/core test codegen`
- [ ] **Step 3: Partition `analyze` / `emitBody` by `isSingleton` and emit the four new names**
- [ ] **Step 4: Bump `FORMAT_VERSION` and `HASH_DOMAIN` together; regenerate fixtures**
- [ ] **Step 5: Add the filtered inference helpers**
- [ ] **Step 6: Extend the webapp and CLI exactness contracts**
- [ ] **Step 7: Regenerate every committed generated file**

```bash
cd apps/webapp && pnpm tsx byline/scripts/generate-types.ts
```

**Gates**

- [ ] `pnpm --filter @byline/core test codegen` green, fixtures current
- [ ] `cd apps/webapp && pnpm tsx byline/scripts/generate-types.ts --check` passes
- [ ] `pnpm typecheck` clean — the exactness contracts are compile-time, so this is where a
      mis-partitioned registry surfaces
- [ ] `pnpm test` green
- [ ] The webapp's regenerated file shows an empty `SingletonFieldsByPath`, a `SingletonPath`
      of `never`, a bumped hash, and the extended `Register` block

- [ ] **Step 8: Format and commit**

```bash
pnpm exec biome check --write packages/core/src packages/cli/src
git add packages/core/src packages/cli/src apps/webapp/byline
git commit -s -m "feat(core): emitted singleton registries in the generated types"
```

---

## Out of scope for this plan

- `updateSingleton` / `readSingleton` and the transactional first-save upsert (Plan 3).
- Singleton hooks (`beforeSave` / `afterSave`) and the `beforeRead` `false` widening (Plan 3).
- `singletons.<path>.*` ability registration and kind-aware ability-key construction (Plan 3).
- Upload authorization for singletons (Plan 3).
- `SingletonHandle` on `@byline/client` (Plan 3).
- `SingletonView`, routes, dashboard cards (Plan 4).
- Documentation and the migration example (Plan 5).

## Final verification

Run once, after all eight tasks are committed:

- [ ] `pnpm lint` — then inspect the diff (`git diff --stat`); revert unrelated reformatting
- [ ] `git diff --check` — no whitespace errors
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green
- [ ] `pnpm test:integration` green — needs `pnpm db:init:test` **and**
      `pnpm db:init:test:mysql`, each once
- [ ] Both adapters' conformance suites include `singletonMappingSuite` and pass, run in
      integration mode: `pnpm --filter @byline/db-postgres test:integration` and
      `pnpm --filter @byline/db-mysql test:integration`
- [ ] Each hand-written migration is re-runnable: apply both scripts twice against a scratch
      database and confirm the second run is a no-op
- [ ] `pnpm --filter @byline/db-postgres test ownership-guard` passes (the CI check that
      every table-creating script carries the guard)
- [ ] `apps/webapp` generated types are current: `cd apps/webapp && pnpm tsx byline/scripts/generate-types.ts --check`
- [ ] A `defineSingleton` with `orderable: true` fails at startup with a readable message
- [ ] Every commit carries a DCO `Signed-off-by` trailer and no others:
      `git log --format='%H %(trailers)' origin/develop..HEAD`
