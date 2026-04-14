# Relationships — Phase 3 Analysis & Plan

> Last updated: 2026-04-14
> Companion to [STORAGE-ANALYSIS.md](./STORAGE-ANALYSIS.md) —
> captures the design approach for the first consumer of the EAV layer
> that spans collections at read time.

## Context

The storage layer already models relations: `store_relation` holds
`target_document_id` + `target_collection_id` per row, `RelationField`
(`targetCollection`, `displayField`) is defined, and the flatten/reconstruct
code round-trips the reference object. What is still missing are the three
consumer-facing pieces that make relations useful:

1. **Populate on read** — walk a reconstructed document's relation leaves,
   batch-fetch the targets, and embed them in place. The batch primitive
   (`IDocumentQueries.getDocumentsByDocumentIds`) already exists; no
   caller uses it yet.
2. **Admin API preview `depth` control** — editors should be able to
   preview what a client library `find({ populate, depth })` call would
   return for the current document (route:
   `apps/webapp/src/routes/{-$lng}/(byline)/admin/collections/$collection/$id/api.tsx`).
3. **Relation field admin widget** — a field of `type: 'relation'` has no
   UI today. Editors need a picker that lists documents of the configured
   `targetCollection`, lets them select one, and funnels the selection
   into the form's pending-patch pipeline.

No collection currently declares a relation field (only a doc-comment
example in `apps/webapp/byline/collections/media/schema.ts`), and the Zod
schema for `'relation'` is `z.any()` — so this phase is also the first
time the relation pipe gets real-world exercise.

### Outcomes

- `client.collection('posts').find({ populate: { author: true }, depth: 2 })`
  returns nested `ClientDocument` objects with cycle protection and
  unresolved-target markers.
- The admin API preview gains a Depth selector next to the locale picker
  and updates live.
- Editors can pick a target document via a modal or drawer picker; the
  selection rides the normal `field.set` / `field.clear` patch path.
- The real app has at least one relation field (News → Media) wired up
  end-to-end, with a hardened Zod schema.

### Framing

Phase 3 is the first consumer of the EAV storage layer that spans
collections at read time. It is deliberately a stress test: populate
walks, batch-by-depth, cycles, deleted targets, and cross-collection
field resolution will exercise assumptions that single-collection reads
never did. Surfacing storage weaknesses (UNION ALL cost at depth, fan-out
in `IN(...)` lists, `displayField` projection semantics, cascade-delete
ambiguity) is a legitimate output of this phase, not a distraction.
Integration-test perf assertions and the risk list below capture where
we expect to find pressure.

---

## Resolved design decisions

1. **Single-target relations only in Phase 3.** `hasMany: true` is
   deferred to Phase 3.5. Picker UX, schema, and populate output stay
   single-valued for now.
2. **Populate lives in `@byline/core/services/populate.ts`.** Both
   `@byline/client` (external consumers) and the admin server fns
   (preview route) call the same orchestration. The admin webapp does
   not take a runtime dependency on `@byline/client`.
3. **Demo wiring included (sub-phase 3e).** A real relation field on
   News → Media, plus Zod hardening, lands as part of this phase.
4. **Recursive-read safety is engineered in from day one.** Populate
   accepts an explicit `ReadContext` that persists across nested reads
   and is the future binding point for read-side hooks (see next
   section).

---

## Special consideration: recursive-read safety

### The problem

Byline's lifecycle today carries write-side hooks only (`beforeCreate`,
`afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeStatusChange`,
`afterStatusChange`, `beforeUnpublish`, `afterUnpublish`, `beforeDelete`,
`afterDelete` — declared in `packages/core/src/@types/collection-types.ts`).
Read-side hooks (`afterRead` in particular) are an anticipated addition.

When read hooks and populate coexist, a well-documented failure mode in
other headless CMSs appears: document A relates to document B; B has an
`afterRead` hook that does its own read of A (directly or through
populate); A's `afterRead` reads B; repeat until stack overflow or OOM.
Cycle protection *inside a single populate walk* does not catch this —
each `client.collection().find()` invoked from inside a hook starts a
fresh visited set, so the runtime has no memory of the request-level
graph.

The problem is not limited to `afterRead` triggering populate. Any
read-side hook that invokes `client.collection(...).find(...)` or
`.findById(...)` — even without `populate` — can cycle if the target
document's own hook does the same thing back.

### The design response

Populate in Byline ships with a **request-scoped `ReadContext`** from
day one, even though no read-side hook consumes it yet. This makes the
recursion plane explicit and gives the future `afterRead` implementation
a defined place to plug in rather than a retrofit.

**Type:**

```ts
// packages/core/src/services/populate.ts (new)
export interface ReadContext {
  /**
   * Set of `${target_collection_id}:${document_id}` strings visited
   * during this logical request. Survives across nested populate walks
   * and (future) hook-triggered reads.
   */
  visited: Set<string>
  /**
   * Monotonic count of individual document materialisations (primary
   * fetches + populated targets). Acts as a hard ceiling on blast
   * radius. Trips ERR_READ_BUDGET_EXCEEDED when exceeded.
   */
  readCount: number
  /** Max documents materialised per request. Default 500. */
  maxReads: number
  /** Max populate depth per request. Default 8 (caps `depth`). */
  maxDepth: number
}

export function createReadContext(overrides?: Partial<ReadContext>): ReadContext
```

**Enforcement points:**

1. **Populate walk (ships now, Phase 3).** Each populate level
   pre-filters target IDs against `visited`. Already-visited IDs are
   replaced with the `_cycle: true` stub rather than re-fetched. The set
   keys combine collection + document id so two distinct collections
   with the same UUID (shouldn't happen, but UUIDv7 with external
   imports makes it thinkable) stay distinct.
2. **Read budget (ships now).** Each materialised document increments
   `readCount`. Crossing `maxReads` throws `ERR_READ_BUDGET_EXCEEDED`
   with the partial result attached. This is defensive cheap insurance:
   even with perfect cycle detection, a malformed collection graph or a
   buggy future hook can't take down the process.
3. **Hook entry point (future Phase 4+).** When `afterRead` lands, the
   `DocumentLifecycleContext` exposed to hooks gains a `readContext`
   field. If a hook calls back into `client.collection().find()`, the
   client handle threads the same `ReadContext` through (via an internal
   opt-in param — the public API stays context-free for non-hook
   callers). A hook re-reading a document that's already in `visited`
   short-circuits with the cached materialised value; no second pass, no
   second hook fire. This is the single most important semantic rule:
   **within one logical request, each document is materialised and run
   through `afterRead` at most once.**

**Client handle wiring (ships now):**

- `CollectionHandle` accepts a private `_readContext?: ReadContext` on
  its read methods. When omitted, a fresh context is created for the
  top-level call. When present (future hook re-entry), it's threaded
  through populate.
- Public signatures stay clean — `ReadContext` is an internal plumbing
  concern, not part of the DSL. Tests assert the fresh-context default
  path so external callers never need to know it exists.

**AsyncLocalStorage alternative (not in Phase 3).** A cleaner future
option is to carry `ReadContext` via Node's `AsyncLocalStorage` so hooks
never have to thread it manually. That can layer over the explicit
parameter later without breaking the contract; the parameter is the
source of truth.

### Constraints this imposes on Phase 3

- Populate always creates or threads a `ReadContext`. Never operates
  ungoverned.
- `visited` uses `${collection_id}:${document_id}` composite keys.
- `maxReads` default is 500 (tunable via `createReadContext(...)`);
  expose on `FindOptions.readBudget` later if callers need to lift it.
- `maxDepth` default is 8; the `FindOptions.depth` param is clamped to
  this ceiling on entry.
- Admin API preview caps user-facing depth at 3 (stricter than the
  programmatic ceiling) — prevents a curious editor from accidentally
  DOS-ing the preview.
- The cycle stub shape
  (`{ target_document_id, target_collection_id, _resolved: true, _cycle: true }`)
  and the unresolved-target shape (`{ …, _resolved: false }`) stay
  distinct so callers can tell "not fetched because of cycle" from "not
  fetched because deleted".

### What this does *not* fix

- A single pathological `afterRead` hook that does non-read side-effects
  (writes to another service, etc.) per invocation is still free to
  misbehave. `ReadContext` only guards reads.
- The `DocumentLifecycleContext` proliferation risk ("context sprawl")
  is real but not a Phase 3 decision — when `afterRead` lands, it should
  inherit from the same context type rather than introduce a parallel
  one. Flagged for Phase 4 design review.
- Populate from outside the hook path (e.g. parallel requests from
  different users) is correctly independent — each top-level call gets
  its own context. No accidental cross-request leakage.

---

## Architectural shape

```
                 ┌────────────────────────────────────────┐
                 │   @byline/core/services/populate.ts    │   ← NEW (3a)
                 │   populateDocuments({ db, collections, │
                 │      docs, collectionId, populate,     │
                 │      depth, locale, readContext })     │
                 └────────────┬───────────────────────────┘
                              │  getDocumentsByDocumentIds()
                              ↓      (primitive, already shipped)
           ┌──────────────────┴──────────────────┐
           │                                     │
  @byline/client                        apps/webapp server fns
  CollectionHandle                      (getCollectionDocument +
  .find / .findOne / .findById          listing for picker)
  .findByPath                           ↑
    ↑                                   │
    │                                   ↓
  External consumers             Admin API preview (depth selector)
                                 Relation field widget (picker)
```

---

## Sub-phase breakdown

Ordered by dependency. Each lands as a separate commit.

### 3a — Core populate service

**Goal:** `populateDocuments(...)` replaces relation leaves with full
documents, one DB round-trip per depth level, with cycle and
unresolved-target markers.

**New files:**

- `packages/core/src/services/populate.ts` — orchestration.
- `packages/core/src/services/populate.test.node.ts` — unit tests over
  a fake `IDbAdapter` that captures `getDocumentsByDocumentIds` calls.
- Update `packages/core/src/services/index.ts` to export
  `populateDocuments`, `createReadContext`, `PopulateMap`,
  `PopulateFieldOptions`, `ReadContext`.

**Key signature:**

```ts
export type PopulateMap = Record<string, true | PopulateFieldOptions>

export interface PopulateFieldOptions {
  select?: string[]
  populate?: PopulateMap
}

export interface PopulateOptions {
  db: IDbAdapter
  collections: CollectionDefinition[]
  collectionId: string          // source collection for `documents`
  documents: Array<Record<string, any>>
  populate?: PopulateMap | true // `true` → populate every relation field
  depth?: number                // default 1 when populate present; 0 disables
  locale?: string
  /**
   * Request-scoped recursion guard (see "Recursive-read safety" above).
   * Omit to create a fresh context per top-level call. Future afterRead
   * hook re-entry threads an existing context to prevent A→B→A loops.
   */
  readContext?: ReadContext
}

export async function populateDocuments(opts: PopulateOptions): Promise<void>
```

Mutates `documents` in-place (findDocuments results are already
freshly-shaped copies). Returns void.

**Algorithm (batch-by-depth):**

1. Walk each document's `fields` against its `CollectionDefinition` using
   a new internal `walkRelationLeaves(fields, defs, visit)` helper that
   recurses through `group` / `array` / `blocks` structure fields. This
   avoids dotted-path ambiguity for relations inside arrays/blocks.
2. Collect `{ collection_id, document_id, leaf_ref, select_for_leaf }`
   for every relation leaf that matches the `populate` map.
3. Group by `target_collection_id`, call `getDocumentsByDocumentIds`
   once per target collection with the appropriate `fields` array for
   selective loading.
4. Replace each `leaf_ref` in place with the populated document (or a
   marker — see below).
5. If `depth > 1`, repeat against the newly-populated documents, with
   the `populate[fieldName].populate` nested map as the next level's
   spec.

**Deleted-target placeholder** (missing from batch result):

```ts
{ target_document_id, target_collection_id, _resolved: false }
```

**Cycle marker** (target `document_id` already in visited set):

```ts
{ target_document_id, target_collection_id, _resolved: true, _cycle: true }
```

Visited set is the `ReadContext.visited` set — maintained across the
whole request, not just the current walk — so future `afterRead`-hook
re-entry can't re-traverse a document that populate already expanded.
Keys are `${target_collection_id}:${document_id}`.

**Read-budget enforcement:** each materialisation increments
`readContext.readCount`. On overflow, throw `ERR_READ_BUDGET_EXCEEDED`
(new, defined in `packages/core/src/lib/errors.ts`) carrying the partial
result so the caller can decide whether to surface or degrade.

**Select forwarding:** when `populate: { author: { select: ['name'] } }`,
the batch call for the author's target collection uses
`fields: ['name']`. Always include the target's `displayField` (or the
first text field) implicitly so the widget summary keeps working — the
client library can override.

### 3b — Client library integration

**Goal:** `client.collection('posts').find({ populate, depth })` returns
populated documents typed by the `F` generic.

**Edits:**

- `packages/client/src/types.ts` — add `populate?: PopulateMap | true`
  and `depth?: number` to `FindOptions`, `FindOneOptions`,
  `FindByIdOptions`, `FindByPathOptions`. Re-export `PopulateMap`,
  `PopulateFieldOptions`, `ReadContext` from `@byline/core`.
- `packages/client/src/index.ts` — re-export the new types.
- `packages/client/src/collection-handle.ts` — after `shapeDocument()`
  in each of `find`, `findOne`, `findById`, `findByPath`, call
  `populateDocuments(...)` with the active collection's id, the full
  `collections` array, and the same locale. Default `depth` to 1 when
  `populate` is present, `0` skips.
- `packages/client/DESIGN.md` — bump the status-snapshot table
  (Phase 3 → Shipped) after landing.

**New files:**

- `packages/client/tests/unit/populate-options.test.node.ts` —
  normalisation shape tests (`populate: true` → all relation fields;
  nested `select` forwards; `depth: 0` no-op).
- `packages/client/tests/integration/client-populate.integration.test.ts`
  — real-Postgres end-to-end. Seeds News + Media with cross-references,
  asserts at depth 0 / 1 / 2 / 3, includes a manufactured cycle fixture
  and a deleted-target fixture.

### 3c — Relation widget (admin)

**Goal:** Editing a relation field opens a picker listing documents from
`targetCollection`. Selection → `field.set` patch with the
`RelatedDocumentValue` object. Clear → `field.clear`.

**New files:**

- `apps/webapp/src/ui/fields/relation/relation-field.tsx` — widget
  surface. Mirrors `ImageField` shape: compact summary card + Remove +
  Change buttons, plus "Select…" when empty.
- `apps/webapp/src/ui/fields/relation/relation-picker.tsx` — picker UI.
  Primitive is either `@infonomic/uikit/react` `Modal` or a side drawer
  (`Dialog` with side positioning) — decide at implementation based on
  fit for long lists and search ergonomics. Layout: header ("Select
  {target label}"), body = search input + paginated row list
  (display-field as row label, secondary line = path/slug), footer =
  Cancel / Select. Single-select for v1.
- `apps/webapp/src/modules/admin/collections/list-for-picker.ts` — thin
  server fn (or reuse `getCollectionDocuments`) that fetches a minimal
  projection: `[displayField, 'title', 'path']`. Returns same shape as
  `CollectionSearchParams`.

**Edits:**

- `apps/webapp/src/ui/fields/field-renderer.tsx` — add `case 'relation':`
  branch that dispatches to `RelationField`.
- `apps/webapp/src/modules/admin/collections/index.ts` — export the new
  picker server fn.

**Display-field resolution** (pure widget concern):
`field.displayField` → first top-level `text` field on
`getCollectionDefinition(field.targetCollection)` → `path` →
`document_id`.

**Patch contract:** `field.set` with
`value = { target_document_id, target_collection_id }`; `field.clear` on
Remove. Both already supported by `setFieldValue` /
`useFieldChangeHandler` — no new patch family.

**Failure mode:** if `getCollectionDefinition(field.targetCollection)`
is `null`, render an inline error ("Relation field `{name}` targets
unknown collection `{targetCollection}`") and a disabled picker button.
No throw.

### 3d — Admin API preview depth control

**Goal:** A Depth `Select` next to the Content Locale picker on
`.../$id/api`. Changing it re-runs the loader with a new `depth` param
and re-renders the JSON.

**Edits:**

- `apps/webapp/src/modules/admin/collections/get.ts` — extend
  `getCollectionDocument(collection, id, locale?, depth?)` and its
  internal `getDocumentFn`. When `depth > 0`, after fetching and
  serialising, call `populateDocuments({ db,
  collections: getServerConfig().collections,
  collectionId: config.collection.id, documents: [data], depth, locale })`.
  Admin uses the core service directly, not `@byline/client`.
- `apps/webapp/src/routes/{-$lng}/(byline)/admin/collections/$collection/$id/api.tsx`
  — extend `searchSchema` with
  `depth: z.coerce.number().int().min(0).max(3).optional()`. Include
  `depth` in `loaderDeps` (so TanStack Router treats each depth as a
  distinct cache entry). Pass to `getCollectionDocument`.
- `apps/webapp/src/modules/admin/collections/components/view-menu.tsx` —
  conditional second `Select<number>` visible only when
  `activeView === 'api'`. Items: `[0, 1, 2, 3]`, default `1`. Label
  "Depth:", same styling as the existing Content Locale label.
  `onValueChange` navigates with
  `search: (prev) => ({ ...prev, depth: value })`.
- `apps/webapp/src/modules/admin/collections/components/api.tsx` — no
  functional change required; the JSON viewer renders whatever the
  loader returns. Optional: small `depth=N` badge in the header.

**Cap:** 3. Enough to exercise cycles; avoids runaway on wide graphs.
Programmatic client callers can go deeper.

### 3e — Demo collection wiring

**Goal:** A real collection declares a `relation` field so the whole
pipeline (widget → patch → write → reconstruct → populate → preview) is
exercised in the running app.

**Edits:**

- `apps/webapp/byline/collections/news/schema.ts` (or the existing News
  schema — confirm at implementation) — add:
  ```ts
  {
    name: 'heroImage',
    label: 'Hero Image',
    type: 'relation',
    targetCollection: 'media',
    displayField: 'title',
    optional: true,
  }
  ```
- Update the News admin column definitions if appropriate (probably not
  — the column formatter doesn't support relation preview yet).
- `apps/webapp/byline/seed-bulk-documents.ts` — one seeded News doc
  with `heroImage` set to an existing Media `document_id` /
  `target_collection_id`.

### 3f — Zod schema hardening

**Goal:** Replace `z.any()` for relation fields with a proper object
shape now that real collections use the field. Prevents silent form-save
breakage.

**Edits:**

- `packages/core/src/schemas/zod/builder.ts` — in the relation branch
  around lines 181–186, emit:
  ```ts
  z.object({
    target_document_id: z.string().uuid(),
    target_collection_id: z.string().uuid(),
    relationship_type: z.string().optional(),
    cascade_delete: z.boolean().optional(),
  }).nullable()
  ```
  for `field.type === 'relation'`. Optional fields on `RelationField`
  get `.optional()` at the envelope layer via existing builder logic.
- Full `pnpm test` pass; audit seed data for drift. Any test fixture
  that passed a bare string ID as a relation value must be updated.

---

## Critical files

**New:**

- `packages/core/src/services/populate.ts`
- `packages/core/src/services/populate.test.node.ts`
- `apps/webapp/src/ui/fields/relation/relation-field.tsx`
- `apps/webapp/src/ui/fields/relation/relation-picker.tsx`
- `apps/webapp/src/modules/admin/collections/list-for-picker.ts` (or
  extend `list.ts`)
- `packages/client/tests/unit/populate-options.test.node.ts`
- `packages/client/tests/integration/client-populate.integration.test.ts`

**Edited:**

- `packages/core/src/services/index.ts`
- `packages/client/src/types.ts` — `populate` + `depth` in options
- `packages/client/src/collection-handle.ts` — call populate after
  `shapeDocument()` in each read method
- `packages/client/src/index.ts` — re-export populate types
- `packages/core/src/schemas/zod/builder.ts` — relation schema
- `apps/webapp/src/modules/admin/collections/get.ts` — depth param +
  populate call
- `apps/webapp/src/routes/{-$lng}/(byline)/admin/collections/$collection/$id/api.tsx`
  — searchSchema + loaderDeps + loader arg
- `apps/webapp/src/modules/admin/collections/components/view-menu.tsx` —
  depth selector
- `apps/webapp/src/ui/fields/field-renderer.tsx` — `case 'relation':`
- `apps/webapp/byline/collections/news/schema.ts` — heroImage field
- `apps/webapp/byline/seed-bulk-documents.ts` — demo relation value
- `packages/client/DESIGN.md` — status snapshot (Phase 3 → Shipped)

**Reused (no edits):**

- `IDocumentQueries.getDocumentsByDocumentIds` — db-postgres +
  db-remote stub
- `@byline/core` field→store mapping (`fieldTypeToStore` et al.)
- `apps/webapp/src/ui/forms/form-context.tsx` — `setFieldValue`,
  `useFieldValue`, `useFieldError`
- `apps/webapp/src/ui/fields/use-field-change-handler.ts`
- `apps/webapp/src/modules/admin/collections/list.ts` —
  `getCollectionDocuments` for the picker listing
- `@infonomic/uikit/react` `Modal`, `Select`, `Label`, `Button`,
  `IconButton`

---

## Verification

**Unit (fast, node mode):**

- `packages/core/src/services/populate.test.node.ts` — batch-by-level
  call counts, cycle marker shape, unresolved-target shape, `select`
  forwarding, `depth: 0` no-op, `populate: true` discovery over
  `group` / `array` / `blocks`. Dedicated cases for the `ReadContext`
  contract: visited-set persistence across walks, composite-key
  collision safety, `depth` clamp to `readContext.maxDepth`, and
  `ERR_READ_BUDGET_EXCEEDED` when `maxReads` is exceeded.
- `packages/client/tests/unit/populate-options.test.node.ts` — DSL
  normalisation.
- `packages/core/src/storage/field-store-map.test.node.ts` — already
  covers relation; no change.

Commands:
```sh
pnpm -F @byline/core test
pnpm -F @byline/client test
```

**Integration (real Postgres):**

- `packages/client/tests/integration/client-populate.integration.test.ts`
  — seeds News + Media cross-refs; asserts populated shapes at each of
  depth 0 / 1 / 2 / 3. Separate fixtures for the cycle case and the
  deleted-target case.

Commands:
```sh
cd postgres && ./postgres.sh up -d   # if not already running
cd packages/client && pnpm test:integration
```

**Admin manual test plan:**

1. `pnpm dev`; navigate to a News document edit view.
2. Relation picker opens on the `heroImage` field, lists Media docs,
   search filters results, pagination advances, selection persists
   across save.
3. Navigate to `.../api` — Depth selector is visible next to Content
   Locale. Cycle through 0 → 1 → 2 → 3. JSON view updates each time;
   URL reflects `?depth=N`.
4. Confirm history and edit views don't render the Depth selector.
5. Delete a referenced Media doc, reload `.../api?depth=1` on the
   referring News doc — verify `_resolved: false` placeholder appears
   instead of a null or a crash.
6. Type-check / lint:
   ```sh
   pnpm -F @byline/core exec tsc --noEmit
   pnpm -F @byline/client exec tsc --noEmit
   pnpm -F @byline/db-postgres exec tsc --noEmit
   pnpm -F @byline/webapp exec tsc --noEmit
   pnpm lint
   ```

---

## Risks & gotchas

- **Field-tree walker drift.** `walkRelationLeaves` must recurse through
  `group` / `array` / `blocks` exactly like the flatten/reconstruct code
  in `packages/db-postgres/src/storage/storage-utils.ts`. If the two
  diverge, relations inside blocks won't populate. Consider extracting
  a shared walker into `@byline/core` during 3a.
- **Select + displayField pairing.** When the client provides
  `populate: { author: { select: ['body'] } }` without including the
  display field, downstream UI that renders a label will break.
  Populate implementation should always include the target's display
  field in the batch fetch, transparent to the caller.
- **Deleted-target inside an array.** A `null` gap would shift array
  indices. The `_resolved: false` stub preserves position.
- **Cross-collection definitions at runtime.** The picker and populate
  both need `getCollectionDefinition(field.targetCollection)`. If the
  target collection isn't registered, populate silently skips the leaf
  (treats it as unresolved); picker renders an inline error. Log a
  single warning when populate skips due to missing target definition —
  helps spot typos.
- **Depth 3 × wide fan-out.** 20 docs × 5 relations × 3 levels is still
  capped at 3 DB queries (one per level × target collection), but the
  `IN(...)` list can grow. Add a sanity assertion in the integration
  test that query counts match the batch-per-level expectation.
- **Recursive read hooks (A→B→A).** Addressed by the request-scoped
  `ReadContext` described in its own section above. Not currently
  reachable (no `afterRead` yet), but the contract is in place so that
  Phase 4+ read-hook work cannot re-introduce the problem without
  explicitly opting out of the guard. Integration test includes a
  synthetic "hook that re-reads A" fixture to lock the contract even
  before real hooks exist — the hook is simulated by making two
  top-level `findById` calls that share a `ReadContext`.
- **Zod schema change breaks seed/test data.** Any existing fixture
  that passed a string ID or partial object for a relation will start
  failing validation in 3f. Run the full test suite and audit seed
  files before merging.
- **`cascade_delete` semantics.** The column round-trips but isn't
  acted on. Phase 3 stays read-only for this; defer cascade behaviour
  to the Phase 4 write path.
- **ViewMenu depth selector leaks into other routes if mis-conditioned.**
  Gate on `activeView === 'api'`. Keep `loaderDeps` narrow on the api
  route so `?depth=N` cache keys don't bleed into edit/history.
- **TanStack Router cache on depth change.** The api route already uses
  `staleTime: 0, gcTime: 0, shouldReload: true`; confirm `loaderDeps`
  includes `depth` so the loader actually re-fires.
- **Runtime dep discipline.** The admin server fn calling
  `populateDocuments` is the first crossing from admin into
  `@byline/core/services` for query-time logic — the existing crossing
  is only for lifecycle writes. Consistent pattern is good; no new
  dependency added.

---

## Deferred (out of scope for Phase 3)

- **`hasMany: true` on RelationField** — deferred to Phase 3.5. Needs:
  new prop on `RelationField`, multi-select picker UX
  (add/remove/reorder), Zod array-of-object schema, populate array
  output, tests.
- **`afterRead` / `beforeRead` hooks themselves** — not implemented in
  Phase 3. Populate ships with a `ReadContext` contract specifically so
  that when these hooks land, they thread the same context and the
  A→B→A recursion class is already foreclosed. The hook work itself is
  Phase 4+.
- **AsyncLocalStorage-based context propagation** — explicit threading
  of `ReadContext` through the client handle is the Phase 3 contract.
  An `AsyncLocalStorage` wrapper can layer over this later without
  breaking it.
- **Cascade delete acted on** — Phase 4 write path.
- **Access control on populate** (e.g. "don't populate private target
  docs") — Phase 4 access-control concern.
- **Relation column formatter** in list views — currently no column
  renderer exists for relation field values; list views only show
  `target_document_id`. Useful but out of scope here.
