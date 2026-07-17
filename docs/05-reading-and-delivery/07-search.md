---
title: "Search & Retrieval"
path: "search"
summary: "A pluggable SearchProvider seam with built-in Postgres full-text search, collection and zone queries, optional hydration, and strict post-ranking row authorization. Lifecycle hooks keep the published index live; BM25/vector/hybrid drivers and attachment extraction are future phases."
---

# Search & Retrieval

:::note[Partly shipped]
The `SearchProvider` seam, the built-in Postgres full-text driver, the
type-enriched `SearchDocument` + assembler, lifecycle-hook indexing, the
`reindex` command + admin button, the single-collection
`client.collection(x).search()` query surface, the cross-collection **zone**
entry point, **`hydrate`** (two-tier rich results), and **row-level
authorization** on search are **shipped** (Phase 2). Still planned:
**structured `where`** filtering and **facet aggregation** at query time,
**driver-specific query extensions** (the typed escape hatch),
**attachment text-extraction** (Phase 3), **external drivers** (Phase 4),
and the **MCP** tool (Phase 5). Each section
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
5. **`client.collection(x).search()`** and **`client.search({ zone })`** are
   the developer query surfaces, with optional `hydrate: true`; the docs
   frontend (drawer modal → `/docs/search?q=` results route) is the worked
   collection-scoped example.

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
  `bm25` are `false` until a richer driver (or capability) lands. Consumers
  light up features against it rather than assuming — which also makes driver
  degradation *deliberate*: a UI can hide facet chips when the registered
  driver can't aggregate, instead of silently returning less.
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

> The admin list-view search box is a separate, deliberately lightweight
> concern: a `store_text` `ILIKE` match (`storage-queries.ts`) over the
> schema-level `listSearch` field names, falling back to the collection's
> identity field (`useAsTitle`, else its first text field) when omitted. It no
> longer reads `search.body` — `search` configures provider indexing only, so a
> collection can opt out of the index without losing list-view search, and a
> heavily-weighted `body` declaration doesn't drag six `ILIKE` clauses into the
> admin's per-keystroke query.

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

## Mapping the seam to Solr (design study)

Solr is the sharpest available test of the seam's portability claim — an
engine with its own schema model (dynamic fields), its own query language
(eDisMax), and no SQL — so it is worth walking the full mapping. The
conclusions double as a checklist for any external driver (Phase 4):

- **The projection suffices.** `SearchField.type` / `role` map directly onto
  Solr dynamic fields — `body` text → `*_txts_{lang}` (per-language
  analyzers), facet ids → `{name}_tim` (multivalued int), filters → `_i` /
  `_f` / `_b` / `_dt` / `_s` — with no re-inspection of collection schemas.
  The type enrichment in `SearchDocument` exists precisely so this table can
  be written once per driver.
- **Weight classes travel.** Solr removed index-time boosts in 7.x, so
  `SearchField.boost` is realised the same way the Postgres driver maps
  boosts to `setweight` classes: bucket body text into four per-class
  catch-all fields at index time (`body_a_txts_{lang}` … `body_d_…`) and
  carry a fixed eDisMax `qf` (`^8 ^4 ^2 ^1`) on every query.
  `capabilities.weighting` holds without the driver needing collection
  config at query time — the bucketing convention *is* the contract, and it
  generalises: `setweight` classes and `qf`-boosted catch-alls are the same
  idea on different engines.
- **Facet aggregation is reachable at the seam.** The projected `counter` ids
  aggregate via the JSON Facet API over `{name}_tim`; buckets come back as
  stable ids in the shared `SearchFacetBucket` shape. A Solr driver declares
  `capabilities.facets: true` (and `bm25: true` — Lucene's default
  similarity) — the first entries of the capabilities matrix the Postgres
  floor leaves `false`.
- **Document grain.** One Solr document per
  `(collectionPath, documentId, locale)`, with the triple as the Solr id —
  the seam's idempotent `upsert` key. Hand-rolled Solr integrations often
  index one document per source doc with locale-suffixed fields side by
  side; the per-locale grain is what the seam's contract implies, and
  locale-scoped queries filter on the locale field instead. Per-locale
  analyzers ride a locale → language-suffix resolver mirroring the Postgres
  driver's `localeRegconfig`.
- **Schema ownership without `migrate()`.** The index schema is the
  deployment's Solr configset (dynamic fields), applied by provisioning the
  core. The "driver owns its schema" rule is about *responsibility*, not
  about SQL migrations — a driver whose engine has no DDL simply documents
  and ships its schema artifact instead.
- **What the mapping can't reach yet.** Attachment text (classic Solr Cell /
  Tika extract-handler territory) waits for Phase 3's extraction providers;
  structured `where` needs the predicate pushdown; and Solr's
  engine-specific power (boost functions, suggesters, facet pivots) is the
  motivating case for
  [driver-specific query options](#driver-specific-query-options-the-typed-escape-hatch)
  below.

## Index lifecycle (shipped)

Indexing is **published-only** and **event-driven**, hung off the same
collection lifecycle hooks that drive L1 cache invalidation. The orchestration
lives in **`@byline/client`** (the provider is a sink; it can't read source
documents). Index maintenance deliberately uses `_bypassBeforeRead` and indexes
**every published document**; actor-specific row authorization happens after
provider ranking, never by baking one actor's visibility into the shared index.
A collection's `hooks.ts` calls:

| Hook | Action |
|---|---|
| `afterCreate` / `afterUpdate` / `afterStatusChange` / `afterUnpublish` | `client.collection(p).indexDocument(id)` |
| `afterSystemFieldsChange` with a path request (including no-op reconciliation) | `client.collection(p).indexDocument(id)` |
| advertised-locale-only system change | no search write in the reference app |
| `afterDelete` | `client.collection(p).removeFromIndex(id)` |
| `afterTreeChange` | no reindex unless the provider stores tree-derived hierarchy |

`indexDocument` is a **re-sync by read**: for each content locale it reads the
document's *published* view (`status: 'published'`, `onMissingLocale: 'omit'`,
`_bypassBeforeRead`) and `upsert`s where present, `remove`s where absent. This
one path handles publish, unpublish, draft-over-published, and plain edits
uniformly and idempotently — the index mirrors published status/locale content
for all rows, while actor-specific visibility is enforced after ranking.
`removeFromIndex` drops all locales. The `docs` collection wires this as the
worked example (`apps/webapp/byline/collections/docs/hooks.ts`).
Unlike `reindex`, `removeFromIndex` does not assert an ability itself; keep it
behind trusted lifecycle or tooling code and use the system-client convention.

:::warning[Index from a system client, not the request-scoped one]
Resolve the indexing client with `getSystemBylineClient()` (super-admin context,
no session cookies) — **not** `getAdminBylineClient()`. The request-scoped admin
client reads the session cookie via the TanStack Start server runtime, so calling
it from a lifecycle hook couples that hook to a live HTTP request and throws
`No StartEvent found in AsyncLocalStorage` from every out-of-band write path:
import scripts, seeds, migrations, the CLI, and tests. Indexing is background
maintenance — it reads the published view and `_bypassBeforeRead` — so the
system context is both correct and runtime-agnostic. (Both helpers live in
`@byline/client/server`.)
:::

**Indexing is awaited** inside the post-commit hook, but is not part of the
source DB transaction. On create/update/status/system-field/tree operations, a
provider/hook failure therefore rejects the call after source data may already
have committed, leaving a stale index until reconciliation. System-field and
tree no-op retries have explicit reconciliation options. Delete is the exception:
the committed DB/audit result is not rejected by `afterDelete` search/cache
failure; the lifecycle returns `committed-with-side-effect-failures`, the host
sanitizes the reported phase/code, and the admin navigates away with a warning.
There is no retry-by-delete path. The reference app attempts search and cache
effects independently and aggregates failures, but a durable outbox/queue (also
needed so a slow network driver does not stall a publish) remains deferred.

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
  status: 'published',   // defaults to published
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
accepts `status: 'any'`, but the framework lifecycle indexes published views
only, so this does not make drafts appear in the built-in index; it only relaxes
the provider filter for rows a custom indexing path may have supplied. It
returns the **lightweight hit tier** — `title`, `path`, `score`, and
matched-snippet `highlights` — enough to render a results list without
hydration. Lightweight hits themselves are not document materializations, so
`afterRead` does not transform them; when row authorization requires an internal
projected re-read, that fresh internal document still runs its normal hook.
Use `hydrate: true` when the returned result must carry an actor-redacted
`ClientDocument`.

### Row-level authorization — "rank in the provider, authorise in core"

When the collection configures a [`beforeRead` row-scoping](../06-auth-and-security/01-authn-authz.md)
hook, `search()` re-resolves the provider's candidate hits through the **normal
read path**: the hook predicate and its strict compiled filters are promise-cached
once per collection/read mode in module-private state bound to the request
authority, then combined with the `id: { $in: candidateIds }` filters compiled
from the caller query. Concurrent search/hydration/populate branches therefore
share one in-flight security compilation, including relation-id resolution.
Caller-preseeded `ReadContext.beforeReadCache` data is ignored, and reusing a
`ReadContext` under a different actor authority fails with `ERR_VALIDATION`.
Hits whose
document doesn't survive the scoping are dropped before the results are
returned, so owner-only drafts, multi-tenant isolation, department visibility
and the other `beforeRead` recipes hold on search exactly as they do on
`find()`. Collections without a hook (the public docs case) skip the second
query entirely — the published-only index is already safe there and pays no
extra cost.

Filtering **after** ranking has deliberate aggregate semantics:

- When a collection predicate is active, or a zone excludes unreadable member
  collections, `total` is the number of authorized hits surviving **this
  provider page**, not a corpus-wide authorized total, and facets are omitted
  rather than leaking provider-wide counts.
- A page can therefore be shorter than `limit`; paginate using the provider
  `offset`, not the received length. Exact authorized paging/totals require
  pushing the predicate into a capable provider.
- Without an authorization restriction, provider `total` / facets pass through
  (even though hydration may independently discard a stale hit).

Security predicates are compiled in strict mode before they are trusted:
unsupported fields/operators or malformed values throw instead of being
silently dropped. `_bypassBeforeRead: true` is reserved for indexing and trusted
system/admin tooling. It skips row predicates only — it does not skip collection
`read` abilities, zone membership/readability checks, status scoping, or
`afterRead`. Integration coverage lives in
`packages/client/tests/integration/client-search-auth.integration.test.ts`.

The docs frontend is the worked example: a drawer-modal search box →
`/<lng>/docs/search?q=` SSR results route → `client.collection('docs').search()`
→ hits rendered with canonical hierarchical URLs (resolved via the cached nav
tree) and safely-rendered `ts_headline` snippets.

### Zone (cross-collection) search — `client.search({ zone })` (shipped)

The second query entry point, for heterogeneous hits ranked together across
every collection indexed into a named zone:

```ts
const results = await client.search({ zone: 'site', query: 'launch', hydrate: true })
// results.hits: HydratedSearchHit[] — each carries collectionPath (+ document with hydrate)
```

Zone **membership** is resolved from the runtime collection definitions with
the same rule the indexing assembler applies (`resolveSearchZones`:
`search.zones`, defaulting to the collection's own path), so the query scope
and the index contents can't drift. Per-member **read abilities** apply:
collections the actor cannot `read` are excluded from the results, and the
ability error surfaces only when the actor can read *none* of the zone's
members. An unknown zone throws `ERR_VALIDATION`. Each readable member's
`beforeRead` predicate is strict-validated, then provider hits are authorized
per collection after ranking. Any excluded member/predicate suppresses provider
facets and changes `total` to the current page's surviving authorized hit count.

### `hydrate` — two-tier rich results (shipped)

Both entry points take `hydrate: true`: core batch-reads each collection's hit
ids through the normal read path and attaches a shaped `ClientDocument` as
`hit.document`. Projection is the collection's `admin.itemView` columns when
that config is registered in the calling runtime, otherwise the full field
set. Because the batch-read *is* an ordinary scoped read, authorisation comes
free in the same query — and hits whose document no longer resolves (a stale
index entry after an unindexed delete, or a row dropped by scoping) are
removed. Every freshly hydrated document runs `afterRead` with the actor-aware
request context before attachment, so its mutations/redactions are visible in
`hit.document`. Both entry points share one finishing pipeline
(`packages/client/src/search.ts` → `finalizeSearchHits`); integration
coverage: `client-zone-search.integration.test.ts`.

### Driver-specific query options — the typed escape hatch

*Planned — design settled; needs the one-field core change plus a client
pass-through test.*

Every adapter seam creates lowest-common-denominator pressure: provider-
specific power (Solr boost functions, spellcheck / suggesters, facet pivots,
MLT; a vector driver's ANN parameters) doesn't fit `SearchQuery`, and if the
seam offers no sanctioned outlet, call sites reach around it. The failure
mode is well-worn in hand-rolled CMS + search-engine integrations: a frontend
that queries the engine directly — to get per-request field routing
(`title:` / `author:` prefix searches) or a recency sort — ends up
re-encoding the index schema in frontend string constants (field lists that
must track fields *and* locales), hand-rolling the id → document hydration
read, and usually losing ranked order along the way. Three copies of
knowledge the seam exists to keep in one place.

The escape hatch keeps that power **inside the pipeline**, via declaration
merging. Core declares an empty, provider-agnostic slot — and that is the
whole core change; core never interprets it:

```ts
// @byline/core
export interface SearchDriverExtensions {}

interface SearchQuery {
  // …
  /**
   * Driver-specific extensions, namespaced by driver key. Core and the
   * client pass this through verbatim. Must stay JSON-serializable —
   * queries travel over the REST transport and (later) MCP.
   */
  driver?: SearchDriverExtensions
}
```

Each driver package augments the slot under its own key, so merely depending
on the driver lights up its options in the host's editor:

```ts
// a Solr driver package (illustrative)
export interface SolrQueryOptions {
  fields?: string[]      // restrict scoring to specific body fields
  boostFunction?: string // additive bf, e.g. recency decay
  sort?: string          // override relevance order (browse views)
}

declare module '@byline/core' {
  interface SearchDriverExtensions {
    solr?: SolrQueryOptions
  }
}
```

```ts
// host call site
client.collection('publications').search({
  query,
  driver: { solr: { fields: ['title'] } },
})
```

Namespacing is the degradation story: a driver ignores keys it doesn't own,
so a query carrying `driver.solr` runs unmodified on the Postgres driver —
the search loses its tuning, not its correctness. The client's only job is to
forward `driver` verbatim through both entry points, pinned by a test so the
pass-through is a contract rather than an accident.

Two boundary rules keep the hatch from rotting into the legacy reach-around:

- **Promote before you extend.** An option a second driver would plausibly
  want is generic — it belongs on `SearchQuery` proper (capability-gated
  where not universal), not in the bag. Field-scoped search and sort
  overrides are already promotion candidates. The smell test: *would a future
  vector driver want this too?*
- **Never bypass the pipeline.** The hatch rides *inside* the query, so every
  search — however tuned — still exits through `finalizeSearchHits`
  (authorization, stale-hit dropping, hydration). Exporting the concrete
  provider for direct index calls is fine for admin diagnostics and tooling,
  but it is not a sanctioned read path — per-call-site bypass is exactly how
  the duplication described above takes hold.

### Planned (not yet shipped)

- **Structured `where` filtering** and **facet aggregation** at query time — the
  options are accepted in the API, but the Postgres driver does not yet apply
  `where` or compute facet buckets (`capabilities.facets === false`; the
  [Solr design study](#mapping-the-seam-to-solr-design-study) shows the
  aggregation path at the seam).
- **Driver-specific query extensions** — the `SearchQuery.driver` slot
  ([the typed escape hatch](#driver-specific-query-options-the-typed-escape-hatch) above).
- **MCP** exposes the same surface as a `search` tool (Phase 5).

## Search zones

A **zone** is a named search scope. Collections declare zone membership in their
`search` config; `SearchDocument.zones` is the resolved set (default: a single
implicit zone equal to the collection path — `resolveSearchZones` in
`@byline/core`). The Postgres driver filters on it (`zones @> ARRAY[$zone]`),
and the cross-collection client entry point (`client.search({ zone })`,
heterogeneous ranked hits) queries it — see above.

## Rendering heterogeneous results

A zone (cross-collection) results page faces a problem Byline already solves:
*render an item of collection X as a row or tile* — exactly what the relation
picker does. The approach reuses **`admin.itemView`** (the generalised `picker`
config): map each hit's `collectionPath` to that collection's item-view
presentation and render the hydrated item through it, so heterogeneous result
rows come "for free" from config the host already wrote for relations. The
`itemView` config does triple duty — *what to fetch* (projection) and *how to
render* (presentation), per collection — reused by the relation picker, `hasMany`
tiles, and search rows.

The **data half is shipped**: `hydrate: true` projects each hit's document to
its collection's `itemView` columns when the admin config is registered in the
calling runtime (see [`hydrate`](#hydrate-two-tier-rich-results-shipped)). The
**presentation half** — a host-UI component that dispatches each hydrated hit
to its collection's item-view renderer — is an admin / host-UI concern above
the core contract: `search()` returns data (rows, ids, optional shaped
documents), never components, so non-UI consumers (MCP, a JSON endpoint) are
unaffected.

## Attachment text-extraction

*Planned — Phase 3.* A sibling pipeline that feeds the index (and downstream retrieval) from uploaded
files: an **extraction-provider interface** — `file → { markdown, plainText,
metadata }` — so structure-aware, markdown-emitting extractors (Docling-class)
and classic extractors (Apache Tika) are interchangeable drivers, exactly as
`SearchProvider` makes rankers interchangeable. Implementations are thin HTTP
clients against extraction services (a Tika server, docling-serve, a hosted
VLM endpoint). The full landscape, tiered strategy (fast / local-ML / VLM),
page-level routing, and licensing analysis live in the
[search and document extraction strategy](./08-search-extraction-strategy.md).

### A sibling seam, not a search-driver sub-module

The tempting shape — extractors configured *inside* each search provider,
invoked during indexing — is wrong, because it couples three things that
want different lifecycles:

- **Extraction is expensive and cacheable; indexing is cheap and
  re-runnable.** The index lifecycle leans on `upsert` being safe to repeat —
  `reindex` re-reads everything. Extraction inside a driver's upsert path
  means every rebuild re-extracts every file; tolerable for Tika at small
  scale, prohibitive when an extractor costs seconds-to-minutes and real
  money per document. Hand-rolled CMS + Solr integrations commonly do
  exactly this (Solr Cell's `extractOnly=true` used as an inline extraction
  service, output merged into the update, re-extracted on every reindex,
  failures swallowed mid-indexing) — the pattern to design away from. Solr
  Cell being provider-internal is a property of *one possible extractor*,
  not a reason to shape the architecture around it.
- **The N×M problem.** Extractor config inside providers means every driver
  (Postgres, Solr, a future vector/hybrid) re-integrates it. But extracted
  text, once it exists, is *just another body field* — it enters through
  `SearchDocument` like any text field does. One extraction pipeline; every
  driver consumes it with **zero changes**.
- **Search is not the only consumer.** `markdown` output feeds RAG, the
  [markdown export surface](./04-markdown-export.md), and MCP; `plainText`
  feeds the index. Extraction locked inside a search driver strands the
  markdown half.

### Persistence and lifecycle

- **Extracted output lands in its own table** keyed to the file — content
  hash + extractor id/version, never as synthetic `store_*` data — so a
  re-upload invalidates it and an extractor upgrade can selectively
  re-extract. The same schema-ownership pattern as
  `byline_search_documents`.
- **Extraction runs asynchronously off the upload lifecycle** — a publish
  must never block on a VLM. On completion it triggers the owning document's
  `indexDocument` re-sync (the same one path that already handles
  publish/unpublish/edit). This trigger is the same machinery the deferred
  async/outbox indexing wants — design them together.
- **A backfill command** (the `reindex` analog) extracts an existing corpus.
- **Language routing**: the extraction record carries a detected or declared
  language, so the assembler can fold the text into the matching locale's
  `SearchDocument` — attachments in different languages land in the right
  per-locale index entries.

### The extractor router is a composition of the seam

Tiered routing — born-digital text documents through a fast classic
extractor, scanned or chart/table-heavy documents through a structure-aware
one — is not special machinery: a **router is itself an
`ExtractionProvider`** that delegates. Routing signals: mime type, PDF
text-layer presence (the born-digital test), page count / image density,
per-collection config, cost budget. A cheap refinement the seam enables:
**escalation** — run the fast extractor first, score the output (text-density
heuristics), and escalate to the structure-aware tier only when the cheap
pass looks like a scan. No search driver ever knows any of it happened.

### The join into the index

The join point is `buildSearchDocument` — the already-documented third
`body` feed. Upload fields named in the collection's `search` config
contribute their files' persisted `plainText` as low-weight body fields
(the lightest weight class is the natural home, so attachment matches never
outrank title/summary matches). Search drivers are unchanged by
construction — which is the proof the seam boundary is drawn correctly.

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
   results route; cross-collection `zone` search, `hydrate`, and strict
   post-ranking row authorization. **Deferred within Phase 2:** provider-side
   structured `where` filtering, facet aggregation, and async/outbox indexing.
3. **Attachment text-extraction** — the extraction-provider interface + a first
   driver, its own table, and the join into `body`. *(Planned.)*
4. **External drivers** — a vector and/or hybrid driver against the same seam
   (the RAG payoff; the home for the private BM25 / metadata-ranking work).
   *(Planned — the
   [Solr design study](#mapping-the-seam-to-solr-design-study) walks the
   seam mapping end-to-end, including facet aggregation, as the template for
   any external driver.)*
5. **MCP `search` tool** — wire the query surface into the MCP server. *(Planned.)*

## Open questions

- **Resolved — per-locale indexing / `regconfig`.** Shipped: one `SearchDocument`
  per `(document, locale)`, indexed with a per-locale `regconfig`, plus a
  `defaultLocale` for locale-less queries.
- **Resolved — awaited indexing for the Postgres driver.** Shipped inline in the
  post-commit lifecycle hook. Async/durable outbox support remains open.
- **Partly resolved — facets over EAV.** The `{ id, term }` projection is built
  and indexed (term searchable, id stored). Facet *aggregation queries* remain
  open for the Postgres driver (`capabilities.facets === false`) — but the
  [Solr design study](#mapping-the-seam-to-solr-design-study) shows the
  aggregation path at the seam (JSON Facet API over the projected `counter`
  ids returning the shared `SearchFacetBucket` shape), so what's left is
  Postgres-side implementation, not design.
- **Settled in design — driver-specific query extensions.** The
  declaration-merged `SearchQuery.driver` slot (see
  [the typed escape hatch](#driver-specific-query-options-the-typed-escape-hatch)):
  core declares the empty `SearchDriverExtensions` interface + one optional
  field, the client forwards it verbatim (pinned by test), drivers augment it
  namespaced by key. Open governance question: when to *promote* an option
  from a driver bag to `SearchQuery` proper — field-scoped search and sort
  overrides are the first candidates.
- **Resolved — row-level authorization on search.** "Rank in provider,
  authorise in core" shipped: `search()` strict-validates and re-resolves
  candidate hit ids through the normal read path when a collection has a
  `beforeRead` hook (see [Row-level authorization](#row-level-authorization-rank-in-the-provider-authorise-in-core)).
  Restricted results suppress provider facets and report the surviving count
  for the current provider page. **Still open — exact paging and corpus totals
  under scoping:** post-ranking filtering can produce short pages and offset
  drift. The exact alternative is to push the `QueryPredicate` down into the
  provider (see *Multi-tenant scoping at scale* below), which only works if the
  scoping columns are indexed.
- **Zone definition & re-tagging.** Whether zones stay emergent from
  per-collection `search.zones` or get a lightweight registry (display labels, a
  declared default, validation). Re-tagging on a membership change is a cheap
  `reindex` (no text re-extraction) but needs a trigger. (The cross-collection
  query entry point shipped — membership resolves from the runtime definitions
  via `resolveSearchZones`.)
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
  the `collections.<path>.reindex` ability and the `beforeRead`
  row-scoping that search honours.
- [Search and document extraction strategy](./08-search-extraction-strategy.md) —
  forward-looking landscape + tiered strategy for Phases 3–4 (attachment
  extraction, external drivers).
