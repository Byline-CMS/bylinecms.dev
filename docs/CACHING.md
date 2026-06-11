---
title: "Caching"
path: "caching"
summary: "How Byline applications cache HTML at the CDN edge, how editors bypass that cache for instant preview, and where an optional in-memory data cache fits."
---

# Caching

Companions:
- [ROUTING-API.md](./ROUTING-API.md) — the server-function transport layer that public reads ride on.
- [AUTHN-AUTHZ.md](./AUTHN-AUTHZ.md) — the admin session and preview-cookie mechanics that the cache layer keys off.

## Overview

A Byline application has several places where work can be skipped on a hot read path. Each layer addresses a different bottleneck, so they compose rather than substitute for each other:

| Layer | Purpose | TTL | Invalidation |
|---|---|---|---|
| **L1 — In-memory data cache (per origin instance)** | Shields Postgres from repeated reads of the same query (popular pages, list views) | 30–60s, with a `refreshThreshold` for in-memory SWR | By tag, via Byline collection hooks (synchronous, in-process) |
| **L2 — CDN edge (e.g. Cloudflare)** | Shields the origin entirely for anonymous traffic; absorbs traffic spikes | `s-maxage=60`, `stale-while-revalidate=86400` | Short TTL (passive) and/or active purge by URL/tag from collection hooks |
| **L3 — Browser** | Minor; mostly relevant for static assets, not HTML | `max-age=0` on HTML by default | n/a |
| **L4 — Client-side route loaders (TanStack Query / Router)** | Smooth client-side transitions, request de-duplication | Per-query staleness | Tag-based refetch on mutation |

The `@byline/*` packages do not ship a caching layer of their own — caching policy is the application's concern. The demo `apps/webapp` in this repository contains worked examples of both: **L2** as copyable middleware (below), and **L1** as an opt-in tagged in-memory cache (`apps/webapp/src/lib/cache/`, off by default via `CACHING_DATA_REQUESTS`) whose first consumer is the dynamic `sitemap.xml` route. The full L1 design — stack choice, the tag-map fix, the per-document tag scheme, and the optional cluster fan-out — lives in [`apps/webapp/docs/DATA-CACHE-DESIGN.md`](../apps/webapp/docs/DATA-CACHE-DESIGN.md).

## L2 — CDN edge

The demo application carries a reference middleware that other TanStack Start hosts can copy verbatim or treat as a starting point:

- [`apps/webapp/src/middleware/public-cache.ts`](../apps/webapp/src/middleware/public-cache.ts) — `publicCacheMiddleware`.

In the demo it is applied to:

- The public `_frontend` route layout (HTML page render path) — see `apps/webapp/src/routes/$lng/_frontend/route.tsx`.
- Public-read server functions under `apps/webapp/src/modules/**` — `getPageDetailFn`, `getNewsListFn`, `getNewsDetailFn`, etc. This means client-side route transitions that re-fetch their loader data also flow through the CDN, not just full-page navigations.

The rest of this section describes the strategy the reference middleware implements. None of this is enforced by `@byline/*`; an adopter is free to swap TTLs, add cookies to the bypass list, or replace the middleware entirely.

### Cookie-aware branching

The middleware checks the admin **session** cookies on every request:

- `byline_access_token` and `byline_refresh_token` — set by the admin session (see [`packages/host-tanstack-start/src/auth/auth-cookies.ts`](../packages/host-tanstack-start/src/auth/auth-cookies.ts)).

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

The preview cookie (see [`packages/host-tanstack-start/src/auth/preview-cookies.ts`](../packages/host-tanstack-start/src/auth/preview-cookies.ts)) is deliberately **not** included in the cache-bypass check:

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

Note: do not include `byline_preview` in this rule. The preview cookie is not a meaningful bypass signal on its own (see [Why `byline_preview` is not a bypass signal](#why-byline_preview-is-not-a-bypass-signal) above) — adding it would penalise users who once signed in with a stale `no-store` response for up to a day after sign-out.

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

### B) Active — purge from `afterChange` hooks

When sub-minute propagation matters for anonymous traffic (breaking news, time-sensitive landing pages), wire purges into Byline's `afterChange` / `afterDelete` collection hooks. Two flavours, depending on your proxy plan:

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

### Invalidation via Byline collection hooks

Tag-based invalidation pairs naturally with Byline's collection hooks. Every
write-side hook context — `afterCreate`, `afterUpdate`, `afterStatusChange`,
`afterUnpublish`, and `afterDelete` — carries the document's canonical
(source-locale) `path`, so an invalidation hook can target the exact key/URL
for the document that changed rather than purging the whole collection. In a
collection definition:

```ts
hooks: {
  afterUpdate: [
    async ({ path }) => {
      await invalidateTag(`cms::news::${path}`)
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
    async () => {
      // No specific URL to purge yet — a create only widens the list view.
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

(`path` on these contexts is real, not aspirational — it is populated by the
lifecycle from `byline_document_paths` for every write hook.)

The same hook can drive both L1 invalidation (in-process, synchronous) and an L2 purge call to the CDN (network, asynchronous, fire-and-forget). Order them so the L1 invalidation always succeeds even if the CDN call fails.

## Instance and clustering considerations

An in-memory L1 cache lives **inside a single origin process**. When the application is scaled horizontally — multiple Node processes on one host, or multiple hosts behind a load balancer — each instance keeps its own copy. A write that invalidates a tag on instance A leaves instance B's entries untouched until they expire on their own TTL.

The practical implications:

- **One instance**: the simple in-memory cache is fine and has no coordination cost.
- **Few instances, short TTLs**: per-instance drift converges within the TTL window. For most content sites this is acceptable — anonymous visitors might see slightly stale content for up to one TTL period after an edit, exactly the same property as the CDN edge.
- **Many instances, or stricter freshness**: invalidations must propagate across instances. The usual options are a shared cache (Redis, Memcached) or a fan-out message channel (Redis Pub/Sub, NATS, a cloud-specific equivalent) that broadcasts invalidation events from the hook to every instance's local cache.

The right answer depends on the deployment topology (Fly.io regions, Kubernetes pods, ECS tasks, single VM, etc.), the latency budget for cross-instance invalidation, and how much operational complexity the application can absorb. **Start without it.** Most Byline applications run a single origin behind a CDN and never need cross-instance coordination — the CDN absorbs the vast majority of traffic, and the L1 cache is a backstop for the small fraction that reaches origin.

## Recommended order of adoption

1. **Start with the L2 reference strategy.** Copy `publicCacheMiddleware` (or write your own version of the same pattern) and apply it to every public read. Cookie-aware branching handles editor traffic. Add a matching CDN Cache Rule as defence in depth.
2. **Measure.** Look at origin CPU, p95 DB query time on the hot read paths, and CDN hit rate before adding any in-memory layer.
3. **Add L1 only where origin load justifies it.** Start with the two or three hottest server functions (typically a homepage list view and a few popular detail pages). Wire `afterChange` / `afterDelete` hooks for those collections.
4. **Add active CDN purge only where 60-second propagation is too slow.** Keep the URL list short and tied to specific collections, not a generic "purge everything that might be affected" routine.
5. **Reach for shared-cache or cross-instance invalidation only when the deployment is genuinely multi-instance and the per-instance drift becomes visible.** This is rarely the right first move.
