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
 * Core normalises each document into a flat, provider-agnostic,
 * **type-enriched** {@link SearchDocument} and hands that to the provider —
 * the provider never sees EAV store rows. The document carries a typed,
 * role-tagged field projection ({@link SearchField}) so a driver can map
 * each field onto its own index schema (Postgres store columns + weighted
 * tsvector, Solr dynamic fields, a vector store's payload, …) without
 * re-deriving types. A built-in Postgres full-text driver ships as
 * `@byline/search-postgres`; external drivers implement the same interface
 * rather than forking the read path.
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

// ---------------------------------------------------------------------------
// Collection-config declarations (role-based `CollectionDefinition.search`)
// ---------------------------------------------------------------------------

/**
 * One field declaration in a collection's role-based `search` config — a
 * field path, or `{ field, boost }` to weight it for scoring providers that
 * support `capabilities.weighting`. The bare-string shorthand uses the
 * provider's default weight.
 */
export type SearchFieldDecl = string | { field: string; boost?: number }

// ---------------------------------------------------------------------------
// The type-enriched document projection
// ---------------------------------------------------------------------------

/**
 * The index value type of a projected field — schema-derived by core, so a
 * driver can map the field onto its own schema without re-inspecting the
 * collection definition (Solr dynamic-field suffixes like `_txt` / `_i` /
 * `_ss`, Postgres store columns, etc.).
 */
export type SearchFieldType =
  /** Free-text, full-text-tokenised (text / textArea / select label / extracted rich-text). */
  | 'text'
  /** Exact-match string, not tokenised (slug, enum value). */
  | 'keyword'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'datetime'
  /** Controlled-vocabulary reference — value is {@link SearchFacetValue}[]. */
  | 'facet'

/**
 * What a projected field is *for*, declared by the collection's role-based
 * `search` config:
 * - `body` — feeds the full-text searchable content
 * - `facet` — a controlled-vocabulary reference (term indexed, id aggregated)
 * - `filter` — a scalar projected for filtering / sorting (not scored)
 */
export type SearchFieldRole = 'body' | 'facet' | 'filter'

/**
 * One controlled-vocabulary facet value: the aggregation key (the target's
 * `counter` field value — the stable small-int id used by facet URLs and
 * the aggregator) plus the localized term (the target's `useAsTitle`),
 * which is folded into the searchable text so a free-text query matches it.
 */
export interface SearchFacetValue {
  id: number | string
  term: string
}

/**
 * A single field in the {@link SearchDocument} projection — a value plus the
 * type and role a driver needs to index it. `name` is the field path and
 * the default index field name.
 */
export interface SearchField {
  /** Field path within the document, e.g. `'title'`, `'abstract'`, `'topics'`. */
  name: string
  /** Schema-derived index value type. */
  type: SearchFieldType
  /** Config-declared role. */
  role: SearchFieldRole
  /** Extracted, locale-resolved value. */
  value: string | number | boolean | SearchFacetValue[] | null
  /**
   * Optional relevance weight for scoring providers that support it
   * (`capabilities.weighting`). Postgres maps it to a `setweight` class,
   * Solr to a `qf` field boost; providers without weighting ignore it.
   * Unset means the provider default.
   */
  boost?: number
}

/**
 * The flat, provider-agnostic, type-enriched representation of a document
 * that core feeds to a `SearchProvider`. Assembled from the EAV store by
 * core; the provider indexes it without any knowledge of store tables or
 * path notation.
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
   * Always present for hit display, independent of the `body` projection.
   */
  title: string
  /** The document's URL path, or `null` when the collection has none. */
  path: string | null
  /**
   * The typed, role-tagged field projection the driver consumes. Built only
   * from the fields the collection's `search` config opts into — nothing is
   * auto-pulled, so unindexed content (editorial notes, etc.) never leaks.
   */
  fields: SearchField[]
  /** ISO-8601 timestamp of the indexed version. */
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Query surface
// ---------------------------------------------------------------------------

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
  /**
   * Total matches across all pages (not just the returned `hits`).
   *
   * This is the *provider's* count. When the querying collection applies
   * `beforeRead` row scoping, unauthorized hits are dropped **after**
   * ranking (see `CollectionHandle.search`), so `total` — like facet
   * counts — is approximate under scoping and exact without it.
   */
  total: number
  /**
   * Facet buckets keyed by field name, when `facets` was requested and the
   * driver supports them.
   */
  facets?: Record<string, SearchFacetBucket[]>
}

// ---------------------------------------------------------------------------
// The provider seam
// ---------------------------------------------------------------------------

/**
 * What a given driver can actually do. Lets consumers (the admin UI, the
 * MCP tool) light up facets / typo-tolerance / semantic / weighting features
 * only where the registered driver supports them, and keeps optional
 * capabilities (e.g. BM25, which depends on a Postgres extension that isn't
 * universally available) honest about a deployment's real reach rather than
 * assumed.
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
  /** Per-field relevance weighting (`SearchField.boost`). */
  weighting: boolean
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
