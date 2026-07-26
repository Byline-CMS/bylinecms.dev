# Search analysis P1–P3 handoff

Review findings from PRs #60–#65 (portable search analysis), all merged to
`develop` and **unreleased** — three pending changesets, so a fingerprint change
costs nothing beyond a rebuild of the two owned installations.

Implementation is assigned to another agent. Verification is a separate pass
against the acceptance criteria below.

## P1 — ReDoS in the email identifier rule (unauthenticated reach)

`packages/search-analysis/src/identifiers.ts:32`

```ts
pattern: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu
```

The unbounded leading quantifier backtracks quadratically over any long run of
letters containing no `@`. CJK text is exactly that shape (no spaces), and so is
a hostile query string.

`analyzeQuery` runs the same extraction on the query, and no layer caps its
length: `/$lng/docs/search?q=` → route `validateSearch` → `searchDocsFn`
validator → `searchDocs` (trim only) → `CollectionHandle.search` →
`analyzeQuery`.

Measured blocking CPU (single-threaded event loop, `email` rule accounts for
466ms of 490ms at 8000 chars):

| query length | blocking CPU |
|---|---|
| 1 000 | 32 ms |
| 5 000 | 656 ms |
| 20 000 | 8 669 ms |
| 50 000 | 51 004 ms |

Same defect makes CJK indexing and highlighting quadratic: highlighting
re-analyzes each hit's full body, so one results page over 12k-char Chinese
bodies costs 12.7 s (identical English page: 26 ms).

**Direction** — bound the quantifiers to RFC limits. Verified linear and still
matching real addresses (`editor@example.com`,
`a.b+tag@sub.example.co.uk`, NFKC-folded full-width local parts):

```ts
pattern: /[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}.-]{1,255}\.[\p{L}]{2,63}/giu
```

16 000 chars: 2003 ms → 17 ms. 40 000 chars: 12 450 ms → 40 ms.

Audit the other six rules for the same shape while in there. Add a
query-length cap at the `SearchQuery` boundary as defence in depth, and a
linear-time guard test in `analyzer.test.node.ts`.

**Acceptance**

1. `extractIdentifierSpans` and `analyzeQuery` scale linearly on unbroken
   Han and Latin runs up to 40 000 chars.
2. Real email addresses, `Node.js`, `SKU-1234` still extract as identifiers
   (existing conformance test must keep passing).
3. A CJK results page (10 hits × 12k-char bodies) completes in well under a
   second.
4. An over-long query is rejected or truncated rather than analyzed.

## P2 — the SKU rule destroys recall on ordinary prose

`packages/search-analysis/src/identifiers.ts:39` — `\b[\p{L}]{2,}[-_]\d+\b`
combined with `maskIdentifierSpans` removes the constituent words from the index
entirely:

```
COVID-19 cases rose  => identifier:covid-19 | exact:cases | exact:rose
utf-8 encoding       => identifier:utf-8    | exact:encoding

  query "covid"    matches doc? false
  query "covid-19" matches doc? true
```

Also `top-10`, `byline-4`. The `version` rule does the same to plain decimals:
`Section 1.2`, `priced at 19.99`, `2026.07.26` all become exact-only identifier
tokens.

This contradicts the principle the package states for expansions — "stems,
lemmas, and normalized variants augment their exact source token and never
replace it" (docs/05-reading-and-delivery/09-multilingual-search-analysis.md).
Masking makes identifiers the one replacing stage.

**Direction** (agreed with the implementing agent — supersedes the original
"just stop masking" sketch, which would have distorted matching semantics):

1. Preserve constituent `exact` tokens for SKU/version-like identifiers.
2. Group the identifier and its overlapping constituents at **one logical
   position**. This is the mechanism expansions already use — a stem shares its
   source token's `position` — so identifiers should follow suit rather than
   consume extra positions.
3. When the query contains the complete form, the complete identifier is the
   query concept.
4. Retain masking for URLs and emails, where indexing every component creates
   noisy recall.
5. Increment `IDENTIFIER_VERSION`, requiring the expected index rebuild.

Why the naive unmask is wrong, measured on the current build: sorted
`sourceTokens` get sequential positions, so unmasked constituents would push
`cases` in `COVID-19 cases rose` from position 1 to position 2, and a bare
`covid-19` query would yield 3 concepts instead of 1 — distorting `operator:
'all'`, `minimumShouldMatch`, and `<->`/phrase adjacency in both drivers.

**Acceptance**

1. A document containing `COVID-19` is found by `covid`, by `19`, and by
   `covid-19`.
2. `utf-8 encoding` is found by `utf`, `8`, and `utf-8`.
3. URL and email spans still do **not** leak their internal words as separate
   exact terms.
4. Plan shape is unchanged: `covid-19` → 1 concept; `covid-19 vaccine` → 2;
   `"covid-19 cases"` → 2 concepts with phrase `[[0,1]]`; `utf-8 encoding` → 2;
   `Section 1.2` → 2.
5. An identifier occupies exactly one logical position — every token
   overlapping the identifier span shares its `position`, and the next word
   keeps position 1.
6. The analyzer fingerprint changes, and the conformance rebuild-enforcement
   test still passes.

**Downstream detail to watch** — `highlightPortableText` builds `sourceTerms`
from exact + identifier tokens and dedupes by exact `start:end` range, so
overlapping constituent ranges will each consume a slot of the `maxWords`
fragment budget, mildly shrinking snippets around identifiers. Cosmetic, but
cheap to handle while the code is open.

## P3 — fingerprint guard scans documents on every query

`packages/search-postgres/src/postgres-search-provider.ts:212`
`packages/search-mysql/src/mysql-search-provider.ts:207`

Both run `SELECT … FROM byline_search_documents WHERE analyzer_fingerprint IS
DISTINCT FROM $1 … LIMIT 1`, and neither migration indexes that column. In the
healthy case no row matches, so `LIMIT 1` never short-circuits and the query
scans the whole collection slice per search.

`byline_search_index_metadata` already holds exactly one authoritative
fingerprint row per collection (written under `FOR UPDATE` by `upsert`), so
reading that makes the guard O(1).

**Direction** — resolve the guard against the metadata table. Keep the
behavioural contract identical: mismatch must still raise
`SEARCH_INDEX_REINDEX_REQUIRED` with `collectionPath`, for both `search` and
`upsert`, in both drivers. Note the zone- and locale-scoped cases: metadata is
keyed by collection only, so a zone query spanning collections needs either a
per-collection lookup or an explicit decision to guard at first-touch.

**Acceptance**

1. The fingerprint guard issues no query against `byline_search_documents`.
2. The conformance `rejects mixed analyzer fingerprints until the collection
   is rebuilt` test passes on both drivers.
3. Zone-scoped queries are still guarded (or the narrowing is documented).

## Pre-fix baseline (for the verification pass)

Analyzer fingerprint before any change:

```
portable1+nfkc-lower1+icu78.3+locale1+default-en+han-zh+identifiers1+han-bigram1
```

Measured on `develop` at 60fe393a, Node 24.18, ICU 78.3:

| probe | before |
|---|---|
| `extractIdentifierSpans`, 40k unbroken Han | 11 438 ms (58.9x for 8x input) |
| `extractIdentifierSpans`, 40k unbroken Latin | 698 ms (53.3x for 8x input) |
| `analyzeQuery`, 5 000-char query | 554 ms |
| `analyzeQuery`, 50 000-char query | 50 835 ms |
| CJK results page, 10 hits × 12k chars | 13 583 ms |
| `COVID-19 cases rose` found by `covid` / `19` | no |
| `utf-8 encoding` found by `utf` | no |

Note the Latin run is quadratic too — this is not a CJK-only defect.

Guardrails that already pass and must keep passing: `editor@example.com`,
`a.b+tag@sub.example.co.uk`, `Node.js`, `SKU-1234` and bare URLs still extract as
identifiers; `example` must **not** match a document whose only occurrence is
inside `editor@example.com`; `docs` must **not** match inside a bare URL.

## P4 — deterministic PostgreSQL pagination

`postgres-search-provider.ts:188` orders by `score DESC, updated_at DESC`;
MySQL adds `collection_path, document_id, locale`. Postgres pagination is
non-deterministic on ties. Match MySQL's tiebreak. In scope for this branch.

## P5 — MySQL phrase-variant expansion (before any Snowball expander)

`packages/search-mysql/src/portable-query.ts:82` builds the cartesian product of
per-concept alternatives, which generates **impossible mixed-kind phrases** —
a variant like `[exact:running, stem:restored]` matches no indexed stream,
because `serializeMatchingStreams` writes one stream per kind (each falling back
to the exact token where that kind produced nothing). Those dead variants then
consume the `MAX_PHRASE_VARIANTS = 256` budget, after which real variants are
silently truncated mid-build with no log.

**Direction** — generate one phrase variant per *stream kind* (exact, stem,
lemma, normalized) to mirror the index's actual structure. That is ≤4 variants
regardless of query length, removes the need for `MAX_PHRASE_VARIANTS`
entirely, and eliminates both the dead clauses and the silent truncation.

Latent today (no expander configured → 1 variant per concept), so this is
either part of this branch or an immediate follow-up — but it must precede
enabling a Snowball expander.

## Deferred — not in this branch

- Body text containing a literal `<mark>` mis-splits in the docs UI
  `Highlighted` component. Cosmetic — React still escapes, no injection.
- Index sizing is undocumented in both driver READMEs. MySQL stores each token
  twice (`search_text` plus its weight column), base32-encoded, across five
  FULLTEXT indexes. **Do not publish a multiplier until it is benchmarked** —
  the earlier "roughly 8x for CJK" figure was arithmetic from the token
  encoding, not a measurement. Benchmark real
  `pg_total_relation_size` / `information_schema.TABLES` + `INNODB_INDEXES`
  figures against a representative corpus first.

## Branch

`fix/search-analysis-hardening` — P1, P2, P3, P4, the fingerprint bump,
adversarial performance tests, and cross-provider conformance coverage. P5
here or as an immediate follow-up.

No migration or compatibility layer: the search index is disposable derived
state and both owned installations rebuild it. One operational note for the
release — the fingerprint guard raises `SEARCH_INDEX_REINDEX_REQUIRED` on
every search between deploying this and completing the reindex, so for any
installation with search live the reindex must be sequenced with the deploy
rather than run afterwards.
