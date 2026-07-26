---
title: "Configure search"
path: "configure-search"
summary: "How to register a PostgreSQL or MySQL search provider and declare the collection fields, weights, zones, and rich-text adapter that feed the index."
---

# Configure search

Companions:
- [Search](./index.md) — the subsystem overview and package boundaries.
- [Indexing and reindexing](./02-indexing-and-reindexing.md) — the lifecycle hooks and rebuild process that keep configured collections in sync.
- [Fields](../04-collections/01-fields.md) — the field types referenced by `search.body`, `search.facets`, and `search.filters`.
- [Rich text](../04-collections/07-rich-text.md) — the server-side `toText` adapter used when rich-text fields feed search.

This page shows how to enable search for an application and opt individual collections into the index. You edit the server configuration once, then add a `search` block and lifecycle hooks to each searchable collection.

## Quick reference

### 1. Register the provider

Construct the database adapter first, apply the search provider's independent migrations, then pass the provider to `initBylineCore()`.

**Edit:** `apps/webapp/byline/server.config.ts`

```ts
import { initBylineCore } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import { migrate, postgresSearch } from '@byline/search-postgres'

const db = pgAdapter({
  connectionString: process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING ?? '',
  collections,
  defaultContentLocale: i18n.content.defaultLocale,
})

await migrate(db.pool)

await initBylineCore({
  db,
  collections,
  search: postgresSearch({
    pool: db.pool,
    defaultLocale: i18n.content.defaultLocale,
  }),
  // other server configuration
})
```

For MySQL, use `mysqlAdapter`, `mysqlSearch`, and `migrate` from the corresponding MySQL packages. Both search factories accept the database adapter's existing pool.

`autoMigrate: true` starts migration work during provider construction, but the synchronous factory cannot await it. Use an explicit awaited `migrate(db.pool)` during deterministic production startup. `autoMigrate` is a development convenience.

### 2. Declare searchable fields

Add `search` to the collection schema. No field enters the provider projection unless this block names it.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
export const Docs = defineCollection({
  path: 'docs',
  useAsTitle: 'title',
  search: {
    body: [{ field: 'title', boost: 2 }, 'summary', 'content'],
    zones: ['docs', 'site'],
  },
  fields: [
    { name: 'title', label: 'Title', type: 'text', localized: true },
    { name: 'summary', label: 'Summary', type: 'textArea', localized: true },
    {
      name: 'content',
      label: 'Content',
      type: 'blocks',
      blocks: [RichTextBlock, PhotoBlock],
    },
  ],
})
```

The collection identity is always copied to `SearchDocument.title` for result display. It is not searchable unless its field also appears in `search.body`.

### 3. Register rich-text conversion

When a configured body field is `richText`, including rich text nested inside a configured container, register a server-side `toText` adapter.

**Edit:** `apps/webapp/byline/server.config.ts`

```ts
import { lexicalEditorToTextServer } from '@byline/richtext-lexical/server'

await initBylineCore({
  // ...
  fields: {
    richText: {
      toText: lexicalEditorToTextServer(),
    },
  },
})
```

The adapter performs a plain-text tree walk. It does not emit markdown or HTML.

## Collection search options

`search` is declared inline on `CollectionDefinition`, and each `body` or
`facets` entry is a `SearchFieldDecl` — either a bare field name or a field name
with a ranking boost:

```ts
// packages/core/src/@types/collection-types.ts — CollectionDefinition
search?: {
  body?: SearchFieldDecl[]
  facets?: SearchFieldDecl[]
  filters?: string[]
  zones?: string[]
}

// packages/core/src/@types/search-types.ts
export type SearchFieldDecl = string | { field: string; boost?: number }
```

| Option | Meaning | Current built-in provider behavior |
|---|---|---|
| `body` | Text that participates in full-text matching and ranking | Indexed and queried |
| `facets` | Controlled-vocabulary relation fields | Terms are searchable and ids are stored; aggregation is not implemented |
| `filters` | Scalar values reserved for filtering or sorting | Stored in the projection; structured filtering is not implemented |
| `zones` | Named collection groups for cross-collection search | Indexed and queried |

### Body fields

A `body` entry can be a top-level scalar field or a top-level `group`, `array`, or `blocks` container. For a container, `buildSearchDocument()` walks nested declarations and concatenates `text`, `textArea`, and `richText` leaves. It skips nested configuration values such as selects, relations, numbers, booleans, dates, code, and files.

Search configuration addresses top-level fields only. To index text inside `content`, name `content`; do not use a dotted path such as `content.caption`.

### Field weights

Use `{ field, boost }` when one field should influence ranking more strongly. Both built-in providers map boosts into the same four weight classes:

| Boost | Weight class | Relative MySQL multiplier |
|---:|---|---:|
| `>= 2` | A | 8 |
| `>= 1` | B | 4 |
| `>= 0.5` | C | 2 |
| `< 0.5` | D | 1 |

An omitted body boost defaults to class B. Facet terms default to class C. Derived variants such as stems lose one class, while Han bigrams use class D.

The exact score is provider-specific. The contract guarantees relative weighting, not equal numeric scores across PostgreSQL and MySQL.

### Facets

Every `search.facets` entry must name a top-level relation field. During indexing, the client populates each target to depth 1. Core uses the target collection's first `counter` field as the stable bucket id and its identity field as the human-readable term. A target vocabulary with no `counter` field falls back to the target's document id.

```ts
search: {
  body: [{ field: 'title', boost: 2 }, 'abstract'],
  facets: ['topics'],
}
```

Facet terms participate in full-text matching. The ids are retained for future aggregation, but `capabilities.facets` is currently `false` for both built-in providers.

### Filters

Every `search.filters` entry must name a top-level scalar field. Container fields are rejected because one filter projection must resolve to one value.

```ts
search: {
  body: ['title', 'abstract'],
  filters: ['publishedOn', 'featured'],
}
```

The values are typed as keyword, integer, float, boolean, or datetime in `SearchDocument`. PostgreSQL stores them as `jsonb`; MySQL stores them as JSON. The current SQL query translators do not apply `SearchQuery.where`.

### Zones

A collection with no explicit zones belongs to an implicit zone named after its collection path. This keeps single-collection search available without extra configuration.

Declare a shared zone when several collections should rank together:

```ts
search: {
  body: ['title', 'summary'],
  zones: ['news', 'site'],
}
```

The same `resolveSearchZones()` function supplies index metadata and resolves `client.search({ zone })` membership, so runtime query scope and indexed scope use one rule.

## Search is not admin list filtering

`search` configures the provider-backed, ranked index used by public applications. `listSearch` configures the admin collection list's small substring query over stored text fields.

```ts
export const Docs = defineCollection({
  listSearch: ['title'],
  search: {
    body: [{ field: 'title', boost: 2 }, 'summary', 'content'],
  },
  // ...
})
```

You may declare either option without the other. The admin list search falls back to the collection identity field when `listSearch` is absent. Provider search does not infer any body fields.

## Boot validation

`initBylineCore()` fails before serving requests when:

- a collection declares `search` but no `ServerConfig.search` provider exists;
- a configured field does not exist;
- a configured field path is dotted rather than top-level;
- a facet is not a relation;
- a filter is a container;
- a searchable field is virtual.

These checks prevent a collection from appearing searchable while silently indexing less content than its schema declares.

Missing `fields.richText.toText` is not currently a boot error. `buildSearchDocument()` omits configured rich-text content when the adapter is absent, including rich text nested inside a body container. Register the adapter whenever searchable content includes rich text.
