# @byline/client — Design Proposal

## Purpose

A higher-level, DSL-like API for querying and mutating documents from outside the
admin UI. Sits above the existing storage primitives (`IDbAdapter`) and the
`document-lifecycle` service, adding: query DSL translation, relationship
population, field selection, response shaping, and (eventually) access control.

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

## What Needs to Change in Existing Primitives

### IDbAdapter / IDocumentQueries — probably nothing

The existing `getDocumentsByPage()` method handles its own SQL building. The
client API's query builder would bypass it and build SQL directly, similar to
how `getDocumentsByPage` already does internally. The client would still use:

- `getDocumentById()` — for `findById()`
- `getDocumentByPath()` — for `findByPath()`
- `getDocuments()` — for relationship population batch loading
- `getDocumentCountsByStatus()` — could power `count()` for status filters

For the general `find()` with field-level filters, the client API needs to
build its own SQL. **This is the one place where `@byline/client` needs raw
database access** — it can't express field-level WHERE clauses through the
current `IDocumentQueries` interface.

### Options for the query builder's database access

**Option A: Extend `IDbAdapter` with a lower-level query method.**

Add something like:

```ts
interface IDocumentQueries {
  // ... existing methods ...

  /**
   * Execute a filtered, paginated query against current documents.
   * Used by the client API's query builder.
   */
  findDocuments(params: {
    collection_id: string
    filters: FieldFilter[]     // field_name + operator + value + store table
    sort?: FieldSort           // field_name + direction + store table
    locale?: string
    page?: number
    pageSize?: number
  }): Promise<{ documents: any[]; total: number }>
}
```

This keeps SQL generation inside the DB adapter where it belongs, and the client
API stays database-agnostic.

**Option B: Pass a raw SQL executor to the client.**

The client generates SQL fragments and passes them to a thin executor. Tighter
coupling, but more flexible.

**Recommendation: Option A.** It maintains the adapter boundary and means
`@byline/client` has zero dependency on Drizzle or Postgres. The MySQL adapter
(when real) would implement the same interface.

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
│   ├── types.ts              # WhereClause, FilterOperator, SortSpec, etc.
│   └── response.ts           # Response shaping (internal → public format)
├── tests/
│   ├── fixtures/
│   │   ├── collections.ts    # Test collection definitions + sample data
│   │   └── setup.ts          # BylineClient wired to real Postgres
│   ├── unit/
│   │   ├── response.test.node.ts
│   │   └── sort.test.node.ts
│   └── integration/
│       └── client-read.integration.test.ts
```

Future additions (Phase 2+):

```
├── src/
│   ├── query/
│   │   ├── parse-where.ts    # where clause → FieldFilter[] normalisation
│   │   └── populate.ts       # Post-query relationship population
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

### ~~Phase 1 — Read path (no field-level filters)~~ — Done (2026-04-08)

`find()`, `findOne()`, `findById()`, `findByPath()`, `count()` implemented,
delegating to existing `IDocumentQueries` methods. `find()` uses
`getDocumentsByPage()` for status filter, text search, pagination, ordering,
and selective field loading. Response shaping maps snake_case → camelCase.

10 unit tests + 16 integration tests (against real Postgres) passing.

### ~~Phase 2 — Field-level filters and sorting~~ — Done (2026-04-13)

Added `FieldFilter`, `FieldSort`, and `FieldFilterOperator` types to
`@byline/core`. Added `findDocuments()` to `IDocumentQueries` and implemented
in `db-postgres` with EXISTS subqueries for field-level filters and LEFT JOIN
LATERAL for field-level sorting.

Built `parse-where.ts` in `@byline/client/src/query/` — normalises `WhereClause`
into document-level conditions + `FieldFilter[]` using a field-type-to-store-type
mapping. `CollectionHandle.find()` detects field-level conditions and routes to
`findDocuments()` automatically; simple queries still use `getDocumentsByPage()`.

24 unit tests + 18 integration tests (against real Postgres) passing.

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
should use selective field loading. This requires adding `fields?: string[]`
support to the batch-fetch path (currently only `getDocumentsByPage()` supports
selective loading).

**Document ID → version ID resolution.** `store_relation` stores
`target_document_id` (logical document ID), but `getDocuments()` takes version
IDs. Population needs either: (a) a new query method
`getDocumentsByDocumentIds()` that queries `current_documents` by `document_id`,
or (b) a lookup against `current_documents` to resolve version IDs first. Option
(a) is cleaner.

**Where `populate` runs in the pipeline.** After `shapeDocument()` (response
shaping), replacing the raw `{ target_document_id, target_collection_id }`
relation value with a shaped `ClientDocument`. This keeps populate logic in
`@byline/client`, not in the DB adapter.

### Phase 4 — Write path

Wire up `create()`, `update()`, `delete()`, `changeStatus()`, `unpublish()`
through `document-lifecycle` functions.

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
