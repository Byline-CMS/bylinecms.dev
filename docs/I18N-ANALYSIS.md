# I18N-ANALYSIS.md (working notes — reconcile into I18N.md later)

> **Status:** temporary working doc. Captures (1) the locale-routing migration
> just completed across three repos, and (2) an open architectural question
> about caching content-locale pages that we're sleeping on. Fold the durable
> parts into `docs/I18N.md` once the caching decision is made, then delete this.

---

## Part 1 — The locale URL rewrite migration (DONE)

### What changed and why

We replaced the optional `{-$lng}` route param (+ virtual-route shims +
per-locale route-shim files) with a **required `$lng` segment** plus an
**isomorphic URL rewrite** on the TanStack router. This kills a lot of
machinery (no more `routes.virtual.ts`, `route-shims/`, optional-param matcher
ambiguity) while keeping clean URLs for the default locale.

Core mechanism (`apps/webapp/src/i18n/locale-rewrite.ts`, wired in
`src/router.tsx` via `createRouter({ rewrite: { input, output } })`):

- **`input`** (runs on both SSR request-parse AND client navigation): prepend
  the default locale to a *bare frontend path* so the matcher always sees a
  locale segment. Skips non-localized surfaces via `NON_LOCALIZED_SEGMENTS`
  (`admin`, `sign-in`, `_serverFn`, `_build`, `uploads`, `api`) and assets
  (anything whose last path segment has a `.`). `/sitemap.xml` is left alone by
  the asset rule.
- **`output`**: strip *only* the default-locale segment → clean URLs for `en`.
  **De-DEFAULT, never de-LOCALIZE** — non-default interface AND content locales
  (`fr`, `zh-CN`, …) stay visible (rendering + hreflang + canonical depend on
  it). This is the load-bearing invariant; `locale-rewrite.test.ts` pins it.

Negotiation (cookie/Accept-Language → redirect) and canonicalization
(`/en/…` → 301 `/…`) moved to the **server entry** (`src/server.ts` →
`src/i18n/server-locale-redirect.ts`) because the rewrite runs *before* route
middleware, hiding whether a URL arrived bare.

`LangLink` was fixed to NOT locale-prefix non-localizable targets (`/admin`,
`/sign-in`) — it uses the same `isLocalizablePath` predicate.

### Two-axis model (the thing all this machinery exists to serve)

- **Content locale** = the page's *identity* (URL path, indexed, hreflang
  target). Sticky only to the page it's on (non-sticky).
- **Interface locale** = chrome personalization (nav/menu/labels). Sticky via
  the `lng` cookie; reverts off a content-only prefix.

`useLocale()` returns the path/content locale; `useInterfaceLocale()` returns
the chrome locale. On a **content-only-locale** URL (e.g. `/zh-CN/…`, where the
path locale has no chrome bundle) chrome falls back to the visitor's
**last-known / detected interface locale** — resolved by
`resolveInterfaceLocale()` (`src/i18n/resolve-interface-locale-fn.ts`):
`isInterfaceLocale(path) ? path : <server fn: cookie → Accept-Language →
default>`. Resolved in the **`$lng` route loader** (staleTime-cached), NOT
`beforeLoad` (which re-runs on every nav + intent preload → would RPC per
hover). Interface-locale URLs resolve synchronously (no server call); only
content-only locales hit the fn. The result is in `$lng` loader data;
`useInterfaceLocale()` reads it (pure `toInterfaceLocale` fallback outside the
`$lng` tree, e.g. error components).

Detail routes / list components pass `lng={useInterfaceLocale()}` so chrome and
in-content body links agree.

### Status across the three repos

| Repo | Branch / state | Notes |
|---|---|---|
| **bylinecms.dev** | `develop` (4 commits) — **pushed** | reference impl |
| **bylinecms.app** | `feat/locale-url-rewrite` `dabb1ff` — committed, E2E'd, ready to merge to `develop` | |
| **modulus-learning.org** | migrated on `develop`, **uncommitted (~55 files)**, awaiting E2E then commit to a `feat/locale-url-rewrite` branch | DB wasn't running, so render-test pending |

bylinecms.dev commits (on `develop`):

```
fix(richtext): guarded lexical link URL parsing against relative hrefs
feat(i18n): resolved content-locale chrome to the last-known/detected interface locale
feat(i18n): wired hreflang alternates into the root pages route
feat(i18n): replaced optional {-$lng} route with required $lng + isomorphic URL rewrite
```

### Per-repo divergences handled

- `.app` / modulus were partially pre-migrated (dir renamed to `$lng`; route
  IDs still `{-$lng}`; shims/virtual/middleware still present).
- **modulus** has 3 interface locales (`en/es/fr`) vs `.dev`/`.app` (`en/fr`);
  content set `en/fr/es/de`. The migration code is locale-agnostic (reads
  `i18nConfig`), so only `locale-rewrite.test.ts` was adapted (its `zh-CN`/
  `th-TH` cases → `de`). modulus also has an extra `registry.tsx` loader and an
  `api/` route dir (covered by the reserved `api` segment).
- **modulus drift fixed:** its detail routes had been passing the *raw content
  locale* (`lng={lng}`) to `*Detail` (and `NewsDetail` hardcoded `lng="en"`).
  Confirmed drift, not design — aligned all 5 detail routes to
  `useInterfaceLocale()` and wired `lng` through `NewsDetail`.

All three: typecheck 0 / lint 0 / 21 tests pass. `.dev` + `.app` E2E'd green.

### Richtext fix (separate, pre-existing)

`link-lexical.tsx` `getHref` called `new URL(href)` (no base) on **relative**
custom links (e.g. `../benchmarks/…` authored in doc bodies) → "Invalid URL"
console spam during SSR. Guarded to only parse absolute (scheme-bearing) URLs.

---

## Part 2 — OPEN QUESTION: caching content-locale pages (the cliffhanger)

### The problem (confirmed real)

`https://bylinecms.app/zh-CN/about-byline` renders correct non-sticky content,
but the **chrome interface locale** is resolved from out-of-URL signals
(`lng` cookie → Accept-Language → default). A URL-keyed cache (Cloudflare, any
shared proxy) caches whatever chrome the *first* visitor rendered and serves it
to everyone until invalidation. The response varies on something not in the
cache key.

Two refinements:

1. **Narrow scope.** Only **content-only-locale URLs** (`/zh-CN`, `/de`, `/es`,
   `/th-TH`) are affected. Interface-locale URLs (`/en`, `/fr`) have chrome ==
   path locale → fully URL-determined → cache fine.
2. **Self-inflicted.** Pre-Issue-#2 "blunt default" chrome (always default
   locale on content URLs) was *deterministic per URL → cache-safe*. Issue #2
   (resolve chrome to last-known interface locale) is what made it vary
   per-visitor. We traded cache-correctness for chrome personalization on these
   pages.

### Why `?clocale=zh-CN` is the wrong fix (rejected)

The idea: keep interface locale in the path, move content locale to a query
param (`/fr/about-byline?clocale=zh-CN`), so both axes are URL-encoded →
cache-safe.

Rejected because it **separates the wrong axis**. Two independent axes:
- content locale = the page's *identity* (deserves the clean canonical path);
- interface locale = *personalization* (should leave the cached response).

`?clocale` demotes the SEO-significant **content** locale to a query string and
keeps the **personalization** interface locale as canonical — backwards. It
also re-creates duplicate-content fan-out: the zh-CN page becomes reachable as
`/about?clocale=zh-CN`, `/fr/about?clocale=zh-CN`, `/es/about?clocale=zh-CN`…
(N interface variants of one content version), making canonical ambiguous and
hreflang messy — exactly what the path-based scheme avoids. (This matches the
half-remembered "not nice for canonical/hreflang" objection, and is the
decisive reason.)

### The real options (keep content in the path; move interface out of the cached response)

- **B — Deterministic default chrome on content-only-locale URLs** (revert #2
  *for those URLs only*; chrome = default locale, always). Zero infra,
  cache-safe, canonical-clean, and **philosophically consistent with
  "content locales are non-sticky/transient"** (don't over-personalize a
  throwaway view). Cost: a French visitor deep-linking to a Chinese page sees
  English chrome (reverts to French on next nav — already works).
  **Current lean / recommended default** for a low-traffic translated-deep-link
  surface.
- **D — Cache-key on a normalized interface locale.** Keep #2; add the resolved
  interface locale to the CDN cache key (Cloudflare Cache Rules / Worker
  normalizing the `lng` cookie → `en|fr|es`; NOT `Vary: Cookie` — session
  tokens fragment it). Correct HTTP semantics, clean URLs, full personalization,
  bounded fragmentation (~#interface locales). Ideally apply the extra key
  dimension only on content-only-locale paths (some edge logic). Pick if chrome
  personalization on these pages is genuinely valued.
- **C — Cache neutral shell, personalize chrome client-side.** Server renders
  default chrome (cacheable); client swaps to the cookie's interface locale on
  hydrate. Best UX + caching, but a chrome flash + complexity. Usually overkill.

### Framing to remember

This is the generic **"personalized fragment on a cached page"** problem (same
class as a cached page with a `Hello, {name}` header) — *not* an i18n-model
flaw. The i18n model (and Byline's available/advertised-locale mechanics) are
sound. Standard answers all apply: don't vary the response, vary the cache key,
or personalize client-side.

### Decision made — Option B (implemented)

**Chose B.** Cleanest, zero-infra, cache-safe, canonical-clean, and
philosophically consistent with "content locales are non-sticky." **D is not a
competing implementation** — it's an ops/CDN configuration (cache-key
normalization at Cloudflare et al.) that leaves the app unchanged; it remains
available to any deployment that runs a programmable edge and decides
personalized chrome on these throwaway pages is worth the fragmentation. B works
everywhere unconditionally, so it's the baseline.

**What B reverts:** Issue #2 (`c1cd8475`) did two things — (1) added an async
server-fn tier that resolved content-only-locale chrome from cookie/Accept-Language
(the per-visitor variance), and (2) switched the 5 detail routes from inline
`toInterfaceLocale(lng)` to the `useInterfaceLocale()` hook (a genuine cleanup).
B is a **surgical** revert that keeps (2) and undoes (1):

- **deleted** `resolve-interface-locale-fn.ts` + `resolve-interface-locale.server.ts`
  (the server-fn tier — dead; `detectLocale` survives, still used by
  `server-locale-redirect.ts` for bare-path negotiation).
- `useInterfaceLocale()` → `toInterfaceLocale(useLocale())` — a pure function of
  the URL locale again (no cookie/header consult, no loader-data read).
- `$lng/route.tsx`, `docs/index.tsx`, `news/index.tsx` loaders use
  `toInterfaceLocale(...)` synchronously; the `$lng` loader returns just
  `{ translations }`.

Net effect: chrome on a content-only-locale URL is deterministic per URL → the
page is cacheable again. The detail routes are untouched (the hook now returns
the same value the old inline cast did).

**Status:** implemented + verified (typecheck 0 / lint 0 / 21 i18n tests) across
all three repos on `develop` — bylinecms.dev, bylinecms.app, and
modulus-learning.org (the last also has the extra
`$lng/_frontend/registry.tsx` consumer reverted to `toInterfaceLocale`). All
uncommitted, pending commit.
