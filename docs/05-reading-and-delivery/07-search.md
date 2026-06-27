---
title: "Search & Retrieval"
path: "search"
summary: "A pluggable SearchProvider seam in core — Postgres full-text search built in, BM25 / vector / hybrid as sanctioned external drivers. The primary consumer is the Client SDK: a first-class way for developers to build search into their own sites. Collections are indexed into named zones, so a query can be collection-scoped (a dedicated publications search) or zone-scoped (one site search across collections). Design doc; sets the interface before implementation."
---

# Search & Retrieval

:::note[Planned]
This document describes a planned subsystem. It sets out the intended shape of
the `SearchProvider` seam — its interface, what feeds the index, how the index is
maintained, and the query surface — so those decisions are settled before the
first driver is written. Treat it as the design the implementation follows rather
than a description of shipped code. The **only** search that ships today is the
substring match described in [Current state](#current-state); everything below is
the target.
:::

## Session checkpoint

**Where this stands (last session, on `develop` past `v3.14.0`):** the design below
is **settled** — this doc is the spec. Phase 1 (the design) is done. The two decided
prerequisites that the search surface leans on **both shipped this session**, so
**Phase 2 is unblocked**:

- **`admin.itemView`** (generalised the old `picker` config; `picker` kept as a
  deprecated alias). Read it via `resolveItemViewColumns(config)` in `@byline/core`.
  This is the per-collection **projection + presentation** contract that
  [heterogeneous result rows](#rendering-heterogeneous-results) reuse — what to fetch
  *and* how to render, per collection.
- **Relation column formatter** (list views). The list read now **populates relation
  columns to depth 1** via `buildRelationSummaryPopulateMap`
  (`packages/core/src/services/relation-projection.ts`) and **skips the per-locale Zod
  parse when populated** (see `get.ts` / `list.ts`); `relationColumnFormatter`
  (`@byline/admin/react`) renders the titles. Search-result rows that include relation
  columns reuse exactly this populate + formatter path.

**Pick up here → Phase 2:** build the `SearchProvider` seam + `@byline/search-postgres`
FTS driver (item 2 in [Phasing](#phasing)). Concrete first move: add the
`SearchProvider` interface + `SearchDocument` + `ServerConfig.search` registration and
`initBylineCore()` validation in `@byline/core` (mirror the
`fields.richText.{populate,embed}` adapter pattern), then the Postgres FTS driver, then
wire indexing into the lifecycle hooks and add `client.search()` /
`client.collection(x).search()`.

**Already in place to reuse (don't rebuild):** `resolveItemViewColumns` (projection),
`buildRelationSummaryPopulateMap` (depth-1 relation populate), the
skip-parse-when-populated pattern, the collection lifecycle hooks
(`afterCreate` / `afterStatusChange` / `afterUnpublish` / `afterDelete`) for index
maintenance, `lexicalToMarkdown` / `documentToMarkdown` for the rich-text feed, and the
`current_published_documents` view for published-only indexing.

**Settled decisions (don't relitigate):** Client SDK is the primary consumer; **zones**
scope collection-vs-cross-collection search; **two-tier results** (lightweight rows +
opt-in `hydrate`); `title` comes from `useAsTitle`; `admin.itemView` is the projection
contract. **Still open** (settle in / just before Phase 2): zone definition
(emergent-from-config vs a registry), facets over EAV, per-locale FTS `regconfig`,
multi-tenant scoping (rank-in-provider / authorise-in-core), sync-vs-async indexing per
driver, and `reindex` cost / streaming — see [Open questions](#open-questions).

Companions:
- [Client SDK](./01-client-sdk.md) — the query surface lands here as a first-class
  `search()` method alongside `find()`; today's `where.query` is its primitive
  ancestor.
- [Markdown Export](./04-markdown-export.md) — `documentToMarkdown` /
  `lexicalToMarkdown` already turn rich content into agent-readable text. Search
  reuses that text-extraction work as one of its **feeds** rather than inventing a
  parallel one.
- [MCP Server](./05-mcp-server.md) — the headline **consumer**. A semantic /
  hybrid search tool is what makes an MCP `search` tool worth more than a thin
  `find()` wrapper. Its own design names "the retrieval layer lands first."
- [Collections](../04-collections/index.md) — the per-collection `search` config
  and the lifecycle hooks (`afterCreate` / `afterStatusChange` / …) that maintain
  the index live here.
- [Authentication & Authorization](../06-auth-and-security/01-authn-authz.md) —
  search results must obey the same `beforeRead` row-scoping and published-only
  rules as ordinary reads; the provider can't be a side channel around them.

## Overview

The **primary use case is developer-facing search through the
[Client SDK](./01-client-sdk.md)** — giving the people who build on Byline a
first-class way to add search to their own sites with the same typed API they
already use for `find()` and `populate`. A docs site wants a docs search; a
publication wants a search over its archive; a marketing site wants one box across
everything. Adding search should be as easy to wire as a query — `client.search(…)`
returning shaped `ClientDocument` hits, not a separate system to stand up.

Because real sites scope search differently per collection — a dedicated archive
search in one place, a shared "everything" search in another — collections are
indexed into named **[zones](#search-zones)**. A query can target a single
collection (`client.collection('publications').search(…)`) or a zone that spans
several (`client.search({ zone: 'site', … })`).

The **second consumer is agent retrieval** — RAG and the [MCP server](./05-mcp-server.md).
Ranked retrieval is the substrate RAG (retrieval-augmented generation) is built on,
and it is the named burning priority for the project's content-vertical work, where
BM25 and metadata-ranking plugins already exist privately and need a sanctioned
extension point instead of forking the read path. Both consumers want the same
thing, which is why this is one seam rather than two.

The goal of this subsystem is a **single seam** — `SearchProvider` — with:

- a **built-in Postgres full-text driver** so every installation gets ranked
  search with zero extra infrastructure, and
- a **sanctioned extension point** so external drivers (BM25 rankers, vector
  stores, hybrid retrievers) plug in through one interface rather than ad-hoc
  forks of the query path.

This mirrors how Byline already treats the database (`IDbAdapter`), storage
(`IStorageProvider`), and the richtext editor (`fields.richText.*`): a small,
typed interface in `@byline/core`, a default implementation, and registration on
`ServerConfig` validated at `initBylineCore()`.

## Current state

What ships today is deliberately minimal and is **not** the design below:

- Per collection, `search?: { fields: string[] }`
  (`CollectionDefinition.search`, `packages/core/src/@types/collection-types.ts`)
  names which `store_text` fields the admin list-view search box matches.
  Defaults to `{ fields: ['title'] }`.
- The match itself is a case-insensitive substring (`value ILIKE '%query%'`) over
  those `store_text` rows (`packages/db-postgres/src/modules/storage/storage-queries.ts`),
  surfaced through the client DSL as `where.query`.

This has no ranking, no richtext or attachment content, no facets, and no way to
swap the matcher. It is fine for "find the page titled roughly X" in the admin and
nothing more. The seam below subsumes it: `where.query` becomes one (FTS-backed)
capability of a provider rather than a hard-coded `ILIKE`.

## The `SearchProvider` interface

A provider-agnostic interface in `@byline/core`, registered on `ServerConfig`
top-level next to `db` and `storage`, and composed by `initBylineCore()`. Shape
(illustrative — to be pinned during implementation):

```ts
interface SearchProvider {
  /** Add or replace a document in the index. Idempotent on (collection, id, locale). */
  upsert(doc: SearchDocument): Promise<void>
  /** Remove a document (all locales) or a single (collection, id, locale). */
  remove(ref: { collectionPath: string; documentId: string; locale?: string }): Promise<void>
  /** Execute a query and return ranked hits. */
  search(query: SearchQuery): Promise<SearchResults>
  /** Drop and rebuild a collection's slice (or the whole index). Backfill / driver swap. */
  reindex?(opts: { collectionPath?: string }): Promise<void>
}

type SearchProviderFactory = (deps: { getClient: () => BylineClient }) => SearchProvider
```

- **Registration** follows the established factory pattern
  (`postgresSearch({ getClient })`, mirroring `lexicalEditorPopulateServer({ getClient })`).
  `ServerConfig.search?: SearchProvider`; `initBylineCore()` wires it and, when a
  collection opts into search but no provider is registered, fails fast with a
  pointer to the built-in driver — the same posture the richText adapters use.
- **Built-in driver:** `@byline/search-postgres` (working name) implements the
  interface over a `tsvector` column / GIN index and `websearch_to_tsquery` +
  `ts_rank`. No new infrastructure; reuses the existing Postgres connection.
- **External drivers** implement the same four methods. A vector driver embeds
  `SearchDocument.body` on `upsert` and runs ANN on `search`; a hybrid driver
  fuses FTS + vector scores. None of them touch the read path — they only
  implement `SearchProvider`.

## What feeds the index — the `SearchDocument`

The provider never sees EAV rows. Core normalises each document into a flat,
provider-agnostic `SearchDocument` and hands that over:

```ts
interface SearchDocument {
  collectionPath: string
  documentId: string
  locale: string
  status: string              // for published-only filtering at query time
  zones: string[]             // search scopes this document belongs to (see Search zones)
  title: string               // useAsTitle
  path: string | null
  body: string                // concatenated indexable text (see feeds below)
  fields: Record<string, unknown>  // facetable / filterable projection
  updatedAt: string
}
```

`title` is the collection's **identity** value — resolved via `useAsTitle`
(falling back to the first text field), the same `resolveIdentityField`
(`packages/core/src/services/populate.ts`) that populate's default projection and
`RelationSummary` already use. It is never assumed to be a literal `title` field,
so heterogeneous zone results get a sensible label per collection without
per-collection special-casing.

`body` is assembled from three feeds, in increasing order of work:

1. **Text fields** — today's `search.fields`, generalised. The per-collection
   `search` config grows from `{ fields }` into a richer shape ([zone](#search-zones)
   membership, which fields feed `body`, which become facets, per-field boosts)
   while keeping `{ fields: [...] }` working as the shorthand.
2. **Rich-text plain text** — rich-text fields are extracted to plain text and
   concatenated into `body`. The serialiser already exists: `lexicalToMarkdown` /
   `documentToMarkdown` (`@byline/richtext-lexical/server`,
   `packages/core/src/services/document-to-markdown.ts`) produce agent-readable
   text; search consumes a plain-text projection of the same. This is the named
   trigger for the deferred richtext "editor-side server pipeline" phase — search
   is the consumer that makes it concrete.
3. **Attachment-extracted text** — text and structure pulled from uploaded files
   (PDF, DOCX, …) via the [attachment text-extraction pipeline](#attachment-text-extraction)
   below, joined into `body` so an upload's contents are searchable, not just its
   filename.

Markdown-first extraction is deliberate: documents and attachments converge on one
text representation that serves indexing, chunking, and agent consumption alike,
rather than maintaining a separate "search text" pipeline.

## Search zones

A **zone** is a named search scope. Collections declare which zone(s) they belong
to in their `search` config; a query then targets either a single collection or a
zone that spans collections. This is what lets one installation offer, say, a
dedicated archive search over a large publications collection *and* a general site
search that sweeps several collections — without those being two separate systems.

```ts
// collection schema (search config)
search: { zones: ['site', 'publications'], fields: ['title', 'body'] }
```

- A collection can belong to **more than one** zone — e.g. an `articles`
  collection feeds both a dedicated `publications` archive search and the general
  `site` search, while `legal` pages sit only in `site`.
- A zone is **cross-collection**: `client.search({ zone: 'site' })` returns
  heterogeneous hits drawn from every collection indexed into `site`, ranked
  together. Each hit carries its `collectionPath` so the consumer can route and
  render per type.
- A **single-collection** search (`client.collection('publications').search(…)`)
  is the natural scope when results are homogeneous — a dedicated archive box.
- Zones are also the natural unit a driver can **specialise**: a large
  `publications` archive might map to its own vector index while the rest of the
  site uses FTS. v1 treats a zone as a logical filter on one index
  (`zones @> ARRAY[$zone]` in the Postgres driver); the interface leaves room for
  per-zone provider routing later without a contract change.

`SearchDocument.zones` is the resolved membership for a document, derived from its
collection's config at index time. Default when a collection opts into search
without naming zones: a single implicit zone equal to the collection path — so
single-collection search always works and shared `site`-style zones are opt-in.

## Index lifecycle

Indexing is **published-by-default** and **event-driven**, hung off the same
collection lifecycle hooks that already drive L1 cache invalidation
(`packages/core/src/@types/collection-types.ts`):

| Event | Index action |
|---|---|
| `afterCreate` / `afterUpdate` | `upsert` if the resulting version is published (else no-op; drafts stay out of the public index) |
| `afterStatusChange` | publish → `upsert`; unpublish/archive → `remove` |
| `afterUnpublish` | `remove` |
| `afterDelete` | `remove` (all locales) |

Decisions to settle in implementation:

- **Sync vs async.** v1 indexes synchronously inside the lifecycle transaction's
  `afterX` hook for the Postgres driver (same DB, same transaction — no
  consistency gap). External drivers (network calls to a vector store) want an
  async outbox / queue so a slow index write can't fail or stall a publish. The
  interface is the same; the *wiring* differs by driver. Design the hook layer so
  a provider can declare "index inline" vs "enqueue."
- **`reindex` command.** An admin/CLI command that rebuilds a collection's slice
  (or the whole index) — needed for first-time backfill of existing content, for
  swapping drivers, and after a `search` config change. Walks published documents
  via `@byline/client` with `_bypassBeforeRead`.
- **Status-aware parity.** Indexing only published versions mirrors the
  `current_published_documents` read model (see [Client SDK → status-aware reads](./01-client-sdk.md)).
  A "search drafts too" mode is a later opt-in, kept out of the default public
  index.

## The query surface

This is the headline. Search is a first-class `@byline/client` method, parallel to
`find()` — the surface a developer reaches for to put a search box on their site.
Two entry points, by scope:

```ts
// Single collection — homogeneous results (a dedicated docs / archive box)
const docs = await client.collection('docs').search({
  query: 'fractional indexing',
  where,                 // structured filters AND-merged with the text query
  facets: ['area'],      // optional facet buckets
  populate,              // hits come back as shaped ClientDocuments, optionally populated
  limit, offset,
  status: 'published',   // defaults to published; 'any' for admin
})

// A zone spanning collections — heterogeneous results (one site-wide search box)
const site = await client.search({
  zone: 'site',
  query: 'fractional indexing',
  hydrate: true,         // opt in to shaped ClientDocuments for a rich page; omit for plain rows
  limit, offset,
})

// results: {
//   hits: Array<{
//     collectionPath: string
//     documentId: string
//     title: string
//     path: string | null
//     score: number
//     highlights?: …             // matched snippets — enough for a plain-text row
//     document?: ClientDocument  // present only when `hydrate` / `populate` is requested
//   }>,
//   facets?, total,
// }
```

- **A site search page is a single call.** `client.search({ zone })` (or
  `client.collection(x).search(…)`) returns ranked, shaped documents — the
  developer renders the hits, no indexing plumbing in their app. That ease is the
  whole point of the seam.
- **Two-tier results: rows now, rich items on demand.** Every hit always carries a
  lightweight projection — `collectionPath`, `documentId`, `title`, `path`,
  `score`, and matched-snippet `highlights` — enough to render a plain-text row in
  a long, possibly cross-collection list without hydrating anything. Hydration is
  **opt-in**: pass `hydrate` and core batch-reads the hit ids per collection and
  attaches a shaped `ClientDocument` to each hit — projected to **that collection's
  picker columns** (the sane default across a heterogeneous zone, where a single
  `populate` map can't apply — see [Rendering heterogeneous results](#rendering-heterogeneous-results)).
  A single-collection search, being homogeneous, can instead pass a full `populate`
  map for relation depth. Either way a consumer can also skip hydration and fetch
  the ids itself, batched per collection.
- **Authorization is not bypassable.** The provider returns candidate ids; core
  re-resolves them through the normal read path so `beforeRead` row-scoping and
  published-only rules apply uniformly. The index is a relevance accelerator, not
  an access-control bypass. (For external drivers that can't see scoping, the
  safe default is "rank in the provider, authorise in core.")
- **The admin list-view box** upgrades from `ILIKE` to `provider.search()` for
  free once a provider is registered; `where.query` routes through the same path.
- **MCP** exposes the same surface as a `search` tool — the retrieval verb that
  makes the MCP surface more than `find()`-over-a-wire. Secondary to the SDK, and
  built on it.

## Rendering heterogeneous results

A zone (cross-collection) results page faces a problem Byline **already solves**:
*render an item of collection X as a row or tile.* That is exactly what the
relation picker does — and the proposal is to reuse the same machinery.

Each collection's `CollectionAdminConfig.picker` already declares its row/tile
columns and formatters (thumbnail, title, date, …), drawn by `PickerCell` /
`RelationSummary` — the same components the relation picker and the `hasMany`
relation tiles use. A search results page maps each hit's `collectionPath` to that
collection's picker presentation and renders the hydrated item through it. The
upshot:

- **Heterogeneous result rows come "for free"** from config the host already wrote
  for relations — a publications hit renders in its publication style, a docs hit
  in its docs style, in one mixed list.
- **Item-row presentation stays consistent** across the relation picker, `hasMany`
  tiles, and search results — one definition, three surfaces.
- The lightweight tier still covers consumers that want a **plain** list (or no UI
  at all): `title` + `highlights` render a text row with zero hydration.

**The picker definition is also the projection.** `populate` is keyed by field
name and is inherently per-collection — there is no single `populate` map that
means the same thing across a zone's mixed collections, so it's the wrong tool for
heterogeneous hydration. The picker columns sidestep this: they already declare
exactly the fields a row needs (and relation columns carry a `displayField`). So
hydrating a zone hit means selectively loading *that collection's* picker-column
fields through the existing field-selection read path
(`getDocumentsByDocumentIds({ fields })`) and resolving relation columns through
the [relation column formatter](../04-collections/02-relationships.md) chain. The
picker config therefore does triple duty for search — **what to fetch**
(projection), **how to render** (presentation), per collection, with no
caller-supplied populate. Arbitrary `populate` depth stays available for the
single-collection (homogeneous) case, where one map is well-defined.

Because this config is now a per-collection **item contract** — fetch *and* render
— reused by the relation picker, `hasMany` tiles, and search rows, it is being
generalised from `CollectionAdminConfig.picker` to **`admin.itemView`**, with
`picker` kept as a backwards-compatible alias (decided 2026-06-27). The shape is
unchanged; only the name broadens to match its role.

Layering note: this is an **admin / host-UI** concern that sits *above* the core
search contract. The core `search()` API returns data — rows, ids, and optional
shaped documents — never components, so non-UI consumers (MCP, a JSON HTTP
endpoint) are unaffected. The picker-presentation reuse is how the admin (and host
apps that adopt the same config) turn those rows into a rich page.

## Attachment text-extraction

A sibling pipeline that feeds the index (and downstream retrieval) from uploaded
files. Shape: an **extraction-provider interface** — `file → { markdown, plainText, metadata }`
— so structure-aware, markdown-emitting extractors (Docling-class) and classic
extractors (Apache Tika) are interchangeable drivers, exactly as `SearchProvider`
makes rankers interchangeable. Extracted output lands in its **own table keyed to
the file** (never as synthetic `store_*` field data), invalidated on re-upload,
and is joined into the `SearchDocument.body`. Markdown-first output converges with
the markdown-export surface so attachments and documents share one representation.

## Phasing

0. **Prerequisites — done.** `admin.itemView` (the projection/presentation contract)
   and the relation column formatter + depth-1 list populate both shipped (see
   [Session checkpoint](#session-checkpoint)). Phase 2 builds on them.
1. **This design doc** — pin the interface, the `SearchDocument`, the lifecycle,
   and the query surface. ✅ done.
2. **`SearchProvider` seam + Postgres FTS driver ← next** — the interface in
   `@byline/core`, `@byline/search-postgres`, `ServerConfig.search` registration +
   `initBylineCore()` validation, zone-tagged indexing + collection/zone query
   scoping, lifecycle-hook wiring, the `reindex` command, and the client
   `search()` / `collection().search()` methods. Feeds: text fields + rich-text
   plain text. This is the first shippable slice and already beats the current
   `ILIKE` — and is the surface developers build site search on.
3. **Attachment text-extraction** — the extraction-provider interface + a first
   driver, its own table, and the join into `body`.
4. **External drivers** — a vector and/or hybrid driver against the same seam
   (the RAG payoff; the home for the private BM25 / metadata-ranking work).
5. **MCP `search` tool** — wire the query surface into the MCP server once the
   seam and a driver exist.

## Open questions

- **Zone definition & re-tagging.** Whether zones stay purely emergent from
  per-collection `search.zones` (simplest) or get a lightweight registry (display
  labels, a declared default zone, validation that referenced zones exist).
  Changing a collection's zone membership requires re-tagging its documents — a
  cheap `reindex` (no text re-extraction) — but it needs a trigger.
- **Relation columns in projected rows.** A picker-projected search row that
  includes a relation column reuses the **relation column formatter** (resolves a
  relation target's `useAsTitle`), which already ships for list views
  (`relationColumnFormatter`, `@byline/admin/react`). Search-result rows that
  include relation columns will need the list read's depth-1 relation populate
  applied to the hydration step too.
- **Facets over EAV.** How facetable fields map from the EAV store to the index
  without re-flattening — likely the same `search`-config projection that builds
  `body`, but the cardinality/typing story needs design.
- **Per-locale indexing.** One `SearchDocument` per (document, locale); query-time
  locale scoping. Confirm the FTS `regconfig` (language) is chosen per content
  locale.
- **Multi-tenant scoping at scale.** "Rank in provider, authorise in core" is
  correct but can over-fetch when scoping is highly selective; whether providers
  should accept a scoping predicate (the `beforeRead` `QueryPredicate`) is a
  driver-capability question.
- **Reindex cost.** Backfilling a large installation through the client read path
  needs batching / throttling; whether `reindex` streams or runs as a background
  job.
