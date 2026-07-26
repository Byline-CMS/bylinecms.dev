---
title: "Search provider contract"
path: "search-provider-contract"
summary: "Reference for SearchProvider, SearchDocument, capability declarations, provider responsibilities, and the shared conformance suites."
---

# Search provider contract

Companions:
- [Search](./index.md) — the architecture around the provider boundary.
- [Search API](./03-search-api.md) — the client surfaces that construct provider queries and finish provider results.
- [Portable multilingual analysis](./05-portable-analysis.md) — providers can use Byline's portable analyzer or declare native analysis.
- [PostgreSQL and MySQL providers](./06-postgres-and-mysql.md) — the two complete built-in implementations of this contract.

`SearchProvider` is the adapter boundary between Byline's document lifecycle and a physical search engine. Read this page when you are implementing another provider, reviewing what core guarantees, or deciding whether an engine-specific feature belongs in the shared contract.

## Provider interface

The interface lives in `@byline/core`.

```ts
interface SearchProvider {
  readonly capabilities: SearchCapabilities

  upsert(doc: SearchDocument): Promise<void>

  remove(ref: {
    collectionPath: string
    documentId: string
    locale?: string
  }): Promise<void>

  search(query: SearchQuery): Promise<SearchResults>

  reindex(opts: {
    collectionPath?: string
  }): Promise<void>
}
```

### `upsert`

Add or replace one locale projection. The operation must be idempotent on `(collectionPath, documentId, locale)`.

Portable providers must reject a write when its analyzer fingerprint differs from the collection metadata already stored in the active index.

### `remove`

Remove one locale when `locale` is present, or all locales for a document when it is absent. Calling `remove` for a missing row should succeed.

### `search`

Return ranked lightweight hits and the provider-level total. A provider applies physical text matching, collection or zone scope, locale, status, pagination, and every optional feature it declares.

The client applies collection abilities, row authorization, stale-hit removal, and optional hydration after this method returns.

### `reindex`

Clear one collection slice when `collectionPath` is present, or clear the complete derived index when it is absent. This operation does not read source documents. `CollectionHandle.reindex()` performs the higher-level clear and repopulate workflow.

## Search document

Core assembles one `SearchDocument` for one document and locale:

```ts
interface SearchDocument {
  collectionPath: string
  documentId: string
  locale: string
  status: string
  zones: string[]
  title: string
  path: string | null
  fields: SearchField[]
  updatedAt: string
}

interface SearchField {
  name: string
  type: 'text' | 'keyword' | 'integer' | 'float' | 'boolean' | 'datetime' | 'facet'
  role: 'body' | 'facet' | 'filter'
  value: string | number | boolean | SearchFacetValue[] | null
  boost?: number
}

interface SearchFacetValue {
  id: number | string
  term: string
}
```

The projection is complete enough for a provider to map fields onto SQL columns, Solr dynamic fields, or another engine's payload without reading collection schemas or EAV rows.

The roles are behavioral:

- `body` values participate in full-text matching and scoring;
- `facet` values carry a stable id and a searchable label; and
- `filter` values are typed but unscored.

`title` is lightweight display metadata. It is not automatically a body term.

## Query and result boundary

At the provider boundary, a query may be scoped to either `collectionPath` or `zone`.

```ts
interface SearchQuery {
  query: string
  matching?: SearchMatching
  zone?: string
  collectionPath?: string
  where?: QueryPredicate
  facets?: string[]
  locale?: string
  status?: 'published' | 'any'
  limit?: number
  offset?: number
}
```

The provider returns:

```ts
interface SearchResults {
  hits: SearchHit[]
  total: number
  facets?: Record<string, SearchFacetBucket[]>
}
```

`SearchQuery.query` is limited to 1,024 UTF-16 code units. The client and portable analyzer both enforce the limit, so a direct provider implementation should not rely on route-level validation.

## Capabilities

Capabilities are a runtime contract, not a product roadmap:

```ts
interface SearchCapabilities {
  facets: boolean
  typoTolerance: boolean
  semantic: boolean
  bm25: boolean
  weighting: boolean
  highlights: boolean
  fullText: {
    nativeAnalysis: boolean
    portableAnalysis: boolean
    allTerms: boolean
    anyTerms: boolean
    minimumShouldMatch: boolean
    phrase: boolean
  }
}
```

A provider must declare at least one analysis strategy:

- `nativeAnalysis` means the backend analyzes original text itself.
- `portableAnalysis` means the provider indexes application-produced logical terms.

An engine may support both, but one configured provider instance must behave consistently for index and query operations.

Do not infer BM25 from the existence of a relevance score. Set `bm25: true` only when the provider offers a stable BM25-quality ranking contract. Do not set `facets: true` because facet values are stored; the provider must compute and return buckets.

## Provider responsibilities

A complete provider owns:

- its physical schema or external index configuration;
- schema migration or provisioning;
- document upsert and removal;
- collection and zone scoping;
- locale and published-status filtering;
- query translation;
- deterministic pagination order;
- relevance scoring;
- highlighted snippets when declared;
- analyzer consistency when using portable terms; and
- accurate capability declarations.

Core and client own:

- collection schema validation;
- document assembly;
- published-view reads;
- lifecycle orchestration;
- collection abilities;
- `beforeRead` row authorization;
- `afterRead` transformations;
- result hydration; and
- the application-facing query API.

A provider should not read source CMS tables or attempt to reproduce the authorization pipeline.

## Portable and native analysis

The built-in SQL providers accept an optional `PortableSearchAnalyzer` and store the analyzer fingerprint per collection.

An external engine with mature native analyzers can instead index original `SearchDocument` body values and translate `SearchMatching` into its own query language. It must still preserve the public matching behavior it advertises.

For example, a Solr provider can:

- store one Solr document for each `(collectionPath, documentId, locale)`;
- map body weight classes to fixed query fields;
- map facet ids to multivalued exact fields;
- filter locale, status, collection, and zones;
- use Solr's native language analyzers; and
- return the shared lightweight hit shape.

The Solr configset is that provider's schema artifact. The requirement that a provider owns its schema does not imply SQL.

## Conformance

`@byline/search-conformance` is a private workspace package containing backend-neutral Vitest suites. A complete adapter registers:

```ts
runSearchProviderConformanceSuite({
  createProvider,
  createPortableProvider,
  expectedCapabilities: {
    weighting: true,
    highlights: true,
  },
  migrate,
  reset,
  teardown,
})
```

The shared suites cover:

- capability declarations;
- idempotent upsert and removal;
- collection and global clears;
- collection, zone, locale, status, and pagination scope;
- all, any, minimum-should-match, and phrase behavior;
- highlighted snippets;
- Unicode normalization and SQL stopwords;
- identifiers and constituent recall;
- language expansion;
- Han-bigram fallback;
- relative field weighting; and
- analyzer mismatch and rebuild enforcement.

Conformance does not compare raw scores across engines. It asserts positive ranking and relative order where the contract requires it.
