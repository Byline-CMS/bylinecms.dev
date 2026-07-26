---
title: "Search"
path: "search"
summary: "How Byline provides ranked, multilingual site search through one provider contract, with built-in PostgreSQL and MySQL implementations that reuse the application's existing database."
---

# Search

Companions:
- [Client SDK](../05-reading-and-delivery/01-client-sdk.md) — search is exposed through the same in-process client as document reads and writes.
- [Collections](../04-collections/index.md) — each searchable collection declares the fields, weights, and zones that feed its search projection.
- [Authentication and authorization](../07-auth-and-security/01-authn-authz.md) — collection abilities and `beforeRead` predicates still apply after the provider ranks search candidates.
- [Content locales](../08-internationalization/03-content-locales.md) — the search index stores one projection for each published content locale.

Byline search is a ranked retrieval subsystem for the public applications you build on top of the CMS. It is designed for installations that want useful full-text search without adding a separate search server, while keeping a provider boundary for deployments that later need Solr or another dedicated engine.

The default PostgreSQL and MySQL providers reuse the database pool that already stores CMS content. They add their own disposable search tables in the same database, so a small organization can run the application, admin interface, content store, and search index on one host. There is no second service to provision, secure, monitor, or pay for.

This is a good fit for content sites with hundreds or a few thousand documents, including multilingual documents and text that has already been extracted from attachments. Only published versions enter the index. Lifecycle hooks may still reconcile the published view after a draft save, but they never index the draft itself.

## The model

Five terms define the subsystem:

- A **search projection** is the flat, provider-neutral representation of one published document in one locale. It contains display metadata plus only the fields a collection explicitly opts into.
- A **search provider** implements the `SearchProvider` contract. It stores projections, removes them, ranks queries, clears index slices, and reports its capabilities.
- A **search analyzer** turns original text and query intent into deterministic logical terms. Both built-in SQL providers use the portable analyzer from `@byline/search-analysis`.
- A **search zone** is a named scope containing one or more collections. Collection search returns one result type; zone search ranks heterogeneous collections together.
- A **search index** is disposable derived data. Published CMS documents remain authoritative, and `reindex()` can rebuild the projection after a schema, analyzer, configuration, or provider change.

## Architecture

A collection schema names the content that may enter the index. Byline then keeps one provider-owned projection in sync with published content and finishes ranked results through the normal read-security pipeline.

```text
CollectionDefinition.search
          |
          v
published locale-resolved document
          |
          v
buildSearchDocument() + rich-text toText adapter
          |
          v
SearchProvider.upsert(SearchDocument)
          |
          v
PostgreSQL tsvector or MySQL FULLTEXT projection

client.collection(path).search() or client.search({ zone })
          |
          v
provider ranking and lightweight hits
          |
          v
collection ability + beforeRead authorization
          |
          v
optional document hydration
```

The boundary is deliberate:

1. `@byline/core` owns the public contracts and assembles a typed `SearchDocument`.
2. `@byline/client` owns published-document synchronization, query entry points, authorization, and optional hydration.
3. `@byline/search-analysis` owns portable normalization, tokenization, query planning, and highlighting.
4. `@byline/search-postgres` and `@byline/search-mysql` own physical schemas, migrations, query translation, and ranking.
5. `@byline/search-conformance` runs the same behavioral suites against both database implementations.

The provider never reads Byline's typed EAV storage tables. It receives a complete projection and can therefore live in the application database or in an external engine without changing the document read path.

## What ships

Both built-in providers support:

- collection and cross-collection zone search;
- published-only lifecycle indexing and complete rebuilds;
- Unicode normalization and ICU word segmentation;
- identifiers, Han bigrams, and optional language expansion;
- all-term, any-term, minimum-term, and phrase matching;
- field weighting;
- highlighted snippets from original text;
- per-locale index rows;
- analyzer fingerprint checks; and
- post-ranking collection and row authorization.

The current built-in SQL providers do not implement typo tolerance, spelling suggestions, semantic or vector retrieval, BM25 as a portable guarantee, facet aggregation, or structured `where` filtering. Facet and filter values are already present in the projection, but the query implementations do not use them yet. Check `provider.capabilities` before exposing an optional feature.

Attachment extraction is also separate and not yet shipped. Tika, Docling, OCR, or a vision model should produce a persisted extraction artifact before search indexing. The index then consumes that text like any other body field, without coupling extraction cost to every rebuild.

## Read this section

- [Configure search](./01-configuration.md) explains provider registration, collection fields, weights, zones, and rich-text extraction.
- [Indexing and reindexing](./02-indexing-and-reindexing.md) covers published-only synchronization, lifecycle hooks, failure behavior, migrations, and rebuilds.
- [Search API](./03-search-api.md) is the reference for collection and zone queries, matching policy, results, highlights, hydration, and authorization.
- [Provider contract](./04-provider-contract.md) documents `SearchProvider`, `SearchDocument`, capabilities, and conformance requirements for another adapter.
- [Portable multilingual analysis](./05-portable-analysis.md) explains logical terms, locale resolution, identifiers, expansion plug-ins, phrase plans, highlighting, and fingerprints.
- [PostgreSQL and MySQL providers](./06-postgres-and-mysql.md) compares the two physical implementations and their operational behavior.
- [Attachment extraction](./07-attachment-extraction.md) records the planned boundary for Tika, Docling, OCR, and vision-model services.
