---
title: "Search API"
path: "search-api"
summary: "Reference for collection and zone search, matching options, ranked hits, highlighted snippets, hydration, authorization, and current query limits."
---

# Search API

Companions:
- [Client SDK](../05-reading-and-delivery/01-client-sdk.md) — search uses the same configured `BylineClient` and request context as other reads.
- [Portable multilingual analysis](./05-portable-analysis.md) — the analyzer interprets matching policy and converts query text into portable concepts.
- [Authentication and authorization](../07-auth-and-security/01-authn-authz.md) — collection abilities and `beforeRead` predicates finish provider results.
- [PostgreSQL and MySQL providers](./06-postgres-and-mysql.md) — both built-in providers implement the matching and highlighting behavior described here.

Byline exposes two search entry points: one for a single collection and one for a named zone containing several collections. Both return provider-ranked lightweight hits and can optionally attach documents through the normal read pipeline.

## Collection search

Use a collection handle when every hit has the same collection schema.

```ts
const result = await client.collection('docs').search({
  query: '"fractional indexing" arrays',
  matching: {
    operator: 'all',
    phrase: 'auto',
  },
  locale: 'en',
  limit: 20,
  offset: 0,
})
```

`CollectionHandle.search()`:

- asserts the collection's `read` ability;
- adds the collection path to the provider query;
- defaults locale to the client's default locale;
- defaults status to `published`;
- rejects queries above 1,024 UTF-16 code units;
- asks the provider to rank candidates; and
- applies row authorization and optional hydration before returning.

## Zone search

Use the client entry point when several collections should rank in one result set.

```ts
const result = await client.search({
  zone: 'site',
  query: 'forest restoration',
  locale: 'en',
  hydrate: true,
  limit: 20,
})
```

Zone membership comes from each collection's `search.zones`. A collection without explicit zones belongs to the implicit zone named after its own path.

An unknown zone throws `ERR_VALIDATION`. Collections the actor cannot read are excluded. The call throws the first collection ability error only when the actor cannot read any member of the zone.

Every zone hit includes `collectionPath`, so a caller can dispatch heterogeneous results to collection-specific presentation code.

## Query options

The collection and zone entry points share these options:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `query` | `string` | required | Full-text query, limited to 1,024 UTF-16 code units |
| `matching` | `SearchMatching` | all concepts, automatic quoted phrases | Provider-neutral matching intent |
| `locale` | `string` | client default locale | Restrict search to one content locale |
| `status` | `'published' \| 'any'` | `'published'` | Provider row status filter |
| `where` | `QueryPredicate` | none | Accepted by the API; not applied by built-in SQL providers |
| `facets` | `string[]` | none | Requested facet fields; aggregation is not implemented by built-in SQL providers |
| `limit` | `number` | `20` in built-in providers | Maximum provider candidates for the page |
| `offset` | `number` | `0` | Provider pagination offset |
| `hydrate` | `boolean` | `false` | Attach a document read through the normal pipeline |

`status: 'any'` relaxes the provider filter, but the standard lifecycle indexes only published views. It does not expose drafts unless a custom indexing path has written them.

## Matching policy

```ts
interface SearchMatching {
  operator?: 'all' | 'any'
  minimumShouldMatch?: number
  phrase?: 'auto' | 'required' | 'off'
}
```

| Setting | Behavior |
|---|---|
| `operator: 'all'` | Every analyzed concept must match |
| `operator: 'any'` | Any analyzed concept may match |
| `minimumShouldMatch: n` | At least `n` concepts must match; valid only with `operator: 'any'` |
| `phrase: 'auto'` | Quoted spans become ordered phrase constraints |
| `phrase: 'required'` | The complete non-empty query must also match as an ordered phrase |
| `phrase: 'off'` | Disable all phrase constraints, including quoted spans |

Both built-in providers implement all of these settings. They translate the same portable concept plan into different database query syntax.

## Results

```ts
interface ClientSearchResults {
  hits: Array<{
    collectionPath: string
    documentId: string
    locale: string
    title: string
    path: string | null
    score: number
    highlights?: Record<string, string[]>
    document?: ClientDocument
  }>
  total: number
  facets?: Record<string, Array<{ value: string; count: number }>>
}
```

`title` is the collection identity value copied into the index for display. It may not be a literal field named `title`. `score` is provider-assigned and only comparable within one result set.

The built-in providers currently return highlighted body fragments under `highlights.body`. They do not return facet buckets.

## Render highlights safely

Portable snippets preserve original source text and insert `<mark>` delimiters around matching ranges. The string is not trusted HTML. Split the delimiters and let your rendering framework escape all text.

```tsx
function Highlighted({ snippet }: { snippet: string }) {
  const parts = snippet.split(/(<mark>.*?<\/mark>)/g)

  return (
    <>
      {parts.map((part, index) => {
        const match = /^<mark>(.*?)<\/mark>$/.exec(part)
        return match == null ? (
          <span key={index}>{part}</span>
        ) : (
          <mark key={index}>{match[1]}</mark>
        )
      })}
    </>
  )
}
```

Do not pass the complete snippet to `dangerouslySetInnerHTML`. The provider marks exact, normalized, expanded, identifier, and Han-gram matches from the stored original body.

## Hydrate results

Set `hydrate: true` when a result needs fields beyond the lightweight hit:

```ts
const result = await client.collection('news').search({
  query: 'launch',
  hydrate: true,
})

const summary = result.hits[0]?.document?.fields.summary
```

Byline batch-reads each collection's candidate ids through its ordinary read path. If the runtime has registered an admin `itemView`, its columns define the projection; otherwise hydration reads the full field set.

Hydration:

- applies `beforeRead`;
- runs `afterRead`;
- preserves provider ranking order;
- removes stale hits whose document no longer resolves; and
- attaches the surviving `ClientDocument` as `hit.document`.

## Authorization after ranking

The provider owns retrieval and ranking. Core owns authority.

When a collection has a `beforeRead` predicate, Byline re-resolves the provider candidate ids through the normal strict read pipeline. Unauthorized ids are removed before results leave the client.

This has visible pagination semantics:

- `total` becomes the number of authorized hits surviving the current provider page;
- provider facets are omitted to avoid leaking aggregate counts;
- a page can contain fewer hits than `limit`; and
- callers should advance using the requested provider `offset`, not the number of hits received.

Without collection or row restrictions, provider `total` passes through unchanged. Hydration may still drop a stale result independently.

Exact corpus-wide authorized totals require pushing a supported predicate into the provider. The current built-in SQL providers do not implement that query path.

## Current limits

The public types already carry `where`, `facets`, and facet result buckets because the provider contract reserves those shapes. The PostgreSQL and MySQL providers currently report:

```ts
{
  facets: false,
  typoTolerance: false,
  semantic: false,
  bm25: false,
  weighting: true,
  highlights: true,
  fullText: {
    nativeAnalysis: false,
    portableAnalysis: true,
    allTerms: true,
    anyTerms: true,
    minimumShouldMatch: true,
    phrase: true,
  },
}
```

Do not expose facet controls, typo correction, semantic search, or a BM25 guarantee unless the registered provider advertises that capability. There is no provider-specific query extension bag in the shipped contract.
