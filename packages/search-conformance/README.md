# @byline/search-conformance

Private, backend-neutral behavioral suites for Byline `SearchProvider`
implementations. The package owns no search implementation and opens no
connections itself. Each adapter supplies hooks for its real test backend:

```ts
runSearchProviderConformanceSuite({
  createProvider,
  createPortableProvider,
  expectedCapabilities: { highlights: true },
  migrate,
  reset,
  teardown,
})
```

The aggregate runner covers:

- capability declarations;
- idempotent upsert, removal, collection/global rebuilds, and query scoping;
- pagination and published-status filtering;
- all/any, minimum-should-match, phrase behavior, and highlighted snippets; and
- portable normalization, SQL stopwords, identifiers, language expansions,
  Han-bigram fallback, relative weighting, and analyzer fingerprints.

Named suite exports let an incomplete adapter port register one group at a
time. A complete adapter should use `runSearchProviderConformanceSuite()`.
Backend scores are intentionally not compared numerically: conformance asserts
positive scores and relative weighting, while relevance tuning belongs to a
separate shared corpus.
