---
title: "Native search engines and backend portability"
path: "native-search-engines"
summary: "How one search projection supports both portable SQL analysis and engines with native language analysis, and what stays stable when an installation moves between them."
---

# Native search engines and backend portability

Companions:
- [Search](./index.md) — the subsystem overview and the package boundaries this page builds on.
- [Search provider contract](./04-provider-contract.md) — the `SearchProvider` interface, `SearchDocument`, and capability declarations every provider implements.
- [Portable multilingual analysis](./05-portable-analysis.md) — the application-side analyzer that gives the SQL providers their multilingual floor.
- [PostgreSQL and MySQL providers](./06-postgres-and-mysql.md) — the built-in portable-analysis implementations of the contract.
- [Content locales](../08-internationalization/03-content-locales.md) — the host-owned list of locales a document can be published in.

This page answers a design question: how does Byline keep search portable across very different backends (a SQL database today, a dedicated engine such as Solr or Elasticsearch later) without forcing every backend down to a lowest common denominator, and without promising behavior only one engine can deliver? Read it when you are deciding whether to move beyond the built-in SQL providers, or when you are designing a provider for a native engine.

## One projection, many physical forms

Portability rests on one rule: every provider receives the same input. Core assembles one `SearchDocument` (the flat, provider-neutral projection of one published document in one content locale) and hands it to the configured provider. The provider alone decides the physical form: a weighted `tsvector` row, five MySQL `FULLTEXT` streams, or an engine document with per-language analyzed fields. The projection is described in the [provider contract](./04-provider-contract.md).

Because the index is disposable derived data, "portable" means that any provider can rebuild an equivalent index from published content. It does not mean index data moves between providers, and it does not mean two providers run at once. An installation registers exactly one active provider; changing it is a rebuild, described in [Switching providers](./02-indexing-and-reindexing.md#switching-providers).

## Two analysis strategies

A provider declares at least one analysis strategy in `capabilities.fullText`:

- `portableAnalysis` — the provider indexes deterministic logical terms produced by `@byline/search-analysis` on the application side.
- `nativeAnalysis` — the backend analyzes original `SearchDocument` text with its own pipelines.

The two strategies exist because the backends have opposite strengths. SQL full-text primitives are weak multilingual analyzers: their parsers assume space-delimited words, and their stopword and token-length behavior varies by server configuration. For them, the application must own normalization, ICU segmentation, identifier handling, and SQL-safe token encoding. That is the portable analyzer, and it is the floor every Byline installation can rely on without operating a second service.

A dedicated engine inverts the situation. Lucene-class analysis chains, BM25 ranking, and native highlighting are usually better than the portable floor for the languages they cover. A native provider should therefore use the engine's analysis rather than reproduce the portable pipeline inside it, and it skips application-side term generation entirely.

A native provider is not required to index portable terms as companion fields. Indexing both representations side by side is a legitimate design: it buys cross-engine regression stability and an identical recall floor, at the cost of index size and query complexity. The contract, however, treats the strategies as options a provider may combine, not as a requirement. What the contract does require is narrower: the declared capabilities must describe how the configured instance actually analyzes and matches, and one instance must behave consistently at index and query time.

## Matching is a capability, not an assumption

[Matching policy](./03-search-api.md#matching-policy) (all terms, any terms, minimum should match, and phrase constraints) is product behavior only where the registered provider declares it. The `fullText` capability flags must describe the query the provider actually builds, not what the engine could express. An engine may support all four behaviors natively, but if the provider's query builder does not translate `query.matching`, the flags must be `false`, and callers receive whatever defaults the engine applies.

This is why application code must consult capabilities before exposing an optional control. The provider instance the application constructed reports them directly:

```ts
import { postgresSearch } from '@byline/search-postgres'

const search = postgresSearch({ pool: db.pool, defaultLocale: 'en' })

search.capabilities.fullText.phrase // true — quoted spans become ordered constraints
search.capabilities.facets // false — do not render facet controls
```

A "match all words" toggle, a facet sidebar, or a typo-correction hint built against one provider silently changes meaning (or stops working) under another provider unless it is gated on these flags. Switching providers can legitimately change the capability report; that is a feature of the contract, not a defect of the provider.

## Ranking parity means intent, not equal scores

Field boosts map into the four weight classes described in [Configure search](./01-configuration.md#field-weights). A provider that declares `capabilities.weighting` must honor their relative order: class-A text outranks class-B text for the same match. That relative intent is the whole cross-provider ranking guarantee.

Scores are not comparable across providers, and result order is not guaranteed to be identical. `ts_rank`, a weighted `MATCH ... AGAINST` sum, and BM25 are different relevance models over different physical tokens. When an installation changes providers, run its own relevance checks against representative queries rather than expecting the previous ordering.

The same rule applies across content locales within one provider. Language analyzers produce scores over different token spaces and corpus statistics. A host that searches several locales should present separately ranked, language-labelled groups unless its provider declares and documents a meaningful cross-locale ranking model.

## Content locales and analyzer coverage are separate truths

Two independent configurations decide multilingual quality, and they rarely match:

- The host's [content locales](../08-internationalization/03-content-locales.md) decide which locales exist in the index — one row or engine document per published content locale.
- The provider decides which of those locales receive language-specific analysis. For a native engine this is engine-schema truth: the analyzers its schema artifact actually defines.

The built-in SQL providers do not have this split: the portable analyzer applies the same NFKC normalization and ICU segmentation to every locale, so every content locale gets the same analysis floor. A native engine typically covers some locales with dedicated analyzers and the rest with a generic tokenizer.

Generic fallback is not equivalent multilingual quality, and the difference is largest for unspaced scripts (Thai, Lao, Khmer, Myanmar, and Han text), where a generic tokenizer cannot find word boundaries that a dictionary-backed analyzer can. A native provider should therefore make fallback observable (report which configured content locales resolved to a language analyzer and which fell back), and locales served by fallback should be relevance-tested with real corpus text before the installation treats them as searchable. The gap is usually closable inside the engine (for example with ICU-based tokenization or an additional analyzer definition in the schema artifact), which is a smaller change than switching providers.

The document locale and the query text's language are also separate truths. The current `SearchQuery.locale` selects both the result slice and, for most native schemas, the language-specific field used to analyze the query. Text in another script can therefore be present in a document yet receive fragile or no word-level recall. A provider may add a script-neutral exact field, per-script companion fields, query-language hints, or semantic retrieval, but none of those is implied by `nativeAnalysis`; each needs an explicit capability and conformance coverage.

## The completeness bar for a native provider

A native-engine provider is complete when it meets the same contract the SQL providers pass, not when queries return plausible results. Concretely, it must:

- store one entry per `(collectionPath, documentId, locale)` with idempotent `upsert` and tolerant `remove`;
- filter collection, zone, locale, and status scope;
- paginate deterministically, including tie-breakers beyond score and update time, so equal-score rows cannot swap between pages;
- return highlights when it declares them;
- translate `SearchMatching` for every `fullText` flag it declares, and declare `false` for the rest;
- own its schema artifact: an engine configset or index template is that provider's schema, and its provisioning step stands in for `migrate()`; and
- pass the `@byline/search-conformance` suites for everything it declares, as described in the [provider contract](./04-provider-contract.md#conformance).

Authorization is deliberately absent from this list. The client applies collection abilities and `beforeRead` row filtering after the provider ranks candidates, so a provider never reproduces the security pipeline. That is what keeps an external engine drop-in safe.

## Status

No native-engine provider ships with Byline today. A Solr provider is under development against a production installation, where it already delivers BM25 ranking and facet aggregation, and is expected to upstream once it meets the conformance bar above; the Solr sketch in the [provider contract](./04-provider-contract.md#portable-and-native-analysis) reflects that design. Semantic and vector retrieval are under active research and development for a future hybrid provider, and remain reserved capability flags until one ships.
