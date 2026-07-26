---
title: "The host i18n system"
path: "i18n-host"
summary: "How a host application coordinates with Byline's content locales: the routable-vs-advertised distinction, the non-sticky content-locale rule, clean default-locale URLs via an isomorphic rewrite, and the single dependency-free reach into Byline's locale set."
---

# The host i18n system

Companions:
- [Internationalization](./index.md) — the three-axis overview this is the public-site half of.
- [Content locales](./03-content-locales.md) — the available/advertised locale facts the host turns into `hreflang`, canonical, and sitemap entries.
- [Document Paths](../04-collections/05-document-paths.md) — the same core-stores-the-slug, host-composes-the-URL boundary applied to locale routing.
- [Routing & API](../05-reading-and-delivery/02-routing-and-api.md) — the resolved `routes` config the locale rewrite reads to skip admin, API, and sign-in trees.

This repo ships a worked, copy-and-adapt example of a host frontend that
coordinates with Byline's content locales. It is a *reference*, not a turnkey
module — SEO conventions, URL strategy, and routing differ per host and per
framework, so Byline deliberately does not bake one opinion into the CMS.

## What the host owns

Byline core stops at **facts**. Per read, it tells you which content locale a
document resolved to, and which locales it is *available* and *advertised* in.
Turning those facts into routes, `<link>` tags, a sitemap, or an "Also available
in…" affordance is the host application's job. The same boundary already governs
`path` (core stores the slug; the host composes the URL) and the admin interface
i18n described later.

The host owns:

- **URL shape & locale routing** — whether a locale is a path prefix
  (`/de/news/foo`), a subdomain, or a query param; which locales are *routable*
  (resolvable) vs merely *advertised* (promoted); and the **non-sticky** rule
  (below).
- **`<link rel="canonical">` + `hreflang` alternates** (including `x-default`),
  built from the advertised set.
- **`sitemap.xml`** alternates — the same advertised set, kept in sync with the
  `hreflang` tags (ideally from one shared resolver).
- **The per-page "Also available in…" menu** — content-locale links gated on
  availability, distinct from the global interface-language switcher.
- **`<meta>` / Open Graph / Twitter** tags.

## Routable vs advertised, and the non-sticky rule

The key design idea on the host side is that the set of locales a URL can
*resolve* is wider than the set it *promotes*:

```
routableLocales = interfaceLocales ∪ contentLocales
```

The required `$lng` route segment resolves any routable locale, so a
content-only deep link such as `/ja/news/foo` works even though the frontend
chrome has no Japanese bundle (the chrome falls back to the default interface
locale; the *content* still renders in Japanese).

### Clean default-locale URLs via an isomorphic rewrite

`$lng` is a **required** segment internally, but the default-locale prefix is
never visible in the address bar. An isomorphic URL-rewrite pair
(`src/i18n/locale-rewrite.ts`, wired into `createRouter({ rewrite })`) runs on
both the SSR request-parse and client navigation:

- **`input`** prepends the default locale to a bare frontend path so the matcher
  always sees a locale segment. It reads the client-safe route config resolved
  at its module boundary and skips the configured admin, API, and sign-in paths
  (including their segment-delimited descendants), plus fixed `_serverFn`,
  `_build`, and `uploads` trees and static assets.
- **`output`** strips *only* a leading default-locale segment → clean URLs for
  `en`. The load-bearing invariant is **de-DEFAULT, never de-LOCALIZE**:
  non-default interface *and* content locales (`fr`, `zh-CN`, …) stay visible,
  because the prefix drives content rendering, the `hreflang` self-reference, and
  the canonical. `locale-rewrite.test.ts` pins it.

Locale *negotiation* (cookie / `Accept-Language` → redirect) and
*canonicalisation* (an externally-typed `/en/…` → `301` to the clean form) live
in the **server entry** (`src/server.ts` → `src/i18n/server-locale-redirect.ts`),
not in the rewrite: the rewrite runs *before* route middleware, can't read
cookies on the client, and has already hidden whether a URL arrived bare. (This
arrangement replaced an earlier optional `{-$lng}` matcher plus per-locale route
shims / virtual routes — the rewrite removes that machinery while keeping clean
default-locale URLs.)

### The non-sticky rule

A content-only locale must **not** become sticky. If a visitor on the English
site follows one Japanese article, the `/ja` prefix must not pin Japanese into
their session and follow them onto every subsequent link. The host enforces this
across coordinated places:

- **Server-entry negotiation** (`src/i18n/server-locale-redirect.ts`) — only an
  *interface*-locale preference (cookie + `Accept-Language`) negotiates a
  redirect and writes the `lng` cookie. A routable *content*-locale segment
  passes straight through, without negotiation and without writing the cookie.
- **Navigation hook** (`src/i18n/hooks/use-locale-navigation.ts`) — persists the
  `lng` cookie *only* when switching to an **interface** locale. A content-locale
  navigation target (the "read this in…" affordance) never writes the cookie, so
  the prefix stays opt-in per document.
- **Language switcher** (`src/i18n/hooks/use-language-switcher.ts`) — lists
  *interface* locales only, and strips any existing routable prefix (interface or
  content) before applying the new one, so switching off `/ja` can never produce
  `/es/ja/...`.

The net effect is exactly the property called out in the introduction: a content
translation is discoverable and linkable, but it never silently switches and
sticks as an interface locale.

### Content locale vs interface locale (chrome), and why chrome is deterministic

Two locales are in play on any URL, exposed as two hooks:

- **`useLocale()`** — the *path / content* locale (may be a content-only locale
  like `zh-CN`). Drives content rendering, meta, canonical, and the per-page
  content-language affordance's active state.
- **`useInterfaceLocale()`** — the *chrome* locale (nav, menus, labels). On an
  interface-locale URL it equals the path locale; on a **content-only** URL it
  falls back to the **default** interface locale via `toInterfaceLocale()`.

`useInterfaceLocale()` is deliberately a **pure function of the URL locale** — it
does *not* consult the cookie or `Accept-Language`. This is a caching
requirement: a content-only-locale page (`/zh-CN/about`) is keyed only by its URL
on a shared proxy, so its chrome must be deterministic per URL. Resolving chrome
from out-of-URL signals would make one URL render different chrome per visitor
and poison the cache. The `$lng` route loader keys its chrome translation bundle
off the same `toInterfaceLocale`, so the loaded bundle and the hook agree by
construction.

> A French visitor deep-linking to a Chinese content page therefore sees
> *default-locale* chrome on that page, reverting to French on their next
> navigation (the `lng` cookie is untouched). A deployment that runs a
> programmable edge and *wants* personalized chrome on these pages can instead
> add a normalized interface-locale dimension to its CDN cache key — an ops-only
> change that leaves the app deterministic-by-default.

## The single reach into Byline

The host frontend needs to know Byline's content-locale set, and it gets it from
**one** explicit boundary: `apps/webapp/byline/public.ts`. That client-safe barrel
re-exports the dependency-free locale definitions and route data, but no admin or
server configuration. Public code therefore cannot accidentally drag the admin
translation graph (`@byline/i18n/admin` and its Lexical-adjacent module tree) into
the public client bundle.

The same facade owns host route decisions. `byline/routes.ts` calls
`resolveRoutes()` once at that client-safe configuration boundary, and
`byline/public.ts` re-exports the resulting frozen, readonly route object without
loading the admin config:

```ts
import { routes } from '~/public'

const { admin, api, signIn } = routes
```

The same resolved object is passed to the client and server configs, whose
registration also validates and snapshots route input. Locale rewriting and
server negotiation therefore consume canonical paths directly; route validation
is not deferred until a rewrite, render, or request.

`locale-rewrite.ts` uses these canonical paths rather than reserving `/admin` and
`/sign-in` forever. Multi-segment trees are matched safely at segment
boundaries. With admin at `/internal/cms`, API at `/services/content`, and
sign-in at `/staff/login`, those paths and their descendants remain locale-less,
`/internal/cms-old`, `/staff/profile`, and `/services/contentful` remain
localizable, and `/admin` is an ordinary frontend path. The configured sign-in
path is validated outside both the admin and API trees before registration. The
same `isLocalizablePath()` predicate is reused by router input rewriting, server
locale negotiation, markdown negotiation, and locale-aware links, so all four
surfaces agree.

```ts
// apps/webapp/byline/locales.ts (re-exported by byline/public.ts)
export const interfaceLocales = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
] as const satisfies readonly LocaleDefinition[]

export const contentLocales = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
] as const satisfies readonly LocaleDefinition[]
```

`byline/i18n.ts` consumes these to assemble the `defineServerConfig` /
`defineClientConfig` payload; the public frontend's `src/i18n/i18n-config.ts`
imports `contentLocales` through `~/public` to build its `routableLocales` and
label map. The host
authors the display labels here once (`Français`, not CLDR's lowercase
`français`), and the server-side consumers (sitemap / `getMeta`) read the same
set via `getServerConfig().i18n.content.localeDefinitions` — one source of truth,
no parallel map.

:::tip[Why not call Byline's config getters from the public client bundle?]
Runtime config getters are not the public client boundary. Import from
`byline/public.ts`, not `byline/i18n.ts`, in public client code.
:::

## Reference implementation files

A worked TanStack-Start host, all under `apps/webapp/`:

| Concern | Location |
|---|---|
| Routable-locale config, `isInterfaceLocale` / `isRoutableLocale`, `toInterfaceLocale` | `src/i18n/i18n-config.ts` |
| Client-safe route data used by public host code | `byline/routes.ts`, re-exported by `byline/public.ts` |
| Isomorphic locale URL rewrite (clean default-locale URLs; configured route exclusions) | `src/i18n/locale-rewrite.ts` (wired in `src/router.tsx`) + `locale-rewrite.test.ts` + `locale-rewrite-custom-admin.test.ts` |
| Server-entry negotiation + `/en/…` canonicalisation (non-sticky for content locales) | `src/i18n/server-locale-redirect.ts` (called from `src/server.ts`) |
| Two-axis locale hooks (`useLocale` = content/path, `useInterfaceLocale` = deterministic chrome) | `src/i18n/hooks/use-locale-navigation.ts` |
| Locale-aware navigation (cookie only on interface switch) | `src/i18n/hooks/use-locale-navigation.ts` |
| Interface language switcher (strips routable prefixes) | `src/i18n/hooks/use-language-switcher.ts` |
| Per-page "Also available in…" affordance | `src/i18n/components/available-languages.tsx` |
| Advertised-set resolver (`advertisedLocalesFor`, `resolveAlternates`) | `src/lib/alternates.ts` |
| Canonical + `hreflang` + `x-default` + OG/Twitter meta | `src/lib/meta.ts` |
| Frontend translation bundles + provider | `src/i18n/translations/*`, `src/i18n/client/*` |

`advertisedLocalesFor(doc)` computes the public advertised set as the
intersection `availableLocales ∩ _availableVersionLocales` (see
[Advertising content locales](./03-content-locales.md#advertising-content-locales-availablelocales));
`resolveAlternates(...)` turns it into `{ canonical, alternates, xDefaultPath }`,
the single resolver that `hreflang` meta — and a `sitemap.xml` — both derive
from, so the two can never drift.
