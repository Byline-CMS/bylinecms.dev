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
  fieldScope?: string[]
  matching?: SearchMatching
  zone?: string
  collectionPath?: string
  where?: QueryPredicate
  facets?: string[]
  rangeFacets?: SearchRangeFacetRequest[]
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
  rangeFacets?: Record<string, SearchRangeFacetBucket[]>
}
```

`SearchQuery.query` is limited to 1,024 UTF-16 code units. The client and portable analyzer both enforce the limit, so a direct provider implementation should not rely on route-level validation.

### Integer range facets

A range facet counts matches in contiguous numeric intervals. Use it for a histogram over a collection's integer `search.filters` field. `@byline/core` exports the request, bucket, and limit:

```ts
interface SearchRangeFacetRequest {
  field: string
  start: number // inclusive
  end: number // exclusive
  gap: number
}

interface SearchRangeFacetBucket {
  start: number
  end: number
  count: number
}

const MAX_RANGE_FACET_BUCKETS = 200
```

The client rejects invalid requests with `ERR_VALIDATION` before calling the provider. A non-empty request requires `capabilities.rangeFacets === true`. Each request must have finite `start`, `end`, and `gap` values, `gap > 0`, `end > start`, and `ceil((end - start) / gap) <= MAX_RANGE_FACET_BUCKETS`. An omitted option or empty array requests no range aggregates.

The integer-only restriction applies to the field type. `start`, `end`, and `gap` are finite numbers and need not be integers. A provider that cannot represent non-integer bounds or gaps must reject the request explicitly rather than round, truncate, or otherwise silently change the requested intervals.

Results are keyed by the logical `field` name, so a request array cannot contain duplicate fields. Each field must be declared in `search.filters` and resolve to a top-level schema field of type `integer`. Float, date, datetime, unknown, and other field types are rejected. For a zone, the field must meet this rule in every member collection, including members the reader cannot access: the provider still queries the whole zone.

Providers return every bucket in ascending order, including zero counts. Buckets cover exactly `[start, end)`; the last bucket ends at the requested `end` even when the interval is not divisible by `gap`. For example, `{ start: 0, end: 25, gap: 10 }` requires `[0, 10)`, `[10, 20)`, and `[20, 25)`. A Solr implementation must use `hardend: true` to preserve this boundary. A provider must reject an unsupported range-facet request rather than ignore it.

Counts respect `query`, `where`, `locale`, `status`, and the collection or zone scope, independently of hit pagination. The client forwards requests and passes returned buckets through without recomputing them. When `beforeRead` row scoping or unreadable zone members restrict aggregates, the client omits both `facets` and `rangeFacets` and returns the retained-hit total.

## Capabilities

Capabilities are a runtime contract, not a product roadmap:

```ts
interface SearchCapabilities {
  facets: boolean
  rangeFacets?: boolean
  structuredFilters?: boolean
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
    fieldScope?: boolean
  }
}
```

A provider must declare at least one analysis strategy:

- `nativeAnalysis` means the backend analyzes original text itself.
- `portableAnalysis` means the provider indexes application-produced logical terms.

An engine may support both, but one configured provider instance must behave consistently for index and query operations.

Do not infer BM25 from the existence of a relevance score. Set `bm25: true` only when the provider offers a stable BM25-quality ranking contract. Do not set `facets: true` because facet values are stored; the provider must compute and return buckets.

Set `fullText.fieldScope: true` only when the provider preserves logical `SearchField.name` values for body fields and restricts matching to the requested names. An omitted capability is treated as `false` so existing third-party providers remain source-compatible. A scope is expressed in collection-schema field paths, never in physical engine field names. Unsupported scopes must fail explicitly; silently falling back to the complete body changes the meaning of the query.

`rangeFacets` and `structuredFilters` are also optional; omission means false. Set `rangeFacets: true` only when the provider implements the integer range contract above. The built-in PostgreSQL and MySQL providers leave both capabilities unset.

`structuredFilters: true` promises that the provider applies `SearchQuery.where`. A provider may support a documented subset of fields and predicate operators, but must reject any unsupported field or operator rather than silently ignore part of a predicate. This flag is advertise-only: the client continues forwarding `where` even when the flag is absent, preserving existing callers. Hosts that require filtered search must check the flag themselves. Neither built-in SQL provider currently applies `where`.

## Provider responsibilities

A complete provider owns:

- its physical schema or external index configuration;
- schema migration or provisioning;
- document upsert and removal;
- collection and zone scoping;
- locale and published-status filtering;
- query translation;
- named body-field scoping when declared;
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
