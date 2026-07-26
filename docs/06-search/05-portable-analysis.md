---
title: "Portable multilingual search analysis"
path: "multilingual-search-analysis"
summary: "How Byline normalizes multilingual text, preserves identifiers, plans portable queries, expands language terms, creates highlights, and detects indexes that require rebuilding."
---

# Portable multilingual search analysis

Companions:
- [Search provider contract](./04-provider-contract.md) — portable analysis sits below the provider seam and does not change its public storage and retrieval methods.
- [Search API](./03-search-api.md) — collection and zone queries carry the matching intent resolved by the analyzer.
- [PostgreSQL and MySQL providers](./06-postgres-and-mysql.md) — both built-in providers store portable terms and translate the same logical plan.
- [Attachment extraction](./07-attachment-extraction.md) — extracted text enters this pipeline only after a separate extraction phase produces a persisted artifact.

`@byline/search-analysis` converts original text and query intent into a deterministic logical representation that PostgreSQL and MySQL can share. It is synchronous, CPU-local, and independent of any database or document extraction service.

## Ownership

| Owner | Responsibility |
|---|---|
| `@byline/core` | Public matching intent and provider capability types |
| `@byline/client` | Pass matching intent to collection and zone searches |
| `@byline/search-analysis` | Normalization, locale resolution, token classes, query plans, highlighting, fingerprints, and SQL-safe token encoding |
| Search provider | Physical storage, query translation, ranking, highlights for ranked rows, and analyzer-consistency checks |

A provider with strong native language analyzers may use `nativeAnalysis` instead. The built-in SQL providers use portable analysis only.

## Analysis pipeline

`createPortableSearchAnalyzer()` applies this versioned sequence:

1. Normalize search text with Unicode NFKC and locale-insensitive lowercase. Original content remains unchanged, and tokens retain UTF-16 ranges into the original string.
2. Resolve a usable locale. A valid declared locale wins. Otherwise the analyzer detects Thai, Japanese, Korean, Lao, Khmer, Myanmar, or Han script, then uses the configured fallback.
3. Extract identifiers before general word segmentation. URLs, email addresses, mentions, hashtags, SKUs, versions, and selected technical terms such as `C++`, `C#`, and `Node.js` remain logical identifiers.
4. Preserve exact constituents for SKU and version forms at the same logical position. `COVID-19` can match `covid`, `19`, or the complete identifier without shifting phrase adjacency.
5. Keep URL and email components masked from word-level recall. A document containing only `editor@example.com` does not match a query for `example`.
6. Segment remaining words with the Node.js runtime's ICU-backed `Intl.Segmenter`.
7. Run optional locale-aware expanders. Stems, lemmas, and normalized variants augment the exact token and never replace it.
8. Emit overlapping Han bigrams as a low-weight fallback while retaining exact segmented terms.

The analyzer limits queries to 1,024 UTF-16 code units before normalization and identifier extraction.

## Configure the analyzer

```ts
import { createPortableSearchAnalyzer } from '@byline/search-analysis'
import { postgresSearch } from '@byline/search-postgres'

const analyzer = createPortableSearchAnalyzer({
  defaultLocale: 'en',
  hanLocale: 'zh',
  hanBigrams: true,
})

const search = postgresSearch({
  pool: db.pool,
  analyzer,
})
```

| Option | Default | Meaning |
|---|---|---|
| `defaultLocale` | `'en'` | Fallback after declared locale validation and script detection |
| `hanLocale` | `'zh'` | Locale for otherwise ambiguous Han-only text |
| `hanBigrams` | `true` | Emit overlapping Han bigrams |
| `expanders` | `[]` | Ordered language-specific expansion plug-ins |

## Language expansion

An expander can add stems, lemmas, or language-specific normalized forms:

```ts
import type { SearchTokenExpander } from '@byline/search-analysis'

const englishStemmer: SearchTokenExpander = {
  fingerprint: 'english-stemmer1',
  supports: (locale) => locale.startsWith('en'),
  expand: (token) => {
    if (token.value === 'running' || token.value === 'runs') {
      return [{ kind: 'stem', value: 'run' }]
    }
    return []
  },
}

const analyzer = createPortableSearchAnalyzer({
  expanders: [englishStemmer],
})
```

The example shows the contract, not a bundled English stemmer. Byline does not currently ship Snowball language implementations.

Every expander needs a stable, versioned fingerprint. Change it whenever expansion behavior can change indexed terms.

## Logical query plans

`analyzeQuery()` returns a `PortableQueryPlan`, not a database query string. Each user concept keeps its alternatives grouped:

```text
(exact OR stem OR lemma) AND (exact OR stem OR lemma)
```

Concepts carry separate arrays for exact, stem, lemma, normalized, identifier, and gram tokens. Phrase constraints refer to ordered concept indexes. Han grams remain ordered sequences rather than becoming independent broad alternatives.

This grouping prevents an adapter from flattening every expansion into one unrelated OR expression.

## Physical SQL tokens

SQL full-text parsers may split punctuation, discard short values, apply stopword lists, or handle scripts differently. `encodeSqlToken()` converts each logical token into a separate parser-safe representation:

- lowercase ASCII alphanumeric output;
- a prefix identifying exact, stem, lemma, normalized, identifier, or gram terms;
- enough encoded characters for a one-character source term to exceed common minimum token lengths; and
- a deterministic SHA-256 fallback for terms above the codec limit.

The physical token is not part of the public search vocabulary. Providers store original body text for display and highlighting.

## Highlighting

`highlightPortableText()` re-analyzes stored original text with the same analyzer and compares logical terms with the query plan. It can therefore mark original ranges for exact, normalized, stemmed, lemmatized, identifier, and Han-gram matches.

The default highlighter:

- runs only for ranked rows on the requested page;
- merges overlapping source ranges;
- treats overlapping identifier constituents as one source term for the word budget;
- selects at most two fragments; and
- uses a 24-term fragment budget.

It emits `<mark>` delimiters in a plain string. Consumers must parse those delimiters and render all text safely.

## Fingerprints

Every analyzer exposes `analyzer.fingerprint`. It contains:

- pipeline and normalization versions;
- Node.js ICU version;
- locale behavior;
- default and Han locales;
- identifier behavior;
- Han-bigram behavior; and
- each ordered expander fingerprint.

Portable providers store this fingerprint in collection metadata. A query or write with another fingerprint throws `SEARCH_INDEX_REINDEX_REQUIRED`.

Do not mix analyzer versions in one active collection index. Clear and rebuild the collection whenever analysis behavior changes.
