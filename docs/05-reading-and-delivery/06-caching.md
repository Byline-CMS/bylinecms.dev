---
title: "Caching"
path: "caching"
summary: "How Byline applications cache HTML at the CDN edge, how editors bypass that cache for instant preview, and where an optional in-memory data cache fits."
---

# Caching

Companions:
- [Routing & API](./02-routing-and-api.md) — the server-function transport layer that public reads ride on.
- [Authentication & Authorization](../06-auth-and-security/01-authn-authz.md) — the admin session and preview-cookie mechanics that the cache layer keys off.

## Overview

A Byline application has several places where work can be skipped on a hot read path. Each layer addresses a different bottleneck, so they compose rather than substitute for each other:

| Layer | Purpose | TTL | Invalidation |
|---|---|---|---|
| **L1 — In-memory data cache (per origin instance)** | Shields Postgres from repeated reads of the same query (popular pages, list views) | 30–60s, with a `refreshThreshold` for in-memory SWR | By tag, via Byline collection hooks (synchronous, in-process) |
| **L2 — CDN edge (e.g. Cloudflare)** | Shields the origin entirely for anonymous traffic; absorbs traffic spikes | `s-maxage=60`, `stale-while-revalidate=86400` | Short TTL (passive) and/or active purge by URL/tag from collection hooks |
| **L3 — Browser** | Minor; mostly relevant for static assets, not HTML | `max-age=0` on HTML by default | n/a |
| **L4 — Client-side route loaders (TanStack Query / Router)** | Smooth client-side transitions, request de-duplication | Per-query staleness | Tag-based refetch on mutation |

The `@byline/*` packages do not ship a caching layer of their own — caching policy is the application's concern. The demo `apps/webapp` in this repository contains worked examples of both: **L2** as copyable middleware (below), and **L1** as an opt-in tagged in-memory cache (`apps/webapp/src/lib/cache/`, off by default via `CACHING_DATA_REQUESTS`) whose consumers are the dynamic `sitemap.xml` route and the markdown export surface — the `.md` document representations and `llms.txt` (see [Markdown Export](./04-markdown-export.md) for that surface's tag and invalidation story). The full L1 design — stack choice, the tag-map fix, the per-document tag scheme, and the optional cluster fan-out — lives in [`apps/webapp/docs/DATA-CACHE-DESIGN.md`](https://github.com/Byline-CMS/bylinecms.dev/blob/develop/apps/webapp/docs/DATA-CACHE-DESIGN.md).

## L2 — CDN edge

The demo application carries a reference middleware that other TanStack Start hosts can copy verbatim or treat as a starting point:

- [`apps/webapp/src/middleware/public-cache.ts`](https://github.com/Byline-CMS/bylinecms.dev/blob/develop/apps/webapp/src/middleware/public-cache.ts) — `publicCacheMiddleware`.

In the demo it is applied to:

- The public `_frontend` route layout (HTML page render path) — see `apps/webapp/src/routes/$lng/_frontend/route.tsx`.
- Public-read server functions under `apps/webapp/src/modules/**` — `getPageDetailFn`, `getNewsListFn`, `getNewsDetailFn`, etc. This means client-side route transitions that re-fetch their loader data also flow through the CDN, not just full-page navigations.

The rest of this section describes the strategy the reference middleware implements. None of this is enforced by `@byline/*`; an adopter is free to swap TTLs, add cookies to the bypass list, or replace the middleware entirely.

### Cookie-aware branching

The middleware checks the admin **session** cookies on every request:

- `byline_access_token` and `byline_refresh_token` — set by the admin session (see `packages/client/src/server/session-cookies.ts` (`@byline/client/server`)).

If **either** session cookie is present on the request, the response carries:

```
Cache-Control: private, no-store
```

The CDN will neither store the response nor serve any previously-cached entry for that request. Signed-in editors therefore always reach the origin and see live content — including drafts when `byline_preview` is also set and a valid admin session resolves.

If neither session cookie is present, the response carries:

```
Cache-Control: public, s-maxage=60, stale-while-revalidate=86400
```

- `public` — shared caches may store the response.
- `s-maxage=60` — the CDN treats the response as fresh for 60 seconds.
- `stale-while-revalidate=86400` — for the next 24 hours after expiry the CDN may serve the stale copy while it refreshes in the background.

### Why `byline_preview` is not a bypass signal

The preview cookie (see `packages/client/src/server/preview-cookies.ts` (`@byline/client/server`)) is deliberately **not** included in the cache-bypass check:

- Preview mode only takes effect when paired with a valid admin session. `isPreviewActive()` checks the cookie *and* resolves `getAdminRequestContext()`; without a session it returns `false` and the server returns published content via `status: 'published'`.
- A real preview session always carries the session cookies too, so bypass is already triggered by those — the preview cookie is redundant when it matters.
- An anonymous browser carrying a stale `byline_preview` cookie (left over from a previous sign-in) receives the same published response any other anonymous browser would. That response is safe to cache and to serve from cache. Treating `byline_preview` as a bypass signal would force `no-store` on every page that browser visits for up to a day after sign-out, for no security benefit.

Clearing `byline_preview` on sign-out is good hygiene but is **not** required for cache correctness — the bypass is keyed off the session cookies, which the sign-out flow already clears.

### Why explicit branching

It is tempting to emit a single public cache header and rely on the CDN to bypass caching when a session cookie is present. This is **not** a safe default:

- Modern Cloudflare honours an explicit `s-maxage=N` regardless of request cookies, unless a Cache Rule is configured to bypass on cookie match.
- A forgotten or mis-scoped Cache Rule, or a zone migration, would silently leak anonymous HTML to authenticated editors.
- Different CDNs (or different plans on the same CDN) have different defaults around cookie bypass.

Branching at the origin is the authoritative fix. A matching CDN-side Cache Rule is **defence in depth**, not the primary mechanism.

### Belt-and-braces: a CDN-side Cache Rule

Independently of the origin middleware, configure your proxy to bypass cache when an admin session cookie is present. On Cloudflare this is a Cache Rule of the form:

> If `http.cookie contains "byline_access_token"` or `http.cookie contains "byline_refresh_token"` → **Bypass cache**.

This means that if the origin middleware ever fails to apply to a route (a new server function added without `publicCacheMiddleware`, for example), authenticated editors are still protected from stale anonymous HTML at the edge.

Note: do not include `byline_preview` in this rule. The preview cookie is not a meaningful bypass signal on its own (see [Why `byline_preview` is not a bypass signal](#why-byline-preview-is-not-a-bypass-signal) above) — adding it would penalise users who once signed in with a stale `no-store` response for up to a day after sign-out.

### When to skip `publicCacheMiddleware`

Do not apply `publicCacheMiddleware` to any server function whose result depends on the caller's identity — for example `getCurrentAdminUserSoft` or `getPreviewStateFn`. Those must always be fresh per-visitor and should set their own headers (typically `private, no-store`) directly.

### Verifying it works

On a deployed environment, the `cf-cache-status` response header is the source of truth:

- Anonymous request to a public page → `HIT` (after the first request) with `Cache-Control: public, s-maxage=60, ...`.
- Signed-in admin request to the same URL → `BYPASS` or `DYNAMIC` with `Cache-Control: private, no-store`.
- An edit by an admin → reload as admin shows the change immediately; reload anonymously shows the change within the `s-maxage` window (60s by default), or instantly if active purge is wired in (below).

## CDN invalidation strategies

Two approaches, not mutually exclusive:

### A) Passive — short TTL + SWR (the default)

- Anonymous edge entries self-expire in 60 seconds.
- Editors bypass via cookie branching, so they see updates instantly regardless of cache state.
- Anonymous visitors see the change within the TTL window — acceptable for nearly all content sites.
- Zero plumbing: no proxy API tokens to manage, no per-collection invalidation map to maintain.

### B) Active — purge from collection lifecycle hooks

When sub-minute propagation matters for anonymous traffic (breaking news, time-sensitive landing pages), wire purges into the concrete Byline events that affect the public result: `afterCreate`, `afterUpdate`, `afterSystemFieldsChange`, `afterStatusChange`, `afterUnpublish`, `afterDelete`, and — for tree-derived URLs/navigation — `afterTreeChange`. Two flavours, depending on your proxy plan:

1. **URL purge** (any Cloudflare plan): `POST /zones/:zone/purge_cache` with `{ files: [url] }`. Compute the public URL(s) from the document's `path` and locales and purge each.
2. **Cache Tag purge** (Cloudflare Enterprise only): set a `Cache-Tag: news,news-<slug>` response header and purge by tag. Cleaner for list-view invalidation because one tag covers N URLs.

For most deployments, **passive is the default and active purge is added only for the hottest detail pages**. Don't try to enumerate every URL that could be affected by every edit — that mapping rots faster than it pays back.

## Preview-mode request lifecycle

End-to-end, what happens when an admin enables preview and reloads a page:

1. Admin clicks "preview" in the admin shell → a server function sets the `byline_preview` cookie (`httpOnly`, 1-day max-age).
2. Browser issues subsequent GETs with `Cookie: byline_access_token=…; byline_refresh_token=…; byline_preview=1`.
3. `publicCacheMiddleware` at the origin sees the **session cookies** → emits `Cache-Control: private, no-store`. The CDN does not serve a cached anonymous version and does not store the editor's draft view.
4. `isPreviewActive()` returns `true` at origin — both the preview cookie and a valid admin session resolve — so the public server function passes `status: 'any'` to the viewer client and (if L1 is wired) bypasses the in-memory cache.
5. Editor sees their draft.

After sign-out the session cookies are cleared and `publicCacheMiddleware` returns to emitting the public cache header — even if `byline_preview` is still present in the browser. The preview cookie has no effect without a session: `isPreviewActive()` returns `false`, the server returns published content, and that content is correctly cacheable for that (now-anonymous) browser.

## L1 — In-memory data cache (optional)

For high-traffic deployments, an in-memory cache between the server function and the storage layer takes pressure off Postgres for popular pages and list views. The typical shape:

- A bounded LRU (e.g. 5000 entries) with a short per-entry TTL (30–60s).
- Optional `refreshThreshold` so that a cache entry past its threshold but within its TTL refreshes in the background while still serving the cached value — in-memory SWR, analogous to what the CDN does at L2.
- Cache keys composed from the inputs that actually determine the response: collection, query, locale, page, **and the read mode** (`'published'` vs `'any'`). Never share a cache entry across modes — a draft would otherwise leak into anonymous traffic.
- **Editors bypass L1 entirely.** When `isPreviewActive()` is true, the server function calls the storage layer directly and does not wrap the call in the cache helper.

### A worked L1 helper

A small in-process helper covers the common case. It keys entries by everything
that determines the response, indexes each entry by one or more **tags** (so a
collection hook can purge "everything tagged `cms::news`"), and is bounded with a
short TTL. This example uses [`lru-cache`](https://www.npmjs.com/package/lru-cache);
any bounded map with TTL works.

```ts
// cache/l1.ts — a tag-indexed, bounded in-process read cache for public reads
import { LRUCache } from 'lru-cache'

const cache = new LRUCache<string, unknown>({
  max: 5000,        // bounded — least-recently-used entries are evicted past this
  ttl: 60_000,      // 60s per-entry TTL
  allowStale: true, // a get can serve the stale value once while it is refreshed
})

// tag → the keys carrying that tag, so a hook can purge a whole collection/URL.
const tagIndex = new Map<string, Set<string>>()

/**
 * Wrap a read in L1. `key` must capture every input that changes the result —
 * collection, query, locale, page, and the read mode — so a draft can never be
 * served to anonymous traffic. `tags` drive invalidation from collection hooks.
 */
export async function cachedRead<T>(
  key: string,
  tags: string[],
  load: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key)
  if (hit !== undefined) return hit as T

  const value = await load()
  cache.set(key, value)
  for (const tag of tags) {
    let keys = tagIndex.get(tag)
    if (!keys) tagIndex.set(tag, (keys = new Set()))
    keys.add(key)
  }
  return value
}

/** Purge every entry carrying `tag`. Called from post-write collection hooks. */
export function invalidateTag(tag: string): void {
  const keys = tagIndex.get(tag)
  if (!keys) return
  for (const key of keys) cache.delete(key)
  tagIndex.delete(tag)
}
```

Using it from a public read, with the editor bypass:

```ts
// modules/news/details.ts — a cached published detail read
import { getPublicBylineClient } from '@/lib/byline-client'
import { isPreviewActive } from '@/lib/preview'
import { cachedRead } from '@/cache/l1'

export async function getNewsArticle(path: string, locale: string) {
  const read = () =>
    getPublicBylineClient()
      .collection('news')
      .findByPath(path, { status: 'published', locale, populate: true })

  // Editors previewing drafts must never read or populate the public cache.
  if (isPreviewActive()) return read()

  // Tags pair with the hooks below: a collection-wide tag plus a per-URL tag.
  return cachedRead(
    `news:detail:${locale}:${path}:published`,
    ['cms::news', `cms::news::${path}`],
    read,
  )
}
```

A list read is the same shape with a page in the key and only the collection-wide
tag: `cachedRead(\`news:list:${locale}:p${page}:published\`, ['cms::news'], read)`.

> For in-memory SWR (serve-stale-while-refreshing), `lru-cache`'s `fetch` +
> `fetchMethod` with `allowStale` refreshes an expired entry in the background
> while returning the stale value — the in-process analogue of the CDN's
> stale-while-revalidate.

### Invalidation via Byline collection hooks

Tag-based invalidation pairs naturally with Byline's collection hooks. The
version/status/delete contexts carry the document's canonical source-locale
`path`. Non-versioned admin path/advertised-locale edits instead fire
`afterSystemFieldsChange` with locked previous/current snapshots, while tree
writes carry a conservative affected-document set through `afterTreeChange`.
This lets an invalidation hook target the exact URL where possible and choose a
coarser collection sweep for structural or retry reconciliation. In a collection
definition:

```ts
hooks: {
  afterUpdate: [
    async ({ path }) => {
      await invalidateTag(`cms::news::${path}`)
      await invalidateTag('cms::news')
    },
  ],
  afterSystemFieldsChange: [
    async ({ previousPath, currentPath }) => {
      if (previousPath) await invalidateTag(`cms::news::${previousPath}`)
      if (currentPath) await invalidateTag(`cms::news::${currentPath}`)
      await invalidateTag('cms::news')
    },
  ],
  afterStatusChange: [
    async ({ path }) => {
      await invalidateTag(`cms::news::${path}`)
      await invalidateTag('cms::news')
    },
  ],
  afterCreate: [
    async ({ path }) => {
      await invalidateTag(`cms::news::${path}`)
      await invalidateTag('cms::news')
    },
  ],
  afterDelete: [
    async ({ path }) => {
      await invalidateTag('cms::news')
      await invalidateTag(`cms::news::${path}`)
    },
  ],
},
```

(`path` on the ordinary write contexts is real, not aspirational — it is
populated by the lifecycle from `byline_document_paths`.)

The reference app's direct-write policy is more precise and app-owned. Docs, News, and Pages each declare their complete cache invalidation and search reconciliation behavior in their own server-only `hooks.ts`. This deliberately repeats a small amount of orchestration so a developer can understand one collection's create, update, system-field, status, unpublish, delete, and tree behavior without following a shared factory.

Within those hooks, a path change starts old + current detail-tag, list, sitemap, and search reconciliation together; an advertised-locale-only change clears detail/alternate, list data where present, and sitemap data but does not reindex search. A no-op path reconciliation uses the coarse collection tag, because an earlier failed hook may have completed only part of its work. Tree changes likewise use a coarse docs-collection sweep.

All these hooks run after commit. If invalidation throws, the write and audit
remain committed. Hook arrays are sequential and fail-fast, so do not put
independent cache/CDN/search effects in separate entries when each must get an
attempt. The reference hooks use `Promise.all` inside one hook so cache and
search operations both start; native promise semantics report the first
rejection. The per-document cache helper independently attempts local detail,
old-path, list, and sitemap tags. If complete multi-error reporting is required,
the collection hooks documentation includes an optional `Promise.allSettled`
aggregation pattern. On delete, such an `afterDelete` failure is
reported by the lifecycle result as a committed side-effect failure rather than
undoing or rejecting the committed soft-delete. Optional cross-instance cache
fan-out is deliberately fire-and-forget: failures are logged and do not affect
the lifecycle hook result. This is app-owned reliability policy, not an automatic core
transaction or durable retry queue.

## Instance and clustering considerations

An in-memory L1 cache lives **inside a single origin process**. When the application is scaled horizontally — multiple Node processes on one host, or multiple hosts behind a load balancer — each instance keeps its own copy. Without cluster fan-out, a write that invalidates a tag on instance A leaves instance B's entries untouched until TTL expiry. With the reference app's `cache.clusterEnabled`, invalidation is also sent asynchronously to sibling instances, but delivery can be delayed or fail and is not awaited by the write hook.

The practical implications:

- **One instance**: the simple in-memory cache is fine and has no coordination cost.
- **Few instances, short TTLs**: per-instance drift converges within the TTL window. For most content sites this is acceptable — anonymous visitors might see slightly stale content for up to one TTL period after an edit, exactly the same property as the CDN edge.
- **Many instances, or stricter freshness**: invalidations must propagate across instances. The usual options are a shared cache (Redis, Memcached) or a fan-out message channel (Redis Pub/Sub, NATS, a cloud-specific equivalent) that broadcasts invalidation events from the hook to every instance's local cache.

The right answer depends on the deployment topology (Fly.io regions, Kubernetes pods, ECS tasks, single VM, etc.), the latency budget for cross-instance invalidation, and how much operational complexity the application can absorb. **Start without it.** Most Byline applications run a single origin behind a CDN and never need cross-instance coordination — the CDN absorbs the vast majority of traffic, and the L1 cache is a backstop for the small fraction that reaches origin.

## Recommended order of adoption

1. **Start with the L2 reference strategy.** Copy `publicCacheMiddleware` (or write your own version of the same pattern) and apply it to every public read. Cookie-aware branching handles editor traffic. Add a matching CDN Cache Rule as defence in depth.
2. **Measure.** Look at origin CPU, p95 DB query time on the hot read paths, and CDN hit rate before adding any in-memory layer.
3. **Add L1 only where origin load justifies it.** Start with the two or three hottest server functions (typically a homepage list view and a few popular detail pages). Wire the concrete lifecycle hooks for those collections.
4. **Add active CDN purge only where 60-second propagation is too slow.** Keep the URL list short and tied to specific collections, not a generic "purge everything that might be affected" routine.
5. **Reach for shared-cache or cross-instance invalidation only when the deployment is genuinely multi-instance and the per-instance drift becomes visible.** This is rarely the right first move.
