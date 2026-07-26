---
title: "Portable Multilingual Search Analysis"
path: "multilingual-search-analysis"
summary: "The backend-neutral lexical matching, token analysis, query-plan, physical encoding, and analyzer-fingerprint contracts shared by Byline search providers."
---

# Portable Multilingual Search Analysis

Companions:
- [Search & Retrieval](./07-search.md) — the provider seam, index lifecycle, query surfaces, authorization, and current PostgreSQL implementation.
- [Search & Document Extraction](./08-search-extraction-strategy.md) — the separate attachment-extraction pipeline whose text will feed the same search projection.
- [Client SDK](./01-client-sdk.md) — the collection and zone search APIs that accept the matching policy.

:::note[PostgreSQL adapter shipped]
`@byline/search-analysis`, the additive `SearchQuery.matching` contract, and
the portable `@byline/search-postgres` index/query translator are available.
The PostgreSQL cutover intentionally replaces its old native-analysis index:
installations drop the driver-owned search tables, apply the rewritten
`0001_init.sql`, and rebuild the published index. There is no dual-mode or
in-place compatibility path.
:::

## Why this is a separate package

`SearchProvider` remains the stable storage and retrieval seam. It accepts
original `SearchDocument` projections and returns ranked `SearchResults`.
Multilingual lexical analysis is a different concern: it converts original text
and query intent into a deterministic logical representation before an adapter
chooses its physical index syntax.

The ownership boundaries are:

| Owner | Responsibility |
|---|---|
| `@byline/core` | Public matching intent and provider capability declarations |
| `@byline/client` | Pass matching intent from collection and zone calls without interpretation |
| `@byline/search-analysis` | Normalization, locale resolution, token classes, grouped query plans, fingerprints, and SQL-safe token encoding |
| Search adapter | Physical schema, persistence, query translation, ranking, highlights, and analyzer-consistency checks |

This split keeps the portable behavior independently testable. It also avoids
forcing Solr, OpenSearch, or another engine with a strong native analyzer to
store application-produced tokens. Providers declare whether they use native
or portable analysis. The PostgreSQL provider uses portable analysis only.

## Matching intent

Collection and zone search accept:

```ts
interface SearchMatching {
  operator?: 'all' | 'any'
  minimumShouldMatch?: number
  phrase?: 'auto' | 'required' | 'off'
}
```

The defaults are conservative: every analyzed concept must match, and quoted
spans retain phrase intent. `minimumShouldMatch` is a positive integer and is
only valid with `operator: 'any'`. `phrase: 'required'` makes the complete
non-empty query an ordered phrase; `phrase: 'off'` disables even explicitly
quoted phrase constraints.

These options describe product behavior rather than backend syntax. An adapter
must translate them faithfully or advertise the missing feature through
`SearchCapabilities.lexical`.

## Analysis pipeline

`createPortableSearchAnalyzer()` applies a versioned sequence:

1. Normalize search text with Unicode NFKC and locale-insensitive lowercase.
   The source document remains unchanged. Logical tokens retain UTF-16 ranges
   into both normalized and original text, including compatibility expansions.
2. Resolve a usable locale. A valid declared locale wins; otherwise the
   analyzer detects Thai, Japanese, Korean, Lao, Khmer, Myanmar, or Han script,
   then uses the configured fallback.
3. Extract identifiers before general word segmentation. URLs, email
   addresses, mentions, hashtags, SKUs, versions, and selected technical terms
   such as `C++`, `C#`, and `Node.js` remain single logical terms.
4. Segment remaining words with the Node.js runtime's ICU-backed
   `Intl.Segmenter`.
5. Run optional locale-aware expansion plug-ins. Stems, lemmas, and normalized
   variants augment their exact source token and never replace it.
6. Emit overlapping Han bigrams as an ordered, low-weight fallback while
   retaining the exact segmented terms.

The analyzer is synchronous and CPU-local. It does no I/O, document extraction,
database access, or model inference. Attachment extraction remains a separate
phase; the resulting text enters this same pipeline only when a published
version is indexed.

## Logical query plans

`analyzeQuery()` returns a `PortableQueryPlan`, not a database query string.
Every user concept has separate exact, stem, lemma, normalized, identifier, and
gram arrays. Alternatives stay grouped under their source concept so an adapter
can express:

```text
(exact OR stem OR lemma) AND (exact OR stem OR lemma)
```

without accidentally flattening all expansions into one broad OR query.
Quoted and required phrases refer to ordered concept indexes. Han grams remain
ordered sequences rather than independent alternatives. This structure is the
portable contract that PostgreSQL and MySQL translators will share.

## Physical SQL tokens

Logical terms can contain punctuation, non-Latin scripts, or only one
character. SQL full-text parsers may discard or split those values differently.
`encodeSqlToken()` therefore provides a separate physical representation:

- lowercase ASCII alphanumeric output;
- distinct prefixes for exact, stem, lemma, normalized, identifier, and gram
  terms;
- enough encoded characters for a one-character source term to clear common
  minimum-token limits; and
- deterministic SHA-256 fallback for terms above the configured length.

The codec is an adapter building block, not the public search vocabulary.
Adapters store original text for display and highlights and use encoded terms
only in their portable index projection.

## Fingerprints and reindexing

Every analyzer exposes an `analyzerFingerprint`. It includes the portable
pipeline versions, relevant options, the Node.js ICU version, and every
language-expander fingerprint. An adapter that stores portable terms must
persist this value as index metadata and compare it before using an indexed
collection.

A mismatch means stored terms and query terms may no longer be comparable.
The provider should report the mismatch before searching or indexing the
affected collection, and an explicit reindex should replace the projection and
stored fingerprint. Adapters must not silently mix fingerprints within one
active index.

## Adapter rollout

The implementation sequence keeps each phase reviewable:

1. Add these contracts and analyzer conformance cases. **Shipped.**
2. Replace the disposable `@byline/search-postgres` projection with a portable
   schema and query translator, then rebuild the two owned installations from
   published content. **Shipped.**
3. Extract shared provider conformance tests for matching semantics,
   capabilities, published-status filtering, locale isolation, and
   fingerprint mismatch/reindex behavior. **Shipped in
   `@byline/search-conformance`, with PostgreSQL as the first passing
   adapter.**
4. Complete `@byline/search-mysql` against the same query plans and conformance
   suite, with MySQL-specific schema and full-text translation.
5. Adapt the existing Solr implementation, normally using Solr's native
   analyzers while mapping the public matching contract and capability report.

PostgreSQL and MySQL migrations remain independent streams owned by their
provider packages. No search migration belongs in a database storage adapter.
