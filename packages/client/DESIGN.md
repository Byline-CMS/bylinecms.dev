# @byline/client — Design

## Purpose

A higher-level, DSL-like API for querying and mutating documents from outside the
admin UI. Sits above the existing storage primitives (`IDbAdapter`) and the
`document-lifecycle` service, adding: query DSL translation, relationship
population, field selection, response shaping, and (eventually) access control.

---

## Status snapshot (2026-04-19)

| Phase | Scope | State |
|---|---|---|
| 1 | Read path — `find`, `findOne`, `findById`, `findByPath`, `count`; camelCase response shaping; `ClientDocument<F>` generic | **Shipped** |
| 2 | Field-level filters + sorting via `IDocumentQueries.findDocuments()` (EXISTS + `LEFT JOIN LATERAL`) | **Shipped** |
| 3 | Relationship population (`populate`, `depth`) — two-axis DSL, unified relation envelope, request-scoped `ReadContext` | **Shipped** |
| 4 | Write path (`create`, `update`, `delete`, `changeStatus`, `unpublish`) delegating to `document-lifecycle` | **Shipped** |
| 5 | Status-aware reads (`status?: 'published' \| 'any'` defaulting to `'published'` in-client), backed by `current_published_documents` view | **Shipped** |
| 6 | Cross-collection relation filters — nested-object where DSL over a relation field compiles to nested EXISTS through `store_relation` | **Shipped** |

### Phase 5 semantics

The client-level `status` option on every read method selects the **source
view**, not an exact-status filter:

- `'published'` (default) — resolve each document to its latest version
  whose status is `'published'`. If a newer draft exists over a
  previously-published version, readers still see the published content
  (backed by the `current_published_documents` Postgres view, which
  filters `document_versions` to `status = 'published'` *before* the
  `ROW_NUMBER() PARTITION BY document_id` window). A document with no
  published version is invisible in this mode.
- `'any'` — resolve to the latest version of each document regardless of
  status (backed by `current_documents`). Admin UIs use this mode.

Distinct from `where.status`, which is a literal filter on the selected
version's status column: `find({ where: { status: 'draft' } })` still
means "show me rows with status=draft" — combining it with `status: 'any'`
at the top level is the common admin pattern.

`populate` + `depth` inherit the outer read's mode: when reading in
`'published'` mode, populated relation targets also resolve to their
`current_published_documents` rows, so draft leaks can't happen through
relations either.

Shared mapping between client DSL parsing and db-postgres SQL generation lives in `@byline/core/storage/field-store-map.ts` (single source of truth + contract test).

### Phase 6 semantics — cross-collection relation filters

Where a relation field's value in the `where` clause is a plain object
with no `$`-prefixed top-level keys, it is interpreted as a **nested
where against the target collection**:

```ts
// Docs whose category's `path` text equals 'news'.
await client.collection('docs').find({
  where: { category: { path: 'news' } },
})

// Composable with ordinary field filters, at any depth.
await client.collection('docs').find({
  where: {
    title: { $contains: 'launch' },
    category: { parent: { path: 'news' } },  // 2-hop
  },
})
```

Disambiguation rule (mechanical):

| Value under a relation field | Meaning |
|---|---|
| bare string / number / null | `$eq` on the relation's own `target_document_id` |
| `{ $eq, $in, … }` (operator object, all keys `$`-prefixed) | that operator on `target_document_id` |
| `{ <fieldName>: … }` (plain object, no `$`-prefixed keys) | nested where against the target collection |

`parse-where.ts` is async when a `ParseContext` (`collections` +
`resolveCollectionId`) is threaded in — the context is populated by the
collection handle from the client's cached path→id resolver. Without
the context, nested sub-wheres are silently ignored; with it, they
compile to `RelationFilter` descriptors carrying the resolved
`targetCollectionId` and a recursive `nested: DocumentFilter[]`.

On the adapter side each `RelationFilter` emits a nested
`EXISTS` joining `store_relation` to the target collection's
current-documents view (`current_published_documents` under
`readMode: 'published'`, `current_documents` otherwise — so drafts
can't leak through the filter predicate any more than they can
through populate). Nested filters recurse against the target
version's own `td${depth}.id`. Aliases are depth-scoped (`r0`/`td0`,
`r1`/`td1`, …) so nested EXISTS never shadow their outer scope.

Document-level reserved keys (`status`, `query`, `path`) are
top-level only. Inside a nested sub-where they fall through to
ordinary field resolution on the target — so `{ category: { path: 'news' } }`
filters on the target's `path` *field*, not the target version's
path *column*. Target-side document-level conditions can be added
later if needed; the current phase keeps scope tight.

`hasMany` semantics (`$some` / `$every` / `$none`) are out of scope
for this phase. When `hasMany: true` lands on `RelationField`, the
nested-object form on single-target relations remains valid and
explicit quantifiers cover the multi-target case.

The adapter-facing filter type is a discriminated union in
`@byline/core`:

```ts
type DocumentFilter =
  | { kind: 'field'; fieldName; storeType; valueColumn; operator; value }
  | { kind: 'relation'; fieldName; targetCollectionId; nested: DocumentFilter[] }
```

---

## Construction

```ts
import { createBylineClient } from '@byline/client'

const client = createBylineClient({
  db,           // IDbAdapter
  collections,  // CollectionDefinition[]
  storage,      // IStorageProvider (optional — needed for delete file cleanup)
})
```

The factory returns a `BylineClient` instance. It resolves collection definitions
internally — callers address collections by `path` string (e.g. `'posts'`,
`'media'`), not by database ID.

Collection ID resolution happens lazily (first call per path) and is cached for
the lifetime of the client instance, via `db.queries.collections.getCollectionByPath()`.

---

## Read API

### `client.collection(path)`

Returns a `CollectionHandle` scoped to one collection. All subsequent calls
inherit the collection context.

### `handle.find(options?)`

List documents with filtering, sorting, pagination, field selection, and
relationship population.

```ts
const result = await client.collection('posts').find({
  where: {
    status: 'published',
    title: { $contains: 'launch' },
    published_at: { $gte: '2026-01-01' },
  },
  select: ['title', 'summary', 'author', 'published_at'],
  populate: {
    author: true,                    // default depth 1, all fields
    // or:
    // author: { select: ['name', 'avatar'], depth: 1 }
  },
  sort: { published_at: 'desc' },
  locale: 'en',
  page: 1,
  pageSize: 20,
})
```

**Returns:**

```ts
{
  docs: Array<{
    id: string              // document_id
    versionId: string       // document_version_id
    path: string
    status: string
    createdAt: Date
    updatedAt: Date
    fields: Record<string, any>
  }>,
  meta: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}
```

### `handle.findOne(options?)`

Same options as `find()`, returns a single document or `null`. Sugar for
`find({ ...options, pageSize: 1 })` with unwrapping.

### `handle.findById(documentId, options?)`

```ts
const doc = await client.collection('posts').findById('01abc...', {
  select: ['title', 'body'],
  populate: { author: true },
  locale: 'en',
})
```

### `handle.findByPath(path, options?)`

```ts
const doc = await client.collection('posts').findByPath('hello-world', {
  locale: 'en',
})
```

### `handle.count(where?)`

```ts
const n = await client.collection('posts').count({ status: 'published' })
```

---

## Write API

Writes go through `document-lifecycle` functions from `@byline/core/services`.
The client API does **not** use patches — it does whole-document writes via
`createDocument()` and `updateDocument()`.

### `handle.create(data, options?)`

```ts
const result = await client.collection('posts').create(
  { title: 'Hello', body: '...', status: 'draft' },
  { locale: 'en' }
)
// → { id, versionId }
```

### `handle.update(documentId, data, options?)`

```ts
const result = await client.collection('posts').update('01abc...', {
  title: 'Updated Title',
}, { locale: 'en' })
// → { id, versionId }
```

### `handle.delete(documentId)`

```ts
await client.collection('posts').delete('01abc...')
```

### `handle.changeStatus(documentId, status)`

```ts
await client.collection('posts').changeStatus('01abc...', 'published')
```

### `handle.unpublish(documentId)`

```ts
await client.collection('posts').unpublish('01abc...')
```

---

## Where Clause — Filter Operators

The `where` object maps field names to values or operator objects:

| Operator      | Meaning                | Applicable stores         |
|---------------|------------------------|---------------------------|
| (bare value)  | Exact equality         | all                       |
| `$eq`         | Equals                 | all                       |
| `$ne`         | Not equals             | all                       |
| `$gt`         | Greater than           | numeric, datetime         |
| `$gte`        | Greater than or equal  | numeric, datetime         |
| `$lt`         | Less than              | numeric, datetime         |
| `$lte`        | Less than or equal     | numeric, datetime         |
| `$contains`   | Case-insensitive ILIKE | text                      |
| `$in`         | Value in array         | text, numeric             |
| `$nin`        | Value not in array     | text, numeric             |

**Document-level filters** (not field values) are also supported at the top level:

```ts
where: {
  status: 'published',       // document_versions.status
  path: { $contains: 'news' }, // document_versions.path
  // Field-level filters:
  title: { $contains: 'launch' },
}
```

`status` and `path` are reserved names that filter on document metadata columns
rather than EAV stores. All other keys are resolved against the collection's
field definitions.

**Cross-collection filters.** On relation fields, a plain-object value with
no `$`-prefixed keys is a nested where against the target collection. See
[Phase 6 semantics](#phase-6-semantics--cross-collection-relation-filters)
above for the full rule.

---

## Query Builder — How Filters Map to SQL

This is the key missing piece. The query builder must translate field-level
`where` conditions into the correct store table joins. The building blocks
already exist:

1. **`fieldTypeToStoreType`** maps a collection field type → which EAV store
   table holds its data.
2. **`resolveStoreTypes()`** resolves a set of field names → the `Set<StoreType>`
   needed.
3. **`storeTableNames`** maps `StoreType` → Postgres table name.

### Approach: EXISTS subqueries

For each field-level filter, the query builder generates an `EXISTS (SELECT 1
FROM store_X WHERE ...)` subquery joined by `document_version_id`. This avoids
the fan-out problem of JOINing multiple EAV rows — each filter is independent.

```sql
-- where: { title: { $contains: 'launch' }, views: { $gte: 100 } }

SELECT d.*
FROM current_documents d
WHERE d.collection_id = $1
  AND EXISTS (
    SELECT 1 FROM store_text st
    WHERE st.document_version_id = d.id
      AND st.field_name = 'title'
      AND st.value ILIKE '%launch%'
  )
  AND EXISTS (
    SELECT 1 FROM store_numeric sn
    WHERE sn.document_version_id = d.id
      AND sn.field_name = 'views'
      AND sn.value_integer >= 100
  )
ORDER BY d.created_at DESC
LIMIT 20 OFFSET 0
```

### Approach: Field-level sorting

Sorting by a field value requires a lateral join or subquery to pull the sort
value into the outer query:

```sql
SELECT d.*, sort_val.value AS _sort
FROM current_documents d
LEFT JOIN LATERAL (
  SELECT value FROM store_text
  WHERE document_version_id = d.id AND field_name = 'title'
  LIMIT 1
) sort_val ON true
WHERE d.collection_id = $1
ORDER BY _sort ASC NULLS LAST
```

The query builder resolves the field name → store table + value column
automatically using `fieldTypeToStoreType`.

---

## Relationship Population

`store_relation` stores `target_document_id` and `target_collection_id` but
nothing populates on read today. The client API adds this.

### How it works

After the primary query returns documents, for each field with `type: 'relation'`
that appears in `populate`:

1. Collect all `target_document_id` values from the result set.
2. Batch-fetch those documents via `db.queries.documents.getDocuments()` (already
   supports multi-version batch loading).
3. Replace the raw relation value `{ target_document_id, target_collection_id }`
   with the populated document object (or a subset if `select` is specified in
   the populate config).
4. Recurse if `depth > 1`.

This is a post-query pass — the primary query shape is unaffected.

---

## Storage primitives the client depends on

The client has **no direct DB dependency** — it receives an `IDbAdapter` at
construction time and calls into it. Relevant methods it uses today:

- `getDocumentById()` — `findById()`
- `getDocumentByPath()` — `findByPath()` (returns `null` on miss; client no longer wraps in try/catch)
- `findDocuments({ filters, sort, ... })` — the filtered/sorted/paginated path that powers `find()` / `findOne()` / `count()`
- `getDocumentCountsByStatus()` — `count()` groupings
- `getDocumentsByDocumentIds()` — Phase 3 populate batch fetch (primitive shipped, orchestration pending)
- `getCurrentVersionMetadata()` — unused by the client today, but available for future lightweight existence checks

`@byline/client` does not generate SQL. All SQL for field-level filters and
sorts lives in the DB adapter behind `findDocuments()`; the client compiles
the DSL into `FieldFilter[]` / `FieldSort` descriptors (typed in
`@byline/core`) and passes them through. The MySQL adapter, when real, will
implement the same `IDocumentQueries` contract and reuse the same
descriptors.

---

## Package Structure

```
packages/client/
├── package.json              # @byline/client
├── tsconfig.json
├── vitest.config.ts          # --mode=node (unit) / --mode=integration
├── .env.example              # Postgres connection string for integration tests
├── DESIGN.md                 # This file
├── src/
│   ├── index.ts              # createBylineClient(), re-exports
│   ├── client.ts             # BylineClient class
│   ├── collection-handle.ts  # CollectionHandle (scoped operations)
│   ├── types.ts              # WhereClause, FilterOperators, SortSpec, ClientDocument<F>, …
│   ├── response.ts           # shapeDocument<F>() — snake_case → camelCase
│   └── query/
│       └── parse-where.ts    # WhereClause → FieldFilter[] / FieldSort via @byline/core mapping
├── tests/
│   ├── fixtures/
│   │   ├── collections.ts    # Test collection definitions + sample data
│   │   └── setup.ts          # BylineClient wired to real Postgres
│   ├── unit/
│   │   ├── parse-where.test.node.ts
│   │   └── response.test.node.ts
│   └── integration/
│       ├── client-field-filters.integration.test.ts
│       └── client-read.integration.test.ts
```

Planned additions for Phase 3:

```
├── src/
│   └── query/
│       └── populate.ts       # Post-query relationship population (by depth level)
```

---

## Dependencies

```
@byline/client
  ├── @byline/core (types, collection definitions, document-lifecycle, workflow)
  └── (no direct DB dependency)
```

The client receives an `IDbAdapter` at construction time. It never imports
`@byline/db-postgres`.

---

## Phased Implementation

### ~~Phase 1 — Read path~~ — Done (2026-04-08)

`find()`, `findOne()`, `findById()`, `findByPath()`, `count()` implemented,
delegating to `IDocumentQueries` methods on the injected adapter. Response
shaping maps snake_case → camelCase via `shapeDocument()`. `ClientDocument<F>`
was later made generic (2026-04-14) so callers can narrow the `fields` shape
per-collection (e.g. `findById<Post>(id)`).

### ~~Phase 2 — Field-level filters and sorting~~ — Done (2026-04-13)

Added `FieldFilter`, `FieldSort`, and `FieldFilterOperator` types to
`@byline/core`. Added `findDocuments()` to `IDocumentQueries` and implemented
in `db-postgres` with EXISTS subqueries for field-level filters and
`LEFT JOIN LATERAL` for field-level sorting.

Built `parse-where.ts` in `@byline/client/src/query/` — normalises
`WhereClause` into document-level conditions + `FieldFilter[]` using the
shared `fieldTypeToStore` mapping in `@byline/core`.
`CollectionHandle.find()` routes **all** queries through `findDocuments()`
(status, text search, path filter, field-level filters, field-level sort,
selective fields, pagination — one code path).

25 client unit tests pass (response shaping + `parse-where`); client
integration tests run against real Postgres. The field→store mapping has a
core-level contract test that enumerates every declared field type.

### Phase 3 — Relationship population and `depth`

Implement the `populate` post-query pass. Batch-load related documents, handle
`select` and `depth`.

#### `depth` semantics

A `depth` property on the top-level query options sets the maximum recursion
depth for all populated relations:

```ts
const result = await client.collection('posts').find({
  populate: { author: true, category: true },
  depth: 2,
})
```

- `depth: 0` — no population (ignore `populate` entirely)
- `depth: 1` — populate the named relations but don't recurse into their
  relations (**default** when `populate` is present)
- `depth: 2` — populate named relations, then populate *their* relation fields
  one more level
- No `depth` specified → default to 1

#### Efficient batch-by-level strategy

The key insight is **batch by depth level, not by individual relation**:

1. **Level 0**: Run the primary query → get N documents. Scan their
   reconstructed `fields` for relation field values (`target_document_id` /
   `target_collection_id`). Relation fields are identified from the collection's
   `CollectionDefinition.fields`.

2. **Level 1**: Collect all `target_document_id` values across all documents.
   Group by `target_collection_id` (each target collection needs its own
   `CollectionDefinition` for reconstruction). Batch-fetch all targets in a
   single `IN(...)` query + UNION ALL reconstruction. Replace each raw relation
   value with the populated `ClientDocument`.

3. **Level 2+**: Repeat — scan the just-populated documents for their relation
   fields, collect IDs, batch-fetch, replace. Stop at `depth`.

This gives **one DB round-trip per depth level**, not one per relation field.
For `depth: 2` with 20 documents, at most 3 DB queries total (primary query +
2 population rounds), regardless of how many relation fields exist.

#### Implementation details

**Circular reference protection.** Track visited `document_id` values across
levels. If a document was already populated, reference the existing object (or
skip) rather than re-fetching. Prevents infinite loops when e.g.
`author.organization.members` includes the same author.

**`select` inside `populate`.** When
`populate: { author: { select: ['name', 'avatar'] } }`, the populated document
should use selective field loading. `IDocumentQueries.getDocumentsByDocumentIds()`
already accepts `fields?: string[]` and wires through
`resolveStoreTypes()` → partial UNION ALL — Phase 3 orchestration just needs
to forward the nested `select` into this param.

**Document ID → version ID resolution.** Resolved. `store_relation` stores
`target_document_id`; `IDocumentQueries.getDocumentsByDocumentIds()`
(shipped 2026-04-14) queries `current_documents` by `document_id` in a
single batch with optional selective field loading. Phase 3 orchestration
consumes this primitive directly.

**Where `populate` runs in the pipeline.** After `shapeDocument()` (response
shaping), replacing the raw `{ target_document_id, target_collection_id }`
relation value with a shaped `ClientDocument`. This keeps populate logic in
`@byline/client`, not in the DB adapter.

### Phase 4 — Write path

Wire up `create()`, `update()`, `delete()`, `changeStatus()`, `unpublish()`
through `document-lifecycle` functions.

### ~~Phase 6 — Cross-collection relation filters~~ — Done (2026-04-19)

`FieldFilter` became a discriminated union in `@byline/core`
(`DocumentFilter = FieldFilter | RelationFilter`). `parse-where.ts`
recognises plain-object sub-wheres on relation fields, resolves the
target's collection id via a threaded `ParseContext`, and emits
`RelationFilter` entries with recursive `nested: DocumentFilter[]`.
The db-postgres adapter's `buildFilterExists` dispatches on `kind`;
relation filters emit a depth-scoped nested `EXISTS` through
`store_relation` joined to the target's `current(_published)_documents`
view, honouring `readMode` on every hop.

Rationale for the nested-object DSL over dot-notation
(`'category.path'` — Payload style) is covered in the design notes
above: it composes with TypeScript generics, doesn't collide with
Byline's internal EAV dot-path notation, and absorbs the future
`hasMany` quantifiers (`$some`/`$every`/`$none`) without needing a
parallel escape hatch.

18 new unit tests (parse-where relation branches) + 8 integration
tests (single-hop, $contains, composition, id-equality fallback,
published draft-leak guard, `status: 'any'` override, no-match,
2-hop recursion) pass.

---

## Resolved Decisions

1. **`$or` / `$and` at the top level** — Deferred. All `where` keys are
   implicitly AND'd. Add `$or` only when a real use case demands it.

2. **Cursor-based pagination** — Deferred. Page-based only for now. Cursor
   pagination is a pure additive change later (UUIDv7 IDs are time-ordered).

3. **Response format** — **camelCase.** The client API is the external boundary.
   `shapeDocument()` in `response.ts` maps `document_id` → `id`,
   `document_version_id` → `versionId`, `created_at` → `createdAt`, etc.

4. **Access control** — Deferred. The `DocumentLifecycleContext` pattern
   (per-request context) extends naturally to carrying auth info later.

## Open Questions

1. **DSL evolution.** The where clause DSL is intentionally minimal — the real
   value is the field-to-store-table resolver, not the operator syntax. If the
   operator set ever grows complex enough that we're reimplementing Drizzle's
   expression tree, reconsider the approach.
