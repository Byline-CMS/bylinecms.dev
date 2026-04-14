# Relationships — Analysis & Plan

> Last updated: 2026-04-15
> Companion to [STORAGE-ANALYSIS.md](./STORAGE-ANALYSIS.md) —
> captures the design approach for the first consumer of the EAV layer
> that spans collections at read time.

This document is a guide for two audiences: newcomers who want to
understand how document relationships are modelled, written, and read
in Byline; and future contributors (human or agent) designing the
work that builds on this foundation — read-side hooks, richtext
document links, `hasMany` relations, cascade behaviour. Each section
states what shipped, why it was shaped this way, and what's still
open.

## Context

The storage layer has always modelled relations natively:
`store_relation` holds `target_document_id` + `target_collection_id`
per row, `RelationField` (`targetCollection`, `displayField`) is
declared in `packages/core/src/@types/field-types.ts`, and the
flatten/reconstruct code in
`packages/db-postgres/src/storage/storage-utils.ts` round-trips the
reference object. What had been missing until this work were the
three consumer-facing pieces that make relations useful in practice
— now delivered:

1. **Populate on read — shipped.** `populateDocuments` in
   `packages/core/src/services/populate.ts` walks a reconstructed
   document's relation leaves, batch-fetches the targets via
   `IDocumentQueries.getDocumentsByDocumentIds`, and embeds them in
   place. One DB round-trip per depth level per target collection.
   Consumed by both `@byline/client` and the admin API-preview server
   fn.
2. **Admin API preview `depth` control — shipped.** Editors on
   `apps/webapp/src/routes/{-$lng}/(byline)/admin/collections/$collection/$id/api.tsx`
   pick a depth (0–3) from the ViewMenu Select and see the populated
   JSON live. `?depth=N` is in the URL so each level is a distinct
   cache entry.
3. **Relation field admin widget — shipped.**
   `apps/webapp/src/ui/fields/relation/relation-field.tsx` renders a
   compact summary card with a Modal picker
   (`relation-picker.tsx`) listing documents from the configured
   `targetCollection`. Selection flows through the standard
   `setFieldValue` → `FieldSetPatch` pipeline — no new patch family
   required.

The real app now has its first production relation: News →
`heroImage` → Media
(`apps/webapp/byline/collections/news/schema.ts`). The full pipeline
— picker → patch → write → reconstruct → populate → API preview —
is exercised end-to-end any time an editor sets a hero image on a
news item.

### Framing

This work was the first consumer of the EAV storage layer that spans
collections at read time. It was deliberately a stress test: populate
walks, batch-by-depth, cycles, deleted targets, and cross-collection
field resolution exercise assumptions that single-collection reads
never did. Surfacing storage weaknesses (UNION ALL cost at depth,
fan-out in `IN(...)` lists, `displayField` projection semantics,
cascade-delete ambiguity) was treated as a legitimate output of the
work, not a distraction. The risks list below captures pressure
points observed during implementation and still-open performance
questions.

---

## Resolved design decisions

1. **Single-target relations only for now.** `hasMany: true` is
   deferred to a later phase. Picker UX, schema, and populate output
   stay single-valued.
2. **Populate lives in `@byline/core/services/populate.ts`.** Both
   `@byline/client` (external consumers) and the admin server fns
   (preview route) call the same orchestration. The admin webapp does
   not take a runtime dependency on `@byline/client`.
3. **Demo wiring included.** A real relation field on News → Media,
   plus Zod hardening, landed as part of this work.
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

1. **Populate walk — in place today.** Each populate level pre-filters
   target IDs against `visited`. Already-visited IDs are replaced with
   the `_cycle: true` stub rather than re-fetched. The set keys combine
   collection + document id so two distinct collections with the same
   UUID (shouldn't happen, but UUIDv7 with external imports makes it
   thinkable) stay distinct.
2. **Read budget — in place today.** Each materialised document
   increments `readCount`. Crossing `maxReads` throws
   `ERR_READ_BUDGET_EXCEEDED` with the partial result attached. This is
   defensive cheap insurance: even with perfect cycle detection, a
   malformed collection graph or a buggy future hook can't take down the
   process.
3. **Hook entry point — to be wired by the next phase.** When
   `afterRead` lands, the `DocumentLifecycleContext` exposed to hooks
   gains a `readContext` field. If a hook calls back into
   `client.collection().find()`, the client handle threads the same
   `ReadContext` through (via an internal opt-in param — the public API
   stays context-free for non-hook callers). A hook re-reading a
   document that's already in `visited` short-circuits with the cached
   materialised value; no second pass, no second hook fire. This is the
   single most important semantic rule: **within one logical request,
   each document is materialised and run through `afterRead` at most
   once.**

**Client handle wiring — in place today:**

- `CollectionHandle` accepts a private `_readContext?: ReadContext` on
  its read methods. When omitted, a fresh context is created for the
  top-level call. When present (future hook re-entry), it's threaded
  through populate.
- Public signatures stay clean — `ReadContext` is an internal plumbing
  concern, not part of the DSL. Tests assert the fresh-context default
  path so external callers never need to know it exists.

**AsyncLocalStorage alternative — not adopted now.** A cleaner future
option is to carry `ReadContext` via Node's `AsyncLocalStorage` so hooks
never have to thread it manually. That can layer over the explicit
parameter later without breaking the contract; the parameter is the
source of truth.

### Constraints this imposes

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
  is real but not a decision for this work — when `afterRead` lands,
  it should inherit from the same context type rather than introduce a
  parallel one. Flagged for the next phase's design review.
- Populate from outside the hook path (e.g. parallel requests from
  different users) is correctly independent — each top-level call gets
  its own context. No accidental cross-request leakage.

---

## Architectural shape

```
                 ┌────────────────────────────────────────┐
                 │   @byline/core/services/populate.ts    │
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

## Implementation stages

The work landed as a sequence of self-contained commits, each with
its own testable goal. They are preserved here as a historical
record and a reference for where each piece of the architecture
lives on disk.

### a. Core populate service

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
4. Replace each `leaf_ref` in place with a **relation envelope** (see
   below) — populated, unresolved, or cycle — all sharing the same
   base shape.
5. If `depth > 1`, repeat against the newly-populated documents, with
   the `populate[fieldName].populate` nested map as the next level's
   spec.

**Relation envelope — the shared shape across all four states.**

Every relation leaf shares the `RelatedDocumentValue` base
(`target_document_id`, `target_collection_id`, optional
`relationship_type` / `cascade_delete`). The discriminators
`_resolved` / `_cycle` / `document` identify which of the four
states the leaf is in:

```ts
// Unpopulated — no populate pass ran, or this leaf wasn't in scope
{ target_document_id, target_collection_id, relationship_type?, cascade_delete? }

// Populated — target fetched and attached
{ ..., _resolved: true, document: { ...fetched target doc } }

// Unresolved — target not found (usually deleted)
{ ..., _resolved: false }

// Cycle — target already materialised earlier in this request
{ ..., _resolved: true, _cycle: true }
```

The envelope guarantees the same narrowing logic at every relation
leaf (`if (v._cycle) { … } else if (v._resolved === false) { … }
else if (v._resolved === true && v.document) { … } else { /* raw ref */ }`)
and preserves the link metadata (`relationship_type`, `cascade_delete`)
through populate rather than throwing it away when the target is
successfully fetched.

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

### b. Client library integration

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
  after landing.

**New files:**

- `packages/client/tests/unit/populate-options.test.node.ts` —
  normalisation shape tests (`populate: true` → all relation fields;
  nested `select` forwards; `depth: 0` no-op).
- `packages/client/tests/integration/client-populate.integration.test.ts`
  — real-Postgres end-to-end. Seeds News + Media with cross-references,
  asserts at depth 0 / 1 / 2 / 3, includes a manufactured cycle fixture
  and a deleted-target fixture.

### c. Relation widget (admin)

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

### d. Admin API preview depth control

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

### e. Demo collection wiring

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

### f. Zod schema hardening

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
- `packages/client/DESIGN.md` — status snapshot update

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
  a shared walker into `@byline/core` when the storage-utils walker is
  next touched. Create a shared walkFieldTree(fields, data, visitor) in @byline/core the next time anything needs to touch
  a walker — whether that's adding a new compound field type, implementing hasMany, shipping rich-text document links, or adding the first afterRead
  hook that needs to visit leaves. At that point you're already paying the cognitive cost of understanding all three walkers, and the shared
  abstraction is a near-free extraction. Doing it speculatively now means inventing the right shape with only three consumers — easy to over-fit. One more consumer, and the right shape declares itself.
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
  reachable (no `afterRead` yet), but the contract is in place so
  future read-hook work cannot re-introduce the problem without
  explicitly opting out of the guard. The integration-test plan
  includes a synthetic "hook that re-reads A" fixture to lock the
  contract even before real hooks exist — simulated by two top-level
  `findById` calls that share a `ReadContext`.
- **Zod schema change breaks seed/test data.** Any existing fixture
  that passed a string ID or partial object for a relation would have
  started failing validation when stage f landed. Run the full test
  suite and audit seed files after any further tightening.
- **`cascade_delete` semantics.** The column round-trips but isn't
  acted on. This work stayed read-focused for cascade; acting on the
  flag belongs to the future write-path work.
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

---

## Future work: rich-text document links

A richtext editor (Lexical, in our case) frequently needs to insert
links to *other Byline documents* — e.g. a News article linking to a
related Page, Doc, or another News item. This is a second application
of the same "relationship" primitive, just embedded *inside a rich-text
field value* rather than as a discrete field on the collection. The
storage model, the picker UX, and the recursion guards all carry
over, but there are enough editor-specific concerns to warrant its own
design track.

This section scopes the feature. Implementation is deferred to a
later phase (likely alongside the first `afterRead` hook work, since
Mode 2 below depends on it).

### Overview

Insertion flow in the admin editor:

```
Editor toolbar
    │  user clicks "Insert document link"
    ▼
RelationPicker (reused from the relation-widget work)
    │  restricted to the collections allowed by
    │  the editor's config
    ▼
DocumentLinkNode (new Lexical node)
    │  stored in the editor's serialised state
    ▼
richText field → store_json
```

On read, depending on the chosen mode, the link node either carries
cached display data with the rest of the serialised editor state, or
carries only its `{target_document_id, target_collection_id}` pair and
is hydrated with `title` / `path` / … on the fly.

### Relation to the existing picker

The `RelationPicker` component (`apps/webapp/src/ui/fields/
relation/relation-picker.tsx`) already:

- renders a search+paginated list over `getCollectionDocuments`,
- resolves the `displayField` per target collection,
- returns `{target_document_id, target_collection_id}` to its caller.

The richtext toolbar plugin should **reuse** that picker verbatim,
parameterising it by the editor-config's list of allowed target
collections. No second picker implementation. The single difference:
the picker is opened from a Lexical `INSERT_DOCUMENT_LINK_COMMAND`
handler rather than from a form-field widget.

### Storage shape — `DocumentLinkNode`

A new custom Lexical node (analogous to the existing link node but
distinct). Minimum payload:

```ts
interface DocumentLinkNodePayload {
  /** The target document's logical id. */
  target_document_id: string
  /** The target's collection id (DB UUID). */
  target_collection_id: string
  /**
   * Cached target fields (Mode 1 only). Omitted in Mode 2. Keys here
   * are whatever the editor config nominated in `embed.fields`.
   */
  cached?: Record<string, unknown>
  /**
   * Monotonic marker set at save time. Used to detect / age out stale
   * caches when the editor config later flips to Mode 2 or when a
   * refresh job is run.
   */
  cachedAt?: string // ISO 8601
}
```

Inline link text is stored as the Lexical node's children (as with
the existing `LinkNode`). Callers can render it, override it with the
cached `title`, or — in Mode 2 — substitute the hydrated title at
render time on the client.

### Two modes of operation

#### Mode 1 — save-time embedding (`embed.mode: 'save'`)

- At `beforeCreate` / `beforeUpdate` the richtext value is walked
  for `DocumentLinkNode` instances. For each, the adapter's
  `getCurrentVersionMetadata()` + a tiny `fields` read resolves the
  target, and the chosen fields (`title`, `path`, …) are written into
  `cached`. `cachedAt` is stamped.
- Reads are fast — the rich-text JSON already carries everything a
  frontend consumer needs to build a link.
- **Tradeoff: stale data.** If the target's title or path changes,
  the cached copy diverges until the next save of the referencing
  document. Acceptable for most editorial flows; editors expect
  "refresh" affordances if they need absolute freshness.
- A follow-on "refresh links" maintenance hook is worth offering —
  a collection-level job or a per-document button that rewalks every
  DocumentLinkNode and re-fetches `cached`. Bulk refresh is a
  natural follow-on admin command.

#### Mode 2 — read-time hydration (`embed.mode: 'read'`)

- `DocumentLinkNode` stores only the id pair. The `cached` key is
  absent on the stored side.
- A richtext-aware `afterRead` hook (or a dedicated
  `hydrateDocumentLinks` service) walks the reconstructed rich-text
  JSON of the emerging response, collects every link's
  `{target_collection_id, target_document_id}`, groups them, and
  batches via `IDocumentQueries.getDocumentsByDocumentIds({ fields })`
  — exactly the same primitive the relation-field populate uses.
- The hydrated fields are **attached to the node at response time**
  (not persisted to storage): a `hydrated?: Record<string, unknown>`
  or inlined `cached`-shaped envelope, whichever is cleaner at
  render time. The storage row is untouched.
- Handles missing / deleted targets the same way populate does:
  a `_resolved: false` marker on the node so the rendering frontend
  can swap it for plain text or a broken-link indicator instead of
  crashing.

Collections / editors can mix modes — one collection's editor can be
`embed.mode: 'save'`, another `'read'`. The two aren't exclusive at
the CMS level.

### Configurable field projection

Editors almost always want *title* + *path* and nothing else, but the
set should be configurable so a collection that needs, say, an author
name or a publication date on the cached / hydrated form can get it.
Proposed config shape on the richtext field definition:

```ts
{
  name: 'body',
  type: 'richText',
  documentLinks: {
    /** Target collections the picker will list. */
    allowedCollections: ['pages', 'news', 'docs'],
    /** Save-time vs read-time hydration. */
    embed: {
      mode: 'save' | 'read',
      /** Fields copied into `cached` (save) or hydrated on read. */
      fields: ['title', 'path'],
      /**
       * Optional per-target overrides — useful when different target
       * collections carry different display fields.
       */
      fieldsPerCollection?: Record<string, string[]>,
    },
    /**
     * Maximum depth when a hydrated target's own richtext contains
     * further document links. Default 1 (shallow); higher values use
     * the same ReadContext cycle guard as populate.
     */
    hydrateDepth?: number,
  },
}
```

Defaults stay frugal: `fields: ['title', 'path']`, `hydrateDepth: 1`.
This is what a frontend needs to build a `<a href={path}>{title}</a>`
in 95% of cases, and it keeps the UNION ALL projection per hydration
level tight (mirrors the `buildBatchSelect` "always include display
field" rule from populate).

### Recursive-read safety (Mode 2)

The A→B→A loop described earlier for relation fields applies just as
much to document links: a News doc's body richtext links to a Page; the
Page's body links back; Mode 2 hydration blows the stack. The fix is
the **same `ReadContext`** already in place for relation populate:

- `hydrateDocumentLinks()` receives (or creates) a `ReadContext` and
  threads it through nested hydrations.
- Every hydrated node increments `ctx.readCount` against `maxReads`.
- Already-visited targets (`${target_collection_id}:${target_document_id}`
  in `ctx.visited`) are replaced with a `_cycle: true` marker rather
  than re-hydrated.
- `hydrateDepth` is clamped to `ctx.maxDepth` on entry.

Crucially, when a document is loaded with *both* a populate pass (for
its relation fields) and a richtext-link hydration pass (for its
richtext field), **they must share a single `ReadContext`**. Otherwise
a relation field and a richtext link pointing at the same target would
each count as a separate materialisation and could blow the budget
needlessly, or re-fetch the target twice. The unified context gives
editors a defensible "this request materialised N documents, full
stop" guarantee.

When the first real `afterRead` hook lands, it should
receive the same context too, per the "Recursive-read safety"
section above.

### Lexical implementation notes (to consult at build time)

- New node type: `DocumentLinkNode` extending `ElementNode` (or
  `TextNode` if the link should be a pure inline, no children — we
  want inline children for the visible label so extend `ElementNode`
  like the existing `LinkNode`).
- New command: `INSERT_DOCUMENT_LINK_COMMAND` dispatched from the
  toolbar button. Its payload opens the shared `RelationPicker`.
- Serialisation: the node's `exportJSON` persists the full
  `DocumentLinkNodePayload`. `importJSON` is its inverse.
- Theme hook: register the node in the editor theme so targets can
  override rendering (e.g. showing a stale-link badge when
  `_resolved === false` on the hydrated path).
- Existing richtext fixtures and seed data are unaffected — old
  documents have no `DocumentLinkNode` instances.

### Deferred within this track

- **Cross-document link integrity on delete.** Mode 1 captures
  `cached` at save time, so deleting the target leaves the cache in
  place but stale; Mode 2 yields `_resolved: false` at render time.
  Neither mode actively rewrites referrers. A future job could scan
  all richtext fields for broken links and surface them in an admin
  "broken links" view — a natural analogue of the future relation
  cascade-check story.
- **Bulk "refresh cached links" admin command** for Mode 1.
- **Mixed editor configs** — supporting per-link choice (save vs
  read) inside the same editor, rather than per-editor. Almost
  certainly not worth the complexity until a real use case demands
  it.
- **Anchor / fragment targeting.** A link may point at a specific
  heading inside the target document; that is editor-feature work,
  orthogonal to the storage shape.

---

## Deferred (out of scope for this work)

- **`hasMany: true` on RelationField** — follow-on work. Needs a new
  prop on `RelationField`, multi-select picker UX
  (add/remove/reorder), an array-of-object Zod schema, an array
  populate output, and tests.
- **`afterRead` / `beforeRead` hooks themselves** — not implemented
  yet. Populate ships with a `ReadContext` contract specifically so
  that when these hooks land, they thread the same context and the
  A→B→A recursion class is already foreclosed. The hook work itself
  is its own track.
- **AsyncLocalStorage-based context propagation** — explicit threading
  of `ReadContext` through the client handle is the contract today.
  An `AsyncLocalStorage` wrapper can layer over this later without
  breaking it.
- **Cascade delete acted on** — belongs to the future write-path work.
- **Access control on populate** (e.g. "don't populate private target
  docs") — belongs to the future access-control work.
- **Relation column formatter** in list views — currently no column
  renderer exists for relation field values; list views only show
  `target_document_id`. Useful but out of scope here.
- **Rich-text document links** (Lexical `DocumentLinkNode`, toolbar
  plugin reusing the existing RelationPicker, save-time vs read-time
  hydration modes, configurable field projection, shared
  `ReadContext` for recursion safety). See the
  [Future work: rich-text document links](#future-work-rich-text-document-links)
  section above for the full design.
