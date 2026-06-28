/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The `SearchProvider` seam — a provider-agnostic search interface,
 * registered on `ServerConfig.search` and composed by `initBylineCore()`,
 * mirroring how `IDbAdapter`, `IStorageProvider`, and the
 * `fields.richText.*` adapters plug into core.
 *
 * Core normalises each document into a flat, provider-agnostic
 * {@link SearchDocument} and hands that to the provider — the provider
 * never sees EAV store rows. A built-in Postgres full-text driver ships
 * as `@byline/search-postgres`; external drivers (BM25 rankers, vector
 * stores, hybrid retrievers) implement the same interface rather than
 * forking the read path.
 *
 * The provider factory (e.g. `postgresSearch({ getClient })`) lives in the
 * driver package, not here — core declares only the interface and its data
 * types, the same way `RichTextPopulateFn` is declared in core while
 * `lexicalEditorPopulateServer()` lives in `@byline/richtext-lexical`. This
 * keeps `@byline/core` from depending on `@byline/client`.
 *
 * See `docs/05-reading-and-delivery/07-search.md` for the full design.
 */

import type { QueryPredicate } from './query-predicate.js'

/**
 * The flat, provider-agnostic representation of a document that core feeds
 * to a `SearchProvider`. Assembled from the EAV store by core; the provider
 * indexes it without any knowledge of store tables or path notation.
 *
 * One `SearchDocument` exists per `(collectionPath, documentId, locale)` —
 * `upsert` is idempotent on that triple.
 */
export interface SearchDocument {
  /** Collection path, e.g. `"docs"` or `"publications"`. */
  collectionPath: string
  /** The document's stable id (shared across versions and locales). */
  documentId: string
  /** Content locale this index entry represents. */
  locale: string
  /**
   * Lifecycle status of the indexed version (e.g. `"published"`). Carried
   * so the provider can apply published-only filtering at query time.
   */
  status: string
  /**
   * Resolved search-scope membership for this document, derived from its
   * collection's `search.zones` config at index time. A document with no
   * declared zones gets a single implicit zone equal to its collection
   * path, so single-collection search always works.
   */
  zones: string[]
  /**
   * The collection's identity value — resolved via `useAsTitle`
   * (`resolveIdentityField`), never assumed to be a literal `title` field.
   * Gives heterogeneous zone results a sensible per-collection label.
   */
  title: string
  /** The document's URL path, or `null` when the collection has none. */
  path: string | null
  /**
   * Concatenated indexable text — text fields plus extracted rich-text
   * plain text (and, in a later phase, attachment-extracted text). This is
   * what the provider's full-text index is built over.
   */
  body: string
  /**
   * Facetable / filterable projection of the document's fields. Shape is
   * provider-opaque; drivers that support facets read from here.
   */
  fields: Record<string, unknown>
  /** ISO-8601 timestamp of the indexed version. */
  updatedAt: string
}

/**
 * A search request. Either collection-scoped (`collectionPath`) for
 * homogeneous results, or zone-scoped (`zone`) for heterogeneous
 * cross-collection results — see the two `client.search()` entry points.
 */
export interface SearchQuery {
  /** The free-text query string. */
  query: string
  /**
   * Cross-collection scope — every collection indexed into this zone.
   * Mutually exclusive with `collectionPath` in practice.
   */
  zone?: string
  /** Single-collection scope. */
  collectionPath?: string
  /**
   * Structured filters AND-merged with the text query. Reuses the same
   * predicate shape as the client `where` clause / `beforeRead` scoping.
   */
  where?: QueryPredicate
  /** Field names to compute facet buckets for (driver-capability gated). */
  facets?: string[]
  /** Restrict to a single content locale. */
  locale?: string
  /**
   * Status filter. Defaults to `'published'` (safe for public readers);
   * `'any'` is for admin contexts.
   */
  status?: 'published' | 'any'
  /** Max hits to return. */
  limit?: number
  /** Offset for pagination. */
  offset?: number
}

/**
 * A single ranked result. Always carries the lightweight projection needed
 * to render a plain-text row without hydration; the consumer hydrates ids
 * into shaped `ClientDocument`s separately (the two-tier results model).
 */
export interface SearchHit {
  collectionPath: string
  documentId: string
  locale: string
  /** The collection's identity value (see {@link SearchDocument.title}). */
  title: string
  path: string | null
  /** Provider-assigned relevance score; higher is more relevant. */
  score: number
  /**
   * Matched snippets per field, when the driver supports highlighting
   * (`capabilities.highlights`). Enough to render a result row inline.
   */
  highlights?: Record<string, string[]>
}

/** A single facet bucket — a distinct value and its match count. */
export interface SearchFacetBucket {
  value: string
  count: number
}

/** The result envelope returned by `SearchProvider.search`. */
export interface SearchResults {
  hits: SearchHit[]
  /** Total matches across all pages (not just the returned `hits`). */
  total: number
  /**
   * Facet buckets keyed by field name, when `facets` was requested and the
   * driver supports them.
   */
  facets?: Record<string, SearchFacetBucket[]>
}

/**
 * What a given driver can actually do. Lets consumers (the admin UI, the
 * MCP tool) light up facets / typo-tolerance / semantic features only where
 * the registered driver supports them, and keeps optional capabilities
 * (e.g. BM25, which depends on a Postgres extension that isn't universally
 * available) honest about a deployment's real reach rather than assumed.
 */
export interface SearchCapabilities {
  /** Faceted aggregation over indexed fields. */
  facets: boolean
  /** Fuzzy / typo-tolerant matching (e.g. `pg_trgm`). */
  typoTolerance: boolean
  /** Vector / semantic / hybrid retrieval. */
  semantic: boolean
  /**
   * BM25-quality ranking (IDF-aware). The built-in Postgres `tsvector`
   * floor is `false` here; satisfied by `lakebase_text`, ParadeDB, or
   * `pg_textsearch` where available.
   */
  bm25: boolean
  /** Matched-snippet highlighting in results. */
  highlights: boolean
}

/**
 * The provider-agnostic search seam. A driver implements indexing
 * (`upsert` / `remove`), querying (`search`), and optional bulk rebuild
 * (`reindex`), and declares its {@link SearchCapabilities} statically.
 *
 * Registered as `ServerConfig.search`; `initBylineCore()` fails fast when a
 * collection opts into search but no provider is registered.
 */
export interface SearchProvider {
  /**
   * What this driver supports. Static — a driver knows its own shape at
   * construction. Read by consumers to gate UI/feature exposure.
   */
  readonly capabilities: SearchCapabilities
  /**
   * Add or replace a document in the index. Idempotent on
   * `(collectionPath, documentId, locale)`.
   */
  upsert(doc: SearchDocument): Promise<void>
  /**
   * Remove a document from the index — all locales when `locale` is
   * omitted, or a single `(collectionPath, documentId, locale)` entry.
   */
  remove(ref: { collectionPath: string; documentId: string; locale?: string }): Promise<void>
  /** Execute a query and return ranked hits. */
  search(query: SearchQuery): Promise<SearchResults>
  /**
   * Drop and rebuild a collection's slice (or the whole index). Used for
   * first-time backfill, driver swaps, and after a `search` config change.
   * Optional — not every driver supports bulk rebuild.
   */
  reindex?(opts: { collectionPath?: string }): Promise<void>
}
