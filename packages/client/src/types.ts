/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RequestContext } from '@byline/auth'
import type {
  BylineLogger,
  CollectionDefinition,
  IDbAdapter,
  IStorageProvider,
  MissingLocalePolicy,
  PopulateSpec,
  PredicateValue,
  QueryPredicate,
  ReadContext,
  ReadMode,
  RichTextPopulateFn,
  RichTextToTextFn,
  SearchProvider,
  ServerConfig,
  SlugifierFn,
  SortSpec,
} from '@byline/core'

// Re-exported for callers who reach the predicate language through the
// client surface. The canonical definitions live in `@byline/core` so
// hooks (`CollectionHooks.beforeRead`) and the client share one type.
export type {
  FilterOperators,
  PredicateValue,
  QueryPredicate,
  SearchFacetBucket,
  SearchHit,
  SearchProvider,
  SearchResults,
  SortDirection,
  SortSpec,
} from '@byline/core'

// ---------------------------------------------------------------------------
// Client construction
// ---------------------------------------------------------------------------

export interface BylineClientConfig {
  /**
   * Convenience shorthand: pass an already-resolved `ServerConfig` (typically
   * from `getServerConfig()`) to seed `db`, `collections`, `storage`,
   * `slugifier`, and `defaultLocale` in one go. Each disaggregated prop
   * below is still accepted and overrides the corresponding value pulled
   * from `config`, so tests and migrations can substitute pieces:
   *
   * ```ts
   * createBylineClient({
   *   config: getServerConfig(),
   *   requestContext: () => createRequestContext({ readMode: 'published' }),
   * })
   * ```
   *
   * The SDK does *not* call `getServerConfig()` itself — the caller does —
   * so seeds, scripts, and tests that want to construct a client without a
   * registered server config can keep passing the disaggregated props.
   */
  config?: ServerConfig
  /** The database adapter (e.g. from @byline/db-postgres). Required when `config` is omitted. */
  db?: IDbAdapter
  /** All registered collection definitions. Required when `config` is omitted. */
  collections?: CollectionDefinition[]
  /** Optional storage provider — needed for delete file cleanup. */
  storage?: IStorageProvider
  /**
   * Optional search provider (`ServerConfig.search`). When present,
   * `collection(path).search(...)` delegates ranked queries to it. When
   * omitted (and not provided via the `config` shorthand's `search`), calling
   * `search()` throws a clear error pointing at provider registration.
   */
  search?: SearchProvider
  /**
   * Optional richtext plain-text extractor (`ServerConfig.fields.richText.toText`).
   * Used by the search-indexing methods (`indexDocument` / `reindex`) to feed
   * a collection's searchable `body` from rich-text fields. When omitted, those
   * fields are skipped.
   */
  richTextToText?: RichTextToTextFn
  /**
   * The installation's content locales (`ServerConfig.i18n.content.locales`).
   * The search-indexing methods iterate them to index one row per
   * `(document, locale)`. Falls back to `[defaultLocale]` when not provided.
   */
  contentLocales?: string[]
  /**
   * Optional logger. Used by the write path to emit structured events
   * from `document-lifecycle`. When omitted, the client falls back to
   * `getLogger()` if `initBylineCore()` has registered one, else uses a
   * silent no-op logger so scripts and tests run without setup.
   */
  logger?: BylineLogger
  /**
   * Default content locale. Forwarded to `DocumentLifecycleContext`,
   * used to anchor `path` derivation, and applied as the implicit
   * default for `locale` on every read method (`find`, `findOne`,
   * `findById`, `findByPath`). Resolved in priority order:
   *   1. explicit `defaultLocale` on the client config
   *   2. `config.i18n.content.defaultLocale` when a `ServerConfig` is
   *      passed via `config`
   *   3. `'en'` as a last-resort fallback for tests / migration scripts
   *      that never configure i18n.
   */
  defaultLocale?: string
  /**
   * Optional installation slugifier, forwarded to the lifecycle. When
   * omitted, the lifecycle uses the default `slugify` from `@byline/core`.
   */
  slugifier?: SlugifierFn
  /**
   * Optional richtext server-side populate function. Threaded into
   * `populateDocuments` so populated targets get their rich-text leaves
   * refreshed before `afterRead` fires; also called for source documents
   * after relation populate completes. When omitted (and not provided via
   * the `config` shorthand's `fields.richText.populate`), rich-text
   * populate is skipped — the read returns whatever was embedded at
   * write time.
   */
  richTextPopulate?: RichTextPopulateFn
  /**
   * Request-scoped auth context. Required in practice — every read and
   * write call from this client resolves a context and enforces
   * `collections.<path>.<verb>` at the service boundary.
   *
   * Accepts either:
   *   - a static `RequestContext` — convenient for long-lived processes
   *     that authenticate once (seeds, migrations, CLI tooling); or
   *   - a factory `() => RequestContext | Promise<RequestContext>` —
   *     resolved per-call so each operation picks up the current
   *     authenticated request (the pattern Phase 5's admin webapp will
   *     use to thread middleware-derived actors).
   *
   * When omitted, calls fail closed with `ERR_UNAUTHENTICATED`. Scripts
   * and tests pass `createSuperAdminContext()` from `@byline/auth`.
   */
  requestContext?: RequestContext | (() => RequestContext | Promise<RequestContext>)
}

// ---------------------------------------------------------------------------
// Query options
// ---------------------------------------------------------------------------

/**
 * Common populate options shared by every read method. `populate` names
 * the relations (or passes `true` for all) to replace with their target
 * documents; `depth` caps the traversal (default 1 when populate is set,
 * 0 otherwise). Clamped to the request's internal `ReadContext.maxDepth`.
 */
interface PopulateControls {
  populate?: PopulateSpec
  depth?: number
  /**
   * Escape hatch for read-side hook re-entry. Carries the visited set,
   * depth clamp, and `afterReadFired` set across nested reads so the
   * A→B→A recursion guard stays intact.
   *
   * Threading rules:
   *
   *   - **Public callers**: leave undefined. A fresh context is created
   *     per top-level read.
   *   - **Inside `afterRead` / lifecycle hooks**: if the hook calls back
   *     into the client, pass `readContext` through as `_readContext`
   *     verbatim. Do not fabricate a new one — doing so bypasses the
   *     "once per document per logical request" guard and risks
   *     unbounded hook re-firing.
   *   - **Don't reuse across top-level calls**: a context from a
   *     previous `find()` still carries that request's visited set, so
   *     reusing it will silently suppress `afterRead` on documents
   *     already seen. Contexts are per-request, not per-client.
   *
   * @internal
   */
  _readContext?: ReadContext
}

/**
 * Read-mode selector shared by every read method.
 *
 *   - `'published'` (client default) — return the latest *published*
 *     version of each document, falling back past newer drafts so public
 *     readers keep seeing previously-published content while editors
 *     work on an unpublished draft. A document with no published
 *     version is invisible in this mode. Populated relation targets
 *     follow the same rule.
 *   - `'any'` — return the latest version regardless of status.
 *     Admin UIs (which surface in-progress drafts) should pass this
 *     explicitly.
 *
 * Distinct from `where.status`, which is an *exact-match filter* on the
 * selected version's status column ("show me all drafts"). `status` is
 * the *source view* selector.
 */
interface StatusControls {
  status?: ReadMode
}

/**
 * Options for `CollectionHandle.search(...)` — a ranked full-text query
 * scoped to this collection, delegated to the registered `SearchProvider`.
 * `collectionPath` is implied by the handle, so callers supply only the
 * query and optional scoping. `status` defaults to `'published'` (public
 * readers); pass `'any'` for admin contexts.
 */
export interface CollectionSearchOptions {
  /** Free-text query string. */
  query: string
  /** Restrict to a single content locale (defaults to the client default). */
  locale?: string
  /** Read mode — `'published'` (default) or `'any'`. */
  status?: ReadMode
  /** Structured filters AND-merged with the text query (driver-dependent). */
  where?: QueryPredicate
  /** Field names to compute facet buckets for (driver-capability gated). */
  facets?: string[]
  /** Max hits to return. */
  limit?: number
  /** Offset for pagination. */
  offset?: number
}

/** Outcome of a collection `reindex()` — counts for reporting. */
export interface ReindexResult {
  /** Collection that was reindexed. */
  collectionPath: string
  /** Number of published documents walked. */
  documents: number
  /** Number of `(document, locale)` index rows upserted. */
  indexed: number
}

/**
 * What a read does when the requested content locale is missing. Shared by
 * every read method. `@byline/client` defaults this to `'fallback'`.
 *
 *   - `'fallback'` (client default) — always return content. A document
 *     requested in a locale it has not been translated into falls back through
 *     the locale chain to the default content locale: a detail read still
 *     returns the document (rendered in the default locale); a list read still
 *     includes it.
 *   - `'empty'` — restore the requested locale exactly, leaving untranslated
 *     localized fields empty (the raw per-locale view; what the admin editor
 *     uses). The document is still returned.
 *   - `'omit'` — only surface documents available in the requested locale. A
 *     detail read returns `null` (so callers can 404); a list read excludes
 *     untranslated documents (filtered at the SQL layer, so the page count and
 *     `total` stay correct). A document with no localized content is available
 *     in every locale.
 *
 * Availability is the version-grain ledger described in
 * `docs/I18N.md`. Relationship population always behaves
 * as `'fallback'` so a populated tree never has holes.
 */
interface MissingLocaleControls {
  onMissingLocale?: MissingLocalePolicy
}

/**
 * Read-side access-control escape hatch shared by every read method.
 *
 *   - `_bypassBeforeRead?: true` — skip the `CollectionHooks.beforeRead`
 *     hook for this read. Reserved for admin tooling, migrations, and
 *     seed scripts that need unscoped access; never use from application
 *     code, since it deliberately disables the predicate that enforces
 *     row-level read access (multi-tenant scoping, owner-only-drafts,
 *     soft-delete hide, etc).
 *
 * @internal
 */
interface BeforeReadControls {
  _bypassBeforeRead?: true
}

export interface FindOptions<F = Record<string, any>>
  extends PopulateControls,
    StatusControls,
    MissingLocaleControls,
    BeforeReadControls {
  /** Filter documents. Keys are field names or reserved names (status, path). */
  where?: WhereClause
  /** Return only these fields. Omit for all fields. */
  select?: (keyof F & string)[] | string[]
  /** Sort specification. Keys are field names or document-level columns. */
  sort?: SortSpec
  /** Locale for field value resolution. Defaults to the client's `defaultLocale`. */
  locale?: string
  /** Page number (1-based). Defaults to 1. */
  page?: number
  /** Documents per page. Defaults to 20. */
  pageSize?: number
}

export interface FindOneOptions<F = Record<string, any>>
  extends PopulateControls,
    StatusControls,
    MissingLocaleControls,
    BeforeReadControls {
  where?: WhereClause
  select?: (keyof F & string)[] | string[]
  locale?: string
}

export interface FindByIdOptions<F = Record<string, any>>
  extends PopulateControls,
    StatusControls,
    MissingLocaleControls,
    BeforeReadControls {
  select?: (keyof F & string)[] | string[]
  locale?: string
  /**
   * "Best-effort" reconstruction. When `true`, schema-mismatch warnings
   * (e.g. a field's type was changed and old rows can't be rebuilt against
   * the new shape) are surfaced on the returned `ClientDocument` as
   * `_restoreWarnings` instead of being thrown. Intended for the admin
   * edit path only — public reads should leave this `false` so partial
   * data never reaches end users.
   */
  lenient?: boolean
}

export interface FindByPathOptions<F = Record<string, any>>
  extends PopulateControls,
    StatusControls,
    MissingLocaleControls,
    BeforeReadControls {
  select?: (keyof F & string)[] | string[]
  locale?: string
}

/**
 * Options for `CollectionHandle.history(documentId, options)`. The history
 * endpoint is paginated; `order` / `desc` mirror the storage adapter's
 * version-row sort axes. `_bypassBeforeRead` skips the `findById` access
 * gate for admin tooling.
 */
export interface HistoryOptions extends BeforeReadControls {
  locale?: string
  page?: number
  pageSize?: number
  order?: string
  desc?: boolean
  /** @internal — see `_readContext` on read options. */
  _readContext?: ReadContext
}

/**
 * Options for `CollectionHandle.auditLog(documentId, options)`. The
 * document-grain audit log (docs/AUDIT.md — Workstream 3) records the
 * non-versioned changes the immutable version stream does not capture an
 * actor for: system-field writes (path, available-locales), in-place status
 * transitions, and the deletion event. Entries are newest-first and paged;
 * `_bypassBeforeRead` skips the `findById` access gate for admin tooling.
 */
export interface AuditLogOptions extends BeforeReadControls {
  page?: number
  pageSize?: number
  /** Locale used by the access-gate `findById`. Defaults to the client's `defaultLocale`. */
  locale?: string
  /** @internal — see `_readContext` on read options. */
  _readContext?: ReadContext
}

/**
 * Options for `CollectionHandle.findByVersion(versionId, options)`. No
 * `BeforeReadControls` — `findByVersion` is a low-level pass-through
 * intended for admin diff views; row-level scoping is the caller's
 * responsibility (typically by gating with a prior `findById` call).
 */
export interface FindByVersionOptions<F = Record<string, any>> {
  select?: (keyof F & string)[] | string[]
  locale?: string
}

// ---------------------------------------------------------------------------
// Write options
// ---------------------------------------------------------------------------

export interface CreateOptions {
  /** Locale for field value resolution. Defaults to the client's `defaultLocale`. */
  locale?: string
  /**
   * Initial workflow status. When omitted, `document-lifecycle` derives
   * the collection's default (usually `'draft'`).
   */
  status?: string
  /**
   * Explicit `path` override (written into `byline_document_paths` keyed
   * by `(document_id, defaultContentLocale)`). When omitted the lifecycle
   * derives a path from `definition.useAsPath` (or falls back to a UUID).
   */
  path?: string
  /**
   * The editorial advertised-locale set, stored document-grain in
   * `byline_document_available_locales`. When omitted, a new document starts
   * with an empty set; an explicit array (empty included) is stored verbatim.
   * Surfaced on reads as `availableLocales`. See `docs/I18N.md`.
   */
  availableLocales?: string[]
}

export interface UpdateOptions {
  /** Locale for field value resolution. Defaults to the client's `defaultLocale`. */
  locale?: string
  /**
   * Explicit path override. When omitted, the previous version's path
   * carries forward unchanged (sticky).
   */
  path?: string
  /**
   * The editorial advertised-locale set. When omitted, the existing set
   * carries forward unchanged (sticky — document-grain, like `path`); an
   * explicit array (empty included) replaces it wholesale. Surfaced on reads
   * as `availableLocales`. See `docs/I18N.md`.
   */
  availableLocales?: string[]
}

// ---------------------------------------------------------------------------
// Document-tree options (the `tree: true` primitive — docs/DOCUMENT-TREE.md)
// ---------------------------------------------------------------------------

/**
 * Options for `CollectionHandle.placeTreeNode(documentId, options)`. Places or
 * moves a node within the collection's single-parent ordered tree — one upsert
 * covering place / reorder / re-parent.
 *
 * Neighbour semantics match `reorderCollectionDocument`: `beforeDocumentId` is
 * the sibling the node should land immediately **after** (its left neighbour);
 * `afterDocumentId` is the sibling it should land immediately **before** (its
 * right neighbour). Both are resolved within the *target* parent group; either
 * may be null/omitted (append as last child, or prepend before a given sibling).
 */
export interface PlaceTreeNodeOptions {
  /** The new parent; `null` makes the node a root. */
  parentDocumentId: string | null
  /** Left neighbour — the node lands immediately after it. */
  beforeDocumentId?: string | null
  /** Right neighbour — the node lands immediately before it. */
  afterDocumentId?: string | null
}

/**
 * Options for `CollectionHandle.getSubtree(options)`. Reads a node's subtree as
 * a nested {@link TreeNode} forest. `rootDocumentId: null` (the default) reads
 * the whole tree from the collection's roots; a value reads the subtree rooted
 * at (and including) that node. `depth` bounds the descent (0-based; the root is
 * depth 0). `status` follows the usual published/any selector — in `'published'`
 * mode an unpublished node hides its entire subtree (the spine breaks).
 */
export interface GetSubtreeOptions<F = Record<string, any>> extends StatusControls {
  rootDocumentId?: string | null
  depth?: number
  /** Locale for field value resolution. Defaults to the client's `defaultLocale`. */
  locale?: string
  /** Return only these fields on each node. Omit for all fields. */
  select?: (keyof F & string)[] | string[]
}

/**
 * Options for `CollectionHandle.getAncestors(documentId, options)`. Walks the
 * node's ancestor chain upward, returning the ancestors **root-first** (the
 * breadcrumb trail, excluding the node itself). In `'published'` mode only
 * ancestors with a published version are returned.
 */
export interface GetAncestorsOptions<F = Record<string, any>> extends StatusControls {
  /** Locale for field value resolution. Defaults to the client's `defaultLocale`. */
  locale?: string
  /** Return only these fields on each ancestor. Omit for all fields. */
  select?: (keyof F & string)[] | string[]
}

/**
 * A node in a hydrated document tree. `document` is the fully-shaped
 * `ClientDocument`; `depth` is 0-based from the subtree root; `children` are the
 * node's ordered children (per-parent `order_key` order).
 */
export interface TreeNode<F = Record<string, any>> {
  document: ClientDocument<F>
  depth: number
  children: TreeNode<F>[]
}

// ---------------------------------------------------------------------------
// Where clause
// ---------------------------------------------------------------------------

/**
 * A where clause maps field names (or reserved document-level names like
 * `status` and `path`) to either a bare value (equality), an operator
 * object, or — for relation fields — a nested where clause against the
 * target collection. Reserved keys:
 *   - `status` — exact match on document version status column
 *   - `query`  — text search across the collection's configured search fields
 *   - `path`   — document version path column (supports operators)
 *
 * All other keys are resolved against the collection's field definitions
 * and compiled into EXISTS subqueries over the EAV store tables. When a
 * relation field's value is a plain object with no `$`-prefixed keys it
 * is treated as a nested where against the target collection — the
 * adapter emits a nested EXISTS through `store_relation`, recursing into
 * the target's own EAV stores:
 *
 * ```ts
 * where: {
 *   category: { path: 'news' },       // → docs whose category's path is 'news'
 *   title: { $contains: 'launch' },    // ordinary field filter
 * }
 * ```
 *
 * `WhereClause` is a backwards-compatible alias for the canonical
 * `QueryPredicate` from `@byline/core`. The client-facing `where` clause
 * and a `CollectionHooks.beforeRead` return value share one structure, so
 * combinators (`$and`, `$or`) are usable on both surfaces.
 */
export type WhereClause = QueryPredicate

/** Backwards-compatible alias for `PredicateValue` from `@byline/core`. */
export type WhereValue = PredicateValue

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------
// `SortSpec` and `SortDirection` are re-exported from `@byline/core` at the
// top of this file. The canonical definitions moved to core alongside
// `parseSort` / `parseWhere` so populate (which lives in core) can compile
// hook predicates without a layer-crossing import.

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/**
 * Shape of a document returned by the client API.
 *
 * The generic parameter `F` types the `fields` object. Callers that know
 * their collection's shape can narrow it:
 *
 * ```ts
 * interface Post { title: string; body: string }
 * const post = await client.collection('posts').findById<Post>(id)
 * post?.fields.title // typed as string
 * ```
 *
 * Defaults to `Record<string, any>` when no shape is provided.
 */
export interface ClientDocument<F = Record<string, any>> {
  /** Logical document ID. */
  id: string
  /** The specific version ID for this document. */
  versionId: string
  /** URL-friendly slug/path for this document. */
  path: string
  /** Workflow status (e.g. 'draft', 'published'). */
  status: string
  /**
   * The document's content **source locale** — the locale it was authored in,
   * and its per-document anchor (fallback floor, path locale, completeness
   * yardstick). Stable, document-grain. Surfaced so consumers / the admin can
   * indicate a document whose primary language differs from the system default.
   * Present on `find` / `findById` / `findByPath`. See
   * `docs/I18N.md`.
   */
  sourceLocale?: string
  /** When this version was created. */
  createdAt: Date
  /** When this version was last updated. */
  updatedAt: Date
  /**
   * The acting user's id that created **this version** (storage column
   * `byline_document_versions.created_by`). Because versions are immutable,
   * the creator of the current version is also "who last updated the
   * document". Absent on rows written before audit wiring or by
   * internal tooling without a request context. Raw id only — display-name
   * resolution is an admin-realm concern (see docs/AUDIT.md — Workstream 1).
   */
  createdBy?: string
  /**
   * The lifecycle action that produced this version (storage column
   * `event_type`): `create` / `update` / `restore` / `copy_to_locale` /
   * `delete_locale`. Surfaced for audit rendering in history views.
   */
  eventType?: string
  /** Reconstructed field data. */
  fields: F
  /**
   * Schema-mismatch warnings produced by a "best-effort" reconstruction
   * (`findById` with `lenient: true`). Present only when the document was
   * loaded leniently and at least one orphan row was skipped — for example,
   * after a `CollectionDefinition` change retired or replaced a field and
   * older rows can no longer be rebuilt against the new shape. Absent on
   * normal reads.
   */
  _restoreWarnings?: string[]
  /**
   * The editorial *advertised* locale set — the content locales the editor
   * has deliberately elected to promote for this document. Document-grain and
   * stored (in `byline_document_available_locales`), sticky across versions —
   * not derived. The deliberate counterpart to the structural
   * `_availableVersionLocales` fact below; the public advertised set is their
   * intersection (`availableLocales ∩ _availableVersionLocales`), which the
   * host composes for hreflang / sitemap / "Also available in…" menus.
   * Present on `find` / `findById` / `findByPath`. See `docs/I18N.md`.
   */
  availableLocales?: string[]
  /**
   * Content locales this document's resolved version is *structurally*
   * available in — path-coverage against the default content locale, from the
   * version-grain `byline_document_version_locales` ledger. Computed, read-only.
   * Present on `find` / `findById` / `findByPath` (absent on version/history
   * reads); the published-available set on a normal (published) read. The
   * structural fact reconciled against the editorial `availableLocales` above.
   * See `docs/I18N.md`.
   */
  _availableVersionLocales?: string[]
  /**
   * `true` when the document has no localized content — it renders identically
   * in every locale and `_availableVersionLocales` is empty. A per-document
   * language affordance should render nothing in this case.
   */
  _localeAgnostic?: boolean
}

export interface FindResult<F = Record<string, any>> {
  docs: ClientDocument<F>[]
  meta: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

// ---------------------------------------------------------------------------
// Populate type helpers
// ---------------------------------------------------------------------------

/**
 * The shape a populated relation leaf takes when `populate` (or `populate: '*'`)
 * is in scope for that field. Wraps the populated target as a `ClientDocument<T>`
 * on `.document`. Optional because the slot may also resolve to an
 * unresolved (`_resolved: false`) or cycle (`_cycle: true`) marker, in which
 * cases `document` is absent.
 */
export interface PopulatedRelation<T> {
  document?: ClientDocument<T>
}

/**
 * Re-type one key of a schema-inferred fields type as a populated relation.
 * Use to overlay populate's per-call enrichment on top of the unpopulated
 * shape that `CollectionFieldData<typeof X>` derives from the schema.
 *
 * Homomorphic mapped form preserves the optionality of the underlying key —
 * an optional relation field stays optional after populate is layered on.
 *
 * ```ts
 * type NewsPopulated = WithPopulated<
 *   WithPopulated<NewsFields, 'category', NewsCategoryFields>,
 *   'featureImage', MediaFields
 * >
 * client.collection('news').find<NewsPopulated>({ populate: { category: '*', featureImage: '*' } })
 * ```
 */
export type WithPopulated<F, K extends keyof F, Target> = {
  [P in keyof F]: P extends K ? PopulatedRelation<Target> : F[P]
}

/**
 * `hasMany` counterpart of {@link WithPopulated}: re-types key `K` as an
 * **ordered array** of populated relation envelopes. Use for `hasMany: true`
 * relation fields, whose populated value is `PopulatedRelation<Target>[]` (one
 * envelope per referenced target, in stored order).
 *
 * ```ts
 * type ArticlePopulated = WithPopulatedMany<ArticleFields, 'authors', AuthorFields>
 * client.collection('articles').find<ArticlePopulated>({ populate: { authors: '*' } })
 * ```
 */
export type WithPopulatedMany<F, K extends keyof F, Target> = {
  [P in keyof F]: P extends K ? Array<PopulatedRelation<Target>> : F[P]
}
