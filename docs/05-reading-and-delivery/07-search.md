---
title: "Search & Retrieval"
path: "search"
summary: "A pluggable SearchProvider seam in core with a built-in Postgres full-text driver (@byline/search-postgres). Collections opt in with a search config; core assembles a type-enriched SearchDocument that drivers index. Lifecycle hooks keep the index live, an admin reindex button rebuilds it, and client.collection(x).search() is the developer query surface. BM25 / vector / hybrid drivers and attachment extraction are sanctioned future phases."
---

# Search & Retrieval

:::note[Partly shipped]
The `SearchProvider` seam, the built-in Postgres full-text driver, the
type-enriched `SearchDocument` + assembler, lifecycle-hook indexing, the
`reindex` command + admin button, and the single-collection
`client.collection(x).search()` query surface are **shipped** (Phase 2). Still
planned: the cross-collection **zone** query entry point, **`hydrate`**
(two-tier rich results), **structured `where`** filtering and **facet
aggregation** at query time, **attachment text-extraction** (Phase 3),
**external drivers** (Phase 4), and the **MCP** tool (Phase 5). Each section
below marks what is shipped vs planned.
:::

## Overview

The **primary use case is developer-facing search through the
[Client SDK](./01-client-sdk.md)** — giving the people who build on Byline a
first-class way to add search to their own sites with the same typed API they
already use for `find()` and `populate`. A docs site wants a docs search; a
publication wants a search over its archive; a marketing site wants one box
across everything. Adding search is as easy to wire as a query —
`client.collection('docs').search({ query })` returns ranked hits, not a
separate system to stand up.

The **second consumer is agent retrieval** — RAG and the [MCP server](./05-mcp-server.md).
Ranked retrieval is the substrate RAG is built on, and it is the named burning
priority for the project's content-vertical work, where BM25 and
metadata-ranking plugins already exist privately and need a sanctioned extension
point instead of forking the read path. Both consumers want the same thing,
which is why this is one seam rather than two.

The subsystem is a **single seam** — `SearchProvider` — with:

- a **built-in Postgres full-text driver** (`@byline/search-postgres`) so every
  installation gets ranked search with zero extra infrastructure, and
- a **sanctioned extension point** so external drivers (BM25 rankers, vector
  stores, hybrid retrievers) plug in through one interface rather than ad-hoc
  forks of the query path.

This mirrors how Byline already treats the database (`IDbAdapter`), storage
(`IStorageProvider`), and the richtext editor (`fields.richText.*`): a small,
typed interface in `@byline/core`, a default implementation, and registration on
`ServerConfig` validated at `initBylineCore()`.

## Architecture at a glance

The vertical, top to bottom:

1. **The `search` config** per collection (`CollectionDefinition.search`)
   — the implementor declares which fields are searchable `body`, which are
   `facets`, which are `filters`, and the `zones` it belongs to. Core derives
   each field's *type* from the schema.
2. **`buildSearchDocument`** (`@byline/core`) assembles a document into a flat,
   type-enriched `SearchDocument` (a typed `SearchField[]` projection). Rich-text
   `body` fields are flattened through the `fields.richText.toText` seam.
3. **`SearchProvider`** (`ServerConfig.search`) indexes `SearchDocument`s and
   answers queries. The built-in **`@byline/search-postgres`** driver stores a
   weighted `tsvector`, owns its own schema, and reuses the host's pool.
4. **Lifecycle hooks** call `client.collection(x).indexDocument(id)` /
   `removeFromIndex(id)` to keep the index live; **`client.reindex()`** (and the
   admin **reindex button**) rebuild it.
5. **`client.collection(x).search()`** is the developer query surface; the docs
   frontend (drawer modal → `/docs/search?q=` results route) is the worked
   example.

## The `SearchProvider` interface (shipped)

A provider-agnostic interface in `@byline/core`
(`packages/core/src/@types/search-types.ts`), registered on `ServerConfig`
top-level next to `db` and `storage`, composed and validated by
`initBylineCore()`:

```ts
interface SearchProvider {
  /** What this driver supports — read by consumers to gate UI / features. */
  readonly capabilities: SearchCapabilities
  /** Add or replace a document. Idempotent on (collectionPath, documentId, locale). */
  upsert(doc: SearchDocument): Promise<void>
  /** Remove a document — all locales, or one (collectionPath, documentId, locale). */
  remove(ref: { collectionPath: string; documentId: string; locale?: string }): Promise<void>
  /** Execute a query and return ranked hits. */
  search(query: SearchQuery): Promise<SearchResults>
  /** Drop a collection's slice (or the whole index) — the clear half of a rebuild. */
  reindex?(opts: { collectionPath?: string }): Promise<void>
}

interface SearchCapabilities {
  facets: boolean         // facet aggregation buckets
  typoTolerance: boolean  // pg_trgm-style fuzzy
  semantic: boolean       // vector / hybrid
  bm25: boolean           // IDF-aware ranking
  weighting: boolean      // per-field SearchField.boost
  highlights: boolean     // matched-snippet highlighting
}
```

- **Registration** follows the established factory pattern. The built-in driver
  is `postgresSearch({ pool, … })` — it takes the **host's existing pg pool**
  (e.g. `db.pool` from `pgAdapter`), not a `getClient`, because the provider is a
  pure index sink (it never reads source documents). `ServerConfig.search?:
  SearchProvider`; `initBylineCore()` fails fast when a collection opts into
  search but no provider is registered (`validateSearchConfig`).
- **`capabilities`** is the honesty layer: the Postgres floor declares
  `weighting` + `highlights` only; `facets` / `typoTolerance` / `semantic` /
  `bm25` are `false` until a richer driver (or capability) lands. Consumers light
  up features against it rather than assuming.
- **External drivers** implement the same interface. A vector driver embeds the
  text on `upsert` and runs ANN on `search`; a hybrid driver fuses scores. None
  touch the read path. (Planned — Phase 4.)

## The collection search config (shipped)

A collection opts into search with a `search` block on its
`CollectionDefinition`. Each key names the part a field plays in the index;
core derives each field's *type* from the schema. Nothing is auto-pulled,
so unindexed content (editorial notes, internal fields) never leaks.

```ts
search?: {
  body?: SearchFieldDecl[]    // fields whose text feeds the full-text body
  facets?: SearchFieldDecl[]  // relation fields → controlled-vocabulary facets
  filters?: string[]          // scalar fields projected for filtering / sorting
  zones?: string[]            // search scopes this collection belongs to
}

// A field path, or { field, boost } to weight it (scoring providers only).
type SearchFieldDecl = string | { field: string; boost?: number }
```

- **`body`** — text fields contribute their value; `richText` fields are
  flattened to plain text via the `fields.richText.toText` seam. `title` is
  **display-only** unless you list the identity field here (typically boosted, so
  it lands in the heaviest weight class). A `body` entry may also name a
  **container** field (`blocks` / `array` / `group`): `buildSearchDocument` walks
  it recursively and flattens every nested `richText` and text (`text` /
  `textArea`) leaf into the searchable body. Nested non-text leaves (`select`,
  `relation`, numbers, booleans, dates, files) are skipped, so block
  *configuration* never pollutes the index — the same "content, not
  configuration" rule the markdown assembler follows. This is what gets the prose
  out of a block-based body field (e.g. the docs collection's `content`) and into
  the index.
- **`facets`** — relation field paths to controlled-vocabulary collections. Core
  resolves each target's `counter` field (the stable aggregation **id**) and its
  `useAsTitle` (the **term**); the term is folded into the searchable text and
  the id is kept for aggregation.
- **`filters`** — scalar field paths, projected as typed values (not scored).
- **`zones`** — named scopes; defaults to a single implicit zone equal to the
  collection path when omitted.

The worked example is the `docs` collection:
`search: { body: [{ field: 'title', boost: 2 }, 'summary', 'content'] }` —
`content` is a `blocks` field, so its nested RichTextBlock prose (and PhotoBlock
alt text + caption) is walked and folded into the body.

> The admin list-view search box reads the `body` field names for its
> `store_text` `ILIKE` match (`storage-queries.ts`) — a lightweight matcher that
> predates the provider and still serves the admin; the provider path is the
> ranked one.

## What feeds the index — the typed `SearchDocument` (shipped)

The provider never sees EAV rows. `buildSearchDocument`
(`packages/core/src/services/build-search-document.ts`) normalises a
locale-resolved document into a flat, **type-enriched** `SearchDocument` — a
typed, role-tagged `SearchField[]` projection a driver maps onto its own index
(Postgres store columns + weighted `tsvector`, Solr dynamic fields, a vector
store's payload) without re-inspecting the schema:

```ts
interface SearchDocument {
  collectionPath: string
  documentId: string
  locale: string
  status: string          // for published-only filtering at query time
  zones: string[]         // resolved scope membership
  title: string           // useAsTitle — always present for hit display
  path: string | null
  fields: SearchField[]   // the typed, role-tagged projection drivers consume
  updatedAt: string
}

interface SearchField {
  name: string            // field path; also the default index field name
  type: SearchFieldType   // schema-derived
  role: SearchFieldRole   // config-declared: 'body' | 'facet' | 'filter'
  value: string | number | boolean | SearchFacetValue[] | null
  boost?: number          // per-field relevance weight (weighting-capable drivers)
}

type SearchFieldType = 'text' | 'keyword' | 'integer' | 'float' | 'boolean' | 'datetime' | 'facet'

interface SearchFacetValue { id: number | string; term: string }  // counter id + useAsTitle term
```

- **`title`** is the collection's identity value — resolved via `useAsTitle`
  (falling back to the first text field) through the same `resolveIdentityField`
  populate uses. It is display-only; searchability comes from the `body` role.
- **`body` feeds**, in increasing order of work:
  1. **Text fields** — the configured `body` fields' string values.
  2. **Rich-text plain text** — `richText` `body` fields flattened via the
     editor-agnostic **`fields.richText.toText`** seam (`RichTextToTextFn`). The
     Lexical implementation is `lexicalToText` / `lexicalEditorToTextServer`
     (`@byline/richtext-lexical/server`) — a recursive text-node accumulator (no
     markdown). *(Shipped.)*
  3. **Attachment-extracted text** — from uploaded files, joined in. *(Planned —
     Phase 3, [Attachment text-extraction](#attachment-text-extraction).)*
- **Facets** are first-class: a `type: 'facet'` / `role: 'facet'` field whose
  value is `{ id, term }[]`. The assembler reads the populated relation target's
  `counter` field (id) and `useAsTitle` (term); the caller must populate the
  facet relations to depth 1 first (the lifecycle path does this for you).

## The Postgres full-text driver (shipped)

`@byline/search-postgres` implements the seam over a single denormalised table,
`byline_search_documents`, keyed `(collection_path, document_id, locale)`:

- **Ranking** — a weighted `tsvector` (GIN-indexed) assembled at `upsert` from
  the typed fields: `body` fields weight A–D by their `boost`, facet **terms**
  weight C, all `setweight`-combined. Queried with `websearch_to_tsquery` +
  `ts_rank`. Highlights via `ts_headline` (`capabilities.highlights`).
- **Scoping** — `zones text[]` (GIN) for zone membership, `collection_path` +
  `status` for collection / published scoping, `facets` and `filters` as `jsonb`
  for future aggregation / filtering.
- **Per-locale language** — one row per `(document, locale)`; each indexed with
  the Postgres `regconfig` mapped from its content locale (`en` → `english`, …),
  falling back to `simple`. A `defaultLocale` factory option sets the `regconfig`
  for locale-less queries (otherwise they fall back to `simple` and miss
  locale-stemmed vectors). Extend the map via `localeRegconfig`.
- **Capabilities** — `weighting` + `highlights` today. The facet *data* is
  indexed, but facet *aggregation*, structured `where` filtering, fuzzy matching,
  BM25 ranking, and semantic retrieval are flagged `false` (follow-ups).
- **Schema ownership** — the driver **owns its schema**: numbered SQL files in
  `migrations/` are the source of truth, applied by `migrate(pool)` (tracked in
  its own `byline_search_migrations` table) or an opt-in `autoMigrate` at boot.
  It is *not* part of the host's Drizzle migration stream — a future
  `@byline/search-mysql` ships its own. Install paths: run the SQL by hand,
  `migrate(pool)` as a deploy step (recommended), or `autoMigrate` (dev). See the
  package README.

## Index lifecycle (shipped)

Indexing is **published-only** and **event-driven**, hung off the same
collection lifecycle hooks that drive L1 cache invalidation. The orchestration
lives in **`@byline/client`** (the provider is a sink; it can't read source
documents). A collection's `hooks.ts` calls:

| Hook | Action |
|---|---|
| `afterCreate` / `afterUpdate` / `afterStatusChange` / `afterUnpublish` | `client.collection(p).indexDocument(id)` |
| `afterDelete` | `client.collection(p).removeFromIndex(id)` |

`indexDocument` is a **re-sync by read**: for each content locale it reads the
document's *published* view (`status: 'published'`, `onMissingLocale: 'omit'`,
`_bypassBeforeRead`) and `upsert`s where present, `remove`s where absent. This
one path handles publish, unpublish, draft-over-published, and plain edits
uniformly and idempotently — the index always mirrors what a public reader can
see. `removeFromIndex` drops all locales. The `docs` collection wires this as the
worked example (`apps/webapp/byline/collections/docs/hooks.ts`).

:::warning[Index from a system client, not the request-scoped one]
Resolve the indexing client with `getSystemBylineClient()` (super-admin context,
no session cookies) — **not** `getAdminBylineClient()`. The request-scoped admin
client reads the session cookie via the TanStack Start server runtime, so calling
it from a lifecycle hook couples that hook to a live HTTP request and throws
`No StartEvent found in AsyncLocalStorage` from every out-of-band write path:
import scripts, seeds, migrations, the CLI, and tests. Indexing is background
maintenance — it reads the published view and `_bypassBeforeRead` — so the
system context is both correct and runtime-agnostic. (Both helpers live in
`@byline/host-tanstack-start/integrations/byline-client`.)
:::

**Indexing is synchronous** inside the `afterX` hook (same Postgres, no
consistency gap). An async outbox/queue for network-backed drivers (a slow vector
write must not stall a publish) is deferred — the interface is unchanged, only
the wiring differs by driver.

### Rebuild — `reindex` + the admin button (shipped)

`client.collection(x).reindex()` rebuilds a collection's whole index slice:
`provider.reindex({ collectionPath })` clears the slice (dropping orphans for
deleted docs), then it walks every published document (paginated) and
re-indexes it. It asserts the **`collections.<path>.reindex`** ability — a
uniform 7th collection verb auto-registered for every collection.

Needed for first-time **backfill** (content published before indexing existed),
after a `search` config change, or a driver swap. Reachable three ways:

- **`client.collection(x).reindex()`** in a script / CLI (the engine).
- The **admin reindex button** — a `CollectionAdminConfig.listActions` component
  (`ReindexButton`, `@byline/host-tanstack-start/admin-shell/collections`),
  rendered in the list header (default *and* tree list views), self-gated on the
  ability, calling the `reindexCollection` server fn. `listActions` is a reusable
  header-actions slot (the Payload `beforeList`/`afterList` analog).
- Directly via `provider.reindex()` (clear only) for tooling.

Synchronous today (fine for small/medium collections). A large corpus wants this
backgrounded with progress — see [Open questions](#open-questions).

## The query surface

Search is a first-class `@byline/client` method, parallel to `find()`.

### Single-collection search (shipped)

```ts
const results = await client.collection('docs').search({
  query: 'fractional indexing',
  locale,                // defaults to the client default
  status: 'published',   // defaults to published; 'any' for admin
  where,                 // accepted; not yet applied by the Postgres driver
  facets,                // accepted; aggregation not yet implemented
  limit, offset,
})

// SearchResults:
// {
//   hits: Array<{ collectionPath, documentId, locale, title, path, score, highlights? }>,
//   total,
//   facets?,
// }
```

`CollectionHandle.search()` asserts the collection `read` ability, scopes to the
collection + `published` by default, and delegates to `provider.search()`. It
returns the **lightweight hit tier** — `title`, `path`, `score`, and
matched-snippet `highlights` — enough to render a results list without
hydration. Fetch hit ids via `findById` when a richer item is needed.

:::warning[Search does not yet honour `beforeRead` row-scoping]
`search()` enforces only the **collection-level** `read` ability. It does **not**
run hits back through the [`beforeRead` row-scoping](../06-auth-and-security/01-authn-authz.md)
pipeline, because it ranks straight from the provider index rather than going
through the normal read path where the `QueryPredicate` is applied. A collection
that relies on `beforeRead` to hide rows from an actor (owner-only drafts,
multi-tenant isolation, department visibility, …) would **leak those rows
through search**.

**Why this is safe today:** the index is **published-only** and the sole
collection wired to search is `docs`, which is fully public — there is no
row-scoping predicate to violate. The published-status floor is the only thing
the current implementation relies on for safety.

**Before exposing search on a row-scoped collection**, the row-auth follow-up
must land. The intended posture is *"rank in the provider, authorise in core"* —
re-resolve the candidate hit ids through the normal read path so `beforeRead`
applies, dropping any the actor may not see. Note the paging interaction: because
that filter runs **after** ranking, offset paging and the `total` count become
approximate unless the `QueryPredicate` is instead pushed down into the provider
(which requires the scoping columns to be indexed — a driver capability). See
[Open questions](#open-questions).
:::

The docs frontend is the worked example: a drawer-modal search box →
`/<lng>/docs/search?q=` SSR results route → `client.collection('docs').search()`
→ hits rendered with canonical hierarchical URLs (resolved via the cached nav
tree) and safely-rendered `ts_headline` snippets.

### Planned (not yet shipped)

- **Zone (cross-collection) search** — `client.search({ zone: 'site', … })`
  returning heterogeneous hits ranked together. Zones are already *stored* on the
  `SearchDocument` and the provider's `search` accepts a `zone` filter (`zones @>
  ARRAY[$zone]`), but the top-level `client.search({ zone })` entry point isn't
  built yet.
- **`hydrate` (two-tier rich results)** — opt in and core batch-reads the hit ids
  per collection and attaches a shaped `ClientDocument`, projected to that
  collection's `admin.itemView` columns (see [Rendering heterogeneous
  results](#rendering-heterogeneous-results)).
- **Structured `where` filtering** and **facet aggregation** at query time — the
  options are accepted in the API, but the Postgres driver does not yet apply
  `where` or compute facet buckets (`capabilities.facets === false`).
- **Row-level authorization on search.** Today `search()` asserts the *collection*
  `read` ability but does **not** re-resolve hit ids through the `beforeRead`
  row-scoping pipeline. The published-only index is safe for public readers (the
  docs case), but a row-scoped collection's search would not yet enforce
  per-row visibility. The intended posture is "rank in the provider, authorise in
  core" (re-resolve candidate ids through the normal read path) — a tracked
  follow-up, not yet wired.
- **MCP** exposes the same surface as a `search` tool (Phase 5).

## Search zones (partly shipped)

A **zone** is a named search scope. Collections declare zone membership in their
`search` config; `SearchDocument.zones` is the resolved set (default: a single
implicit zone equal to the collection path). The Postgres driver filters on it
(`zones @> ARRAY[$zone]`), so the *storage and provider* side is shipped. The
*cross-collection client entry point* (`client.search({ zone })`, heterogeneous
ranked hits) is the planned half above.

## Rendering heterogeneous results

*Planned.* A zone (cross-collection) results page faces a problem Byline already solves:
*render an item of collection X as a row or tile* — exactly what the relation
picker does. The plan is to reuse **`admin.itemView`** (the generalised `picker`
config): map each hit's `collectionPath` to that collection's item-view
presentation and render the hydrated item through it, so heterogeneous result
rows come "for free" from config the host already wrote for relations. The
`itemView` config does triple duty — *what to fetch* (projection) and *how to
render* (presentation), per collection — reused by the relation picker, `hasMany`
tiles, and (eventually) search rows.

This is an **admin / host-UI** concern above the core contract: `search()`
returns data (rows, ids, optional shaped documents), never components, so non-UI
consumers (MCP, a JSON endpoint) are unaffected. *(The `admin.itemView`
projection and relation-column formatter already ship; wiring them into search
hydration is the remaining work.)*

## Attachment text-extraction

*Planned — Phase 3.* A sibling pipeline that feeds the index (and downstream retrieval) from uploaded
files: an **extraction-provider interface** — `file → { markdown, plainText,
metadata }` — so structure-aware, markdown-emitting extractors (Docling-class)
and classic extractors (Apache Tika) are interchangeable drivers, exactly as
`SearchProvider` makes rankers interchangeable. Extracted output lands in its own
table keyed to the file (never as synthetic `store_*` data), invalidated on
re-upload, and joined into the searchable `body`. The full landscape, tiered
strategy (fast / local-ML / VLM), page-level routing, and licensing analysis live
in the [search & extraction strategy brief](../byline-search-extraction-strategy.md).

## Phasing

0. **Prerequisites — done.** `admin.itemView` + the relation column formatter +
   depth-1 list populate.
1. **Design** — ✅ done (this doc, now a present-state reference).
2. **`SearchProvider` seam + Postgres FTS driver — ✅ shipped.** The interface +
   typed `SearchDocument` + assembler + `richTextToText` seam in `@byline/core`;
   `@byline/search-postgres` (weighted `tsvector`, owns its schema);
   `ServerConfig.search` registration + boot validation; the collection
   `search` config; lifecycle-hook indexing; `reindex` + the `collections.<path>.reindex`
   ability + admin button; `client.collection(x).search()`; the docs frontend
   results route. **Deferred within Phase 2:** the cross-collection `zone` query,
   `hydrate`, structured `where` filtering, facet aggregation, row-level
   authorization on search, and async/outbox indexing.
3. **Attachment text-extraction** — the extraction-provider interface + a first
   driver, its own table, and the join into `body`. *(Planned.)*
4. **External drivers** — a vector and/or hybrid driver against the same seam
   (the RAG payoff; the home for the private BM25 / metadata-ranking work).
   *(Planned.)*
5. **MCP `search` tool** — wire the query surface into the MCP server. *(Planned.)*

## Open questions

- **Resolved — per-locale indexing / `regconfig`.** Shipped: one `SearchDocument`
  per `(document, locale)`, indexed with a per-locale `regconfig`, plus a
  `defaultLocale` for locale-less queries.
- **Resolved — sync indexing for the Postgres driver.** Shipped inline in the
  lifecycle hook. Async/outbox for network-backed drivers remains.
- **Partly resolved — facets over EAV.** The `{ id, term }` projection is built
  and indexed (term searchable, id stored). Facet *aggregation queries* and the
  cardinality/typing story are still open (`capabilities.facets === false`).
- **Row-level authorization on search.** "Rank in provider, authorise in core"
  (re-resolve hit ids through `beforeRead`) is the intended posture but is **not
  yet wired** — `search()` asserts only the collection `read` ability. Safe for
  the published-only public case; required before row-scoped collections expose
  search. **Paging interaction:** because core-side re-auth filters *after*
  ranking, offset paging and the `total` count go approximate (short pages,
  inflated totals, offset drift as the filter removes a different count per page).
  The exact-paging alternative is to push the `QueryPredicate` down into the
  provider (see *Multi-tenant scoping at scale* below) — which only works if the
  scoping columns are indexed. The two notes are the same trade seen from the
  auth side and the driver side.
- **Zone definition & re-tagging.** Whether zones stay emergent from
  per-collection `search.zones` or get a lightweight registry (display labels, a
  declared default, validation). Re-tagging on a membership change is a cheap
  `reindex` (no text re-extraction) but needs a trigger. The cross-collection
  query entry point is also still to build.
- **Structured `where` at query time.** The API accepts `where`; compiling it
  against the `jsonb` `filters` / store is unbuilt.
- **Reindex cost / streaming.** Backfilling a large installation runs through the
  client read path synchronously today; a large corpus wants batching/throttling
  and a background job with progress (the admin button is synchronous).
- **Multi-tenant scoping at scale.** Whether providers should accept a scoping
  predicate (the `beforeRead` `QueryPredicate`) to avoid over-fetch when scoping
  is highly selective — a driver-capability question.

## Companions

- [Client SDK](./01-client-sdk.md) — `search()` lands here alongside `find()`;
  the legacy `where.query` `ILIKE` is its primitive ancestor.
- [Markdown Export](./04-markdown-export.md) — `lexicalToText` is the search
  sibling of `lexicalToMarkdown` / `documentToMarkdown`; both flatten rich
  content for non-HTML consumers.
- [MCP Server](./05-mcp-server.md) — the headline future consumer (Phase 5).
- [Collections](../04-collections/index.md) — the collection `search` config and
  the lifecycle hooks that maintain the index.
- [Authentication & Authorization](../06-auth-and-security/01-authn-authz.md) —
  the `collections.<path>.reindex` ability and the (planned) `beforeRead`
  row-scoping that search must honour.
- [Search & extraction strategy brief](../byline-search-extraction-strategy.md) —
  forward-looking landscape + tiered strategy for Phases 3–4 (attachment
  extraction, external drivers).
