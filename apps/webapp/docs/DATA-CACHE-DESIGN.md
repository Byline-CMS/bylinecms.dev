# L1 in-memory data cache — design & implementation

> Status: implemented (opt-in, disabled by default).
> Scope: the `docs`, `news`, `pages`, and `news-categories` read paths in this webapp.
> Companion: `bylinecms.dev/docs/CACHING.md` (the framework-level L1/L2/L3/L4 strategy this realises).

This document records the design decisions behind the optional **L1 in-memory
data cache** added to this app: where it came from, the one real defect we
fixed on the way in, how it's wired, and the few Byline-specific gotchas that
shaped the invalidation strategy.

It exists alongside the already-deployed **L2 CDN layer**
(`src/middleware/public-cache.ts`). L2 shields the origin from anonymous
traffic; L1 sits underneath it and shields Postgres for the fraction of
traffic that reaches origin (cache misses, SWR refreshes, the short windows
after each edit, and all signed-in/editor traffic that L2 deliberately
bypasses).

---

## Part A — Why this cache, and the library review

The starting point was the proven L1 cache in our sibling project
`infonomic.io` (`apps/webapp/src/lib/cache`), which fronts Payload's local
API. We evaluated it for reuse here.

### The stack

A thin tag layer over three small, mainstream, actively-maintained libraries:

| Library | Role |
|---|---|
| `cache-manager` (v7) | orchestration — `wrap`, `get`/`set`/`del`, `refreshThreshold` (in-memory SWR), and single-flight coalescing of concurrent `wrap` calls for the same key |
| `keyv` (v5) | the store interface |
| `cacheable` → `KeyvCacheableMemory` (v2) | the bounded in-memory LRU itself (`lruSize`, per-entry `ttl`) |
| *custom* `TagsManager` | tag → key bookkeeping for tag-based invalidation |

The library choices are right: small, no native addons, and the
`wrap` + `refreshThreshold` pairing gives in-memory SWR that maps cleanly onto
the L1 row of `CACHING.md`. **Fit for purpose — reused here.** But the custom
tag layer had one real defect and one performance smell that we fixed rather
than ported verbatim.

### The defect: the tag map leaked

`infonomic.io`'s `TagsManager` keeps a single `Map<key, Set<tag>>` that lives
*beside* the LRU. Entries are removed only by explicit
`invalidateKey`/`invalidateTag`. But the underlying data cache evicts entries
two ways the tag map never hears about:

- **TTL expiry** — `cacheable` drops the value after its TTL; the `key→tags`
  entry stays forever.
- **LRU capacity eviction** — past `lruSize` live keys, the tail is evicted;
  the tag entry stays.

So on a long-lived origin process with high key cardinality — and our keys
multiply across `collection × query × page × locale × read-mode` — the tag map
grows without bound even though the data cache is capped. A slow leak. Plus
`invalidateTag` did `Array.from(map.entries()).filter(...)` — an O(n) scan over
that ever-growing map on every invalidation.

> We initially considered adopting `cacheable`'s native tag support to delete
> the custom layer entirely. **`cacheable@2.3.5` (the installed version) has no
> tag API** (`deleteByTag`/`tags` don't exist in the package), so that option
> doesn't apply. We kept the proven `cache-manager` + `keyv` + `cacheable`
> stack and fixed the tag layer itself.

### Alternatives considered

| Option | Verdict |
|---|---|
| Port `TagsManager` as-is | Rejected — ships the leak. |
| **Port the stack, rewrite the tag layer (chosen)** | Keeps `refreshThreshold` SWR + coalescing; fixes the leak; no new deps. |
| `lru-cache` (isaacs) + bespoke tags | Single dep, fastest, byte-bounding — but more tag plumbing to own and loses cache-manager's coalescing. Overkill at this scale. |
| Redis / Memcached | Over-engineered for single-origin + CDN. Reserved for genuine multi-instance + strict-freshness needs. |
| Framework cache (`unstable_cache`/`revalidateTag`) | N/A — that's Next.js. We're on TanStack Start, so an app-owned cache is correct (and `@byline/*` deliberately ships none). |

---

## The tag-map fix

`src/lib/cache/tagged-cache.ts` (`TaggedCache`) is the corrected successor to
`TagsManager`. The value side is untouched — `wrap` delegates straight to
`cache-manager.wrap`, preserving `refreshThreshold` SWR and concurrent-call
coalescing. Only the bookkeeping changed:

1. **`keyToTags` is itself a bounded LRU.** It's an insertion-ordered `Map`
   capped at `maxTrackedKeys` (defaults to the data cache's `lruSize`).
   Re-tracking a key moves it to the end (most-recently-used); when the cap is
   exceeded the least-recently-tracked key is evicted and its reverse-index
   references cleaned. The tag bookkeeping can therefore **never outgrow the
   data cache it shadows** — no timers, no background sweep.

2. **A reverse index `tagToKeys: Map<tag, Set<key>>`** makes `invalidateTag`
   **O(keys-for-this-tag)** instead of O(all-keys).

3. **Self-healing invalidation.** Deleting a key removes it from every tag set,
   and `del()` on an already-evicted key is a harmless no-op. A key that
   expired from the data cache (TTL) but is still within the most-recent
   `maxTrackedKeys` window lingers in the tag maps only until it's pushed out
   or its tag is next invalidated — bounded, and correctness-neutral.

`TaggedCache.stats()` exposes `{ trackedKeys, trackedTags }` as a cheap health
signal (and to assert the bound in tests). Coverage:
`src/lib/cache/tagged-cache.test.node.ts` (run with `pnpm vitest --mode node`).

---

## Part B — How it's wired in this app

### Files

| File | Responsibility |
|---|---|
| `src/lib/cache/cache-manager.ts` | builds the singleton `cache-manager` store (`LRU_SIZE`, `DEFAULT_TTL_MS`) |
| `src/lib/cache/tagged-cache.ts` | `TaggedCache` — the fixed tag layer |
| `src/lib/cache/cluster-manager.ts` | optional Fly fan-out (off by default) |
| `src/lib/cache/index.ts` | public API: `getCache`, `store`, `storeFunction`, `retrieve`, `invalidateTag`, `invalidateKey`, `clear` |
| `src/lib/cache/with-cache.ts` | `withCache` read wrapper + `cacheKeys` / `tags` conventions + write-side `invalidateDocument` / `invalidateCollection` helpers |

### The read path — `withCache`

`withCache` is the Byline analogue of `infonomic.io`'s `executeWithOptions`,
adapted for the TanStack Start server-fn / `BylineClient` read path. It calls
the wrapped `fn` directly (no caching) when **either**:

1. `cache.dataRequests` is not enabled (the master switch — default off), or
2. `preview === true` — a signed-in editor with preview active. The server fns
   already compute this via `isPreviewActive()` (cookie + admin session), so
   bypass is a one-line guard. **Editors never read from L1**, so a draft can
   never be cached and served to anonymous traffic.

Wired into every public read path of the four covered collections:

- `docs` — `modules/docs/{list,detail,get-docs-sitemap}.ts`
- `news` — `modules/news/{list,detail,get-news-sitemap,categories}.ts`
- `pages` — `modules/pages/{detail,get-pages-sitemap}.ts`
- `news-categories` — read via `modules/news/categories.ts`

Cache keys encode everything that determines the response — collection, shape
(list/detail/sitemap), path, locale, and read mode — via the `cacheKeys`
helper, so neither a draft nor a wrong-locale entry can ever be served. The
news list additionally folds its filter + pagination inputs (`category`,
`page`, `pageSize`) into the key via `cacheKeys.list(..., params)`, serialised
deterministically (sorted, `undefined` dropped). Sitemaps use a 1h TTL — they
are full-collection scans that change infrequently.

### The invalidation path — tag scheme (per-document)

Now that every Byline lifecycle hook carries the document `path` (`@byline/core`
3.1+), invalidation is **per-document**, not collection-wide. Each cached read
carries two tags — a granular one for its own shape, plus the coarse
`collection` tag kept only as a deliberate "big hammer" (see below):

| Read | Tags |
|---|---|
| list | `cms::<col>`, `cms::<col>::list` |
| detail | `cms::<col>`, `cms::<col>::detail::<path>` |
| sitemap | `cms::<col>`, `cms::<col>::sitemap` |

The `detail` tag is **locale-agnostic** (no locale in it) so one edit clears
every locale rendering of that document. Cache *keys* still include locale,
filter, and pagination; only the tags collapse them.

#### Locale rule: cache per-locale, invalidate all-locales

We **serve and cache by locale** (the key carries `lng`, so `en` / `fr` / `de`
are distinct entries) but **tag and invalidate at the document grain across all
locales** (the `detail` / `list` / `sitemap` tags omit locale). So editing the
French content of a document clears the cached English and German renderings
too. This is the *correct* default, not just a convenient over-approximation:

1. **Documents mix localized and non-localized fields.** Detail reads populate
   non-localized data — `featureImage`, `publishedOn`, the `category` relation,
   `path` itself. A single edit can change a *shared* field, and that must
   surface in every locale. Per-locale invalidation would serve stale shared
   data; all-locale invalidation cannot.
2. **The hook can't reliably say which locale was written.** A plain
   `afterUpdate` context exposes `data` / `originalData` / `path` but no general
   "this was the `fr` write" signal (only `copyToLocale` / `deleteLocale` carry
   a locale). All-locale is the safe choice the context actually supports.
3. **Over-invalidation is safe and cheap** — at worst one re-fetch per locale on
   next access, never a stale serve.

**Revisit trigger:** this rule assumes a single canonical `path` per document
(no localized paths in Byline yet), so the hook's `ctx.path` matches the route
`path` in every locale's cache key. When per-locale paths land, the URL path can
differ by locale and a single locale-agnostic path tag will no longer cover
them — the `detail` tag and `invalidateDocument`'s rename handling must change.

Hooks then invalidate exactly what an event touched (via the
`invalidateDocument` helper in `with-cache.ts`):

| Event | detail (this doc) | list | sitemap |
|---|:--:|:--:|:--:|
| `afterUpdate` (content edit) | ✓ (+ old path on rename) | ✓ *(list-bearing only)* | — *(lastmod rides TTL)* |
| `afterCreate` / `afterStatusChange` / `afterUnpublish` / `afterDelete` (structural) | ✓ | ✓ *(list-bearing only)* | ✓ |

The win over the old collection-wide sweep: **editing one document no longer
cold-starts every other document's cached detail.** On a large collection
(hundreds of articles) that is a large hit-rate improvement.

Per collection:

- **`pages`** — no list view (only detail + sitemap), so it gets the cleanest
  story: an edit invalidates *only* that page's detail; structural changes also
  clear the sitemap. No collection-wide sweep at all.
- **`docs` / `news`** — list-bearing, so edits also clear the `list` tag
  (title/summary surface in lists). Sitemap only on structural changes.

`afterStatusChange` / `afterUnpublish` are wired (not just create/update/delete)
because **publish/unpublish flow through the status lifecycle, not
`afterUpdate`** — they are the moment content becomes visible/invisible to
anonymous traffic, the most important triggers for a public site.

Hooks run **outside** the storage transaction (`@byline/core`
`document-lifecycle.ts`), so awaiting invalidation is safe. It is local-first
and synchronous; the optional cluster fan-out is fire-and-forget so a network
failure can never roll back or stall the editor's save.

#### The coarse `collection` tag — cross-collection embeds

Every entry still carries `cms::<col>` as a reserved big hammer for the case a
cached read embeds data from *another* collection. The one wired instance:
**`news` list and detail reads `populate` the related `category`** (and the list
filters by category `path`). So `news-categories` hooks call
`invalidateCollection('news-categories')` **and** `invalidateCollection('news')`
— clearing every news read at once, since a renamed/deleted category could be
embedded in any of them. This is the only hand-wired fan-out; keep such
couplings rare and explicit rather than computing a dependency graph. (`media`
is deliberately *not* wired this way — image edits are rarer than the TTL, so
the long TTL covers a stale embedded image.)

---

## Path on hook contexts — resolved upstream (`@byline/core` 3.1)

Earlier these contexts were "path-poor": only `afterUpdate` exposed the
document `path` (via `originalData.path`), so create / status-change / unpublish
/ delete could not invalidate a specific detail page and the cache fell back to
a collection-wide sweep. That was a historical artefact — the contexts predated
`path` being promoted to the document grain (see `bylinecms.dev`
`docs/DOCUMENT-PATHS.md`).

**Fixed in `@byline/core` 3.1:** `path` is now present on every lifecycle
context — `AfterCreateContext`, `AfterUpdateContext`, `StatusChangeContext`,
`Before/AfterUnpublishContext`, and `DeleteContext`. The per-document strategy
above relies on it. This app pins `@byline/core` `^3.1.0`.

> **Caveat — single canonical path.** Byline has no localized paths yet, so a
> document has one canonical `path` and we treat the hook's `ctx.path` as the
> truth for the locale-agnostic `detail` tag. When per-locale paths land, the
> `detail` tag (and the rename handling in `invalidateDocument`) must be
> revisited — an edit may then need to clear several per-locale path tags.

---

## Clustering (optional, Fly.io)

`src/lib/cache/cluster-manager.ts` fans invalidations out to sibling instances
over the Fly private network (6PN) — resolve `.internal` peers via Fly's
internal DNS, call each instance's local invalidation endpoint in parallel,
fire-and-forget. **Off by default** (`cache.clusterEnabled`).

Per `CACHING.md`, this is rarely the right first move: a single origin behind a
CDN with a 60s TTL never sees per-instance drift, because the CDN absorbs the
anonymous traffic and the TTL converges any drift within a minute. Enable it
only when the app genuinely runs as multiple always-on instances **and** the
sub-TTL drift becomes a visible complaint.

> **Not yet wired:** enabling cluster mode also requires a sibling-facing
> invalidation **endpoint** (the URL `cluster-manager.ts` calls,
> `/api/cache/invalidate?tag=…|key=…`) — a server route, bound to the private
> network only, that calls the local `invalidateTag`/`invalidateKey`. That
> route is intentionally **not** part of this scaffold; add it when/if
> clustering is turned on, and ensure it is not exposed on the public listener.

---

## Configuration

All server-only, read from `process.env` in `src/config/index.ts`
(`serverSchema.cache`). Unset ⇒ disabled ⇒ behaviour identical to before this
change.

| Env var | Meaning | Default |
|---|---|---|
| `CACHING_DATA_REQUESTS` | master switch for L1 | `false` |
| `CACHING_TTL` | default per-entry TTL, ms | `60000` |
| `CACHING_REFRESH_THRESHOLD` | SWR trigger — ms of *remaining* TTL; must be `< CACHING_TTL`; unset ⇒ no SWR | — |
| `CACHING_CLUSTER_ENABLED` | Fly cross-instance fan-out | `false` |
| `PRIVATE_NETWORK_DOMAIN` | Fly 6PN DNS name (cluster only) | — |
| `PRIVATE_NETWORK_APPLICATION_PORT` | sibling endpoint port (cluster only) | — |

`CACHING_TTL` / `CACHING_REFRESH_THRESHOLD` set the defaults applied by
`withCache`; individual call sites still override per read (e.g. sitemaps use a
1h TTL). The config schema rejects `CACHING_REFRESH_THRESHOLD >= CACHING_TTL` at
startup. `LRU_SIZE` (and the store-construction fallback `DEFAULT_TTL_MS`) live
in `src/lib/cache/cache-manager.ts`.

Recall `CACHING_REFRESH_THRESHOLD` is *remaining* TTL: with `CACHING_TTL=60000`
and `CACHING_REFRESH_THRESHOLD=20000`, an entry serves stale-while-revalidating
once it is older than 40s (its final 20s). Unset, expiry is a plain synchronous
miss — the one visitor who hits the expired entry waits for the refetch.

---

## Recommended order of adoption

1. **L2 CDN first** — already in place (`public-cache.ts`).
2. **Measure** — origin CPU, p95 DB time on hot reads, CDN hit rate.
3. **Enable L1** (`CACHING_DATA_REQUESTS=true`) on the hottest reads — done here
   for `docs`, `news`, `pages`, and `news-categories`. Apply the same
   `withCache` + collection-hook pattern to any further collections as load
   justifies.
4. **Active CDN purge** — add only where 60s propagation is too slow; keep the
   URL list short and collection-scoped.
5. **Cluster / shared cache** — only once genuinely multi-instance and the drift
   is visible. Wire the private-network endpoint, then flip
   `CACHING_CLUSTER_ENABLED`.

## Verifying

- Unit: `pnpm vitest --mode node src/lib/cache/tagged-cache.test.node.ts`.
- Behaviour: with `CACHING_DATA_REQUESTS=true`, hit a docs page twice
  anonymously (second is a cache hit), edit/publish it as an admin, then reload
  anonymously — the change appears within the TTL window, or immediately after
  the hook sweep. As an admin with preview active you always see it instantly
  (L1 bypassed).
- Health: `getCache()` is a `TaggedCache`; `.stats().trackedKeys` should never
  exceed `LRU_SIZE`.
