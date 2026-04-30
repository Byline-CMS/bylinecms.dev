# Host Packaging & Deployment Strategy — TanStack Start

Status: analysis / proposal — pre-1.0, ahead of first npm publish.
Scope: TanStack Start (SSR) hosts only. Next.js, Remix, Astro, etc. are
deliberately deferred until the TanStack Start story is settled.

The reference host is `apps/webapp`. Everything in this doc is read off
that tree as it stands today, then re-projected into "what does a fresh
host application need."

---

## 1. What a Byline host actually consists of today

A TanStack Start host that wants the Byline admin UI has to drop in
artefacts from **six** separate places in `apps/webapp`. The surface is
larger than people will expect:

| # | Location | Purpose | Files |
|---|---|---|---|
| 1 | `apps/webapp/byline.{common,server,admin}.config.ts` | The three config entry points: shared scalars, server `initBylineCore()` composition, browser `defineClientConfig()` registration. | 3 files |
| 2 | `apps/webapp/byline/` | Collection definitions, blocks, fields, i18n config, seeds. **Host content** — the part the user actually owns. | ~30 files |
| 3 | `apps/webapp/src/routes/{-$lng}/(byline)/` | TanStack file-routes for admin shell, admin sub-areas, sign-in. | 13 route files |
| 4 | `apps/webapp/src/modules/admin/` | Server-fn modules: `auth`, `collections`, `admin-users`, `admin-roles`, `admin-permissions`, `admin-account`. Each module mixes thin server fns + their React UI components. | ~70 files |
| 5 | `apps/webapp/src/lib/` | TanStack-Start-specific glue: `auth-context.ts`, `auth-cookies.ts`, `byline-client.ts`, `byline-field-services.ts`, `byline-i18n.tsx`, `api-utils.ts`, `abilities.tsx`, `start-errors.ts`. | 8 files |
| 6 | `apps/webapp/src/ui/` | Admin shell chrome (drawer, content, hamburger, menu-provider), shared components (`admin-app-bar`, `route-error`, `router-pager`, `th-sortable`, `sort-icons`, `local-date-time`, `branding`), breadcrumbs, and the CSS bundle (`styles/{base,layouts,*}`). | ~25 files |

Plus host-level concerns the installer also has to handle: `vite.config.ts`,
`tsr.config.json`, `tailwind.config`, `postcss`, `tsconfig.json`,
`.env.example`, `postgres/postgres.sh` (Docker compose for dev DB),
`drizzle:migrate` script, the seed entry script.

**Observation:** if a user copies `apps/webapp` and starts deleting things
they don't need, they'll churn on (4)–(6) for hours and probably break
auth. The boundary between "framework integration the installer should
own" and "content the user owns" is currently invisible.

---

## 2. Where the seams should land

The repo already has good separation along the `@byline/*` axis (core,
client, auth, admin, db, storage, ui, richtext). What's missing is a
**framework adapter layer** between those packages and the host
application — the TanStack Start equivalent of "Next.js app router
adapter." Right now that layer exists, but it lives inside `apps/webapp`
where it can't be versioned, reused, or installed.

### Proposed seams

```
@byline/core            ← already a package (server runtime)
@byline/client          ← already a package (in-process SDK)
@byline/auth            ← already a package (primitives)
@byline/admin           ← already a package (modules + JwtSessionProvider)
@byline/db-postgres     ← already a package (adapter)
@byline/storage-{local,s3}  ← already a package
@byline/ui              ← already a package (field widgets, form context,
                          admin layout primitives) — *grows* to absorb
                          the admin UI components and admin shell chrome
@byline/richtext-lexical    ← already a package (richtext editor)

──── new packages (this proposal) ────────────────────────────────────

@byline/host-tanstack-start
    │
    ├── /server-fns         ← currently src/modules/admin/<m>/server fns
    │                         (collections, admin-users, admin-roles,
    │                         admin-permissions, admin-account, auth)
    ├── /auth               ← currently src/integrations/byline/auth-{context,cookies}
    ├── /integrations       ← byline-client, byline-field-services,
    │                         byline-admin-services, byline-i18n,
    │                         api-utils, abilities, start-errors,
    │                         empty-module
    ├── /routes             ← route factories used by the copied route files
    │                         (createCollectionListRoute, createAdminRolesListRoute,
    │                         createSignInRoute, etc.)
    └── /admin-shell
        ├── /chrome         ← shared shell — used by every admin area:
        │                     menu-drawer, menu-provider, content,
        │                     hamburger, drawer-toggle, admin-app-bar,
        │                     app-bar, branding, route-error,
        │                     router-pager, th-sortable, sort-icons,
        │                     breadcrumbs/*
        ├── /admin-roles    ← per-area page containers:
        │                     container, list, delete
        ├── /admin-users    ← per-area page containers:
        │                     container, list, delete
        └── /collections    ← per-area page containers:
                              api, create, edit, history, list,
                              view-menu, tanstack-navigation-guard

@byline/cli                ← `npx create-byline-app` + `byline add ...`
```

The split reflects what's actually framework-coupled vs. what's not:

- **`@byline/host-tanstack-start`** depends on `@tanstack/react-start`
  (server fns, request headers, redirect helper) and `@tanstack/react-router`
  (file-route helpers, redirect, `Link`). It cannot be moved into
  `@byline/admin` or `@byline/ui` because both are framework-neutral by
  design.
- **`@byline/ui` absorbs the admin UI components.** The package is
  already the framework-neutral React surface (rslib build,
  `@byline/client` + `@byline/core` deps, no router/server-fn coupling),
  with `src/fields/*`, `src/forms/*`, `src/admin/*` (group/row/tabs),
  `src/dnd/*`, `src/services/*`. Admin UI components belong here, not
  in a parallel React package — splitting React UI across two packages
  along a "fields vs. admin" line splits on the wrong axis. See §4.
- **`@byline/cli`** is the installer + codemod runner. Its `templates/`
  directory holds the routes folder and the `byline.*.config.ts` files
  verbatim — these are the parts that genuinely cannot be shipped as code
  (TanStack file-routes must be physical files in the host's `src/routes`).

---

## 3. What stays copied vs. what becomes an import

The hard constraint is that **TanStack file-based routes must be physical
files** in the host's `src/routes` tree — they're discovered by file
path, not import. So a portion of (3) and (1) will always be copied.

Everything else can become an import.

| Today's file | After repackaging |
|---|---|
| `byline.common.config.ts` | **Copied** (template). Installer fills the `routes`, `i18n` defaults. |
| `byline.server.config.ts` | **Copied** (template). Installer fills DB driver, storage provider, signing-secret reminder. |
| `byline.admin.config.ts` | **Copied** (template). Installer registers default richtext editor and the user's chosen collections. |
| `src/routes/(byline)/admin/route.tsx` | **Copied** but reduced to ~10 lines that re-export from `@byline/host-tanstack-start/admin-route`. |
| `src/routes/(byline)/admin/index.tsx` | **Copied** (~10 lines) — re-export. |
| `src/routes/(byline)/admin/collections/$collection/...` | **Copied** (~10 lines each) — re-export. |
| `src/routes/(byline)/admin/{users,roles,permissions,account}/...` | **Copied** (~10 lines each) — re-export. |
| `src/routes/(byline)/sign-in.tsx` | **Copied** (~10 lines) — re-export. |
| `src/modules/admin/<m>/server/*` | **Imported** from `@byline/host-tanstack-start/server-fns/<m>`. |
| `src/modules/admin/<m>/ui/*` (framework-neutral forms — Phase 2.1 already shipped) | **Imported** from `@byline/ui` (under `/admin/components/<m>/`). Server fns injected via `BylineAdminServicesProvider`. |
| `src/modules/admin/<m>/ui/{container,list,delete}.tsx` (router-coupled page containers) | **Imported** from `@byline/host-tanstack-start/admin-shell/<m>`. |
| `src/modules/admin/collections/ui/{api,create,edit,history,list,view-menu,tanstack-navigation-guard}` | **Imported** from `@byline/host-tanstack-start/admin-shell/collections`. |
| `src/integrations/byline/auth-{context,cookies}.ts` | **Imported** from `@byline/host-tanstack-start/auth`. |
| `src/integrations/byline/byline-{client,field-services,admin-services,i18n}.{ts,tsx}` | **Imported** from `@byline/host-tanstack-start/integrations`. The host calls `createBylineHost(config)` once at startup. |
| `src/integrations/byline/{api-utils,start-errors,abilities,empty-module}.{ts,tsx}` | **Imported** from `@byline/host-tanstack-start/integrations`. |
| `src/ui/admin/*` (menu-drawer, menu-provider, content, hamburger, drawer-toggle) | **Imported** from `@byline/host-tanstack-start/admin-shell/chrome` — Phase 2 found these all use `useRouterState` / `LangLink` / host abilities, transitively router-coupled. |
| `src/ui/components/admin-app-bar.tsx`, `app-bar.tsx`, `route-error.tsx`, `router-pager.tsx`, `th-sortable.tsx`, `sort-icons.tsx`, `branding.tsx` | **Imported** from `@byline/host-tanstack-start/admin-shell/chrome`. |
| `src/ui/components/local-date-time.tsx` | **Already shipped from `@byline/ui`** (Phase 2.3 deleted the host duplicate). |
| `src/ui/breadcrumbs/*` | **Imported** from `@byline/host-tanstack-start/admin-shell/chrome/breadcrumbs`. |
| `src/ui/styles/*` | **Copied** — host's Tailwind/PostCSS pipeline owns CSS. Ship a `@byline/host-tanstack-start/styles.css` entry that the host imports once. |
| `byline/` (collections, blocks, fields, i18n, seeds) | **Copied** — this is host content the user owns. Installer scaffolds a starter set; user evolves it. |
| `vite.config.ts`, `tsr.config.json`, `tailwind.config`, `postcss`, `tsconfig.json` | **Copied** — full template. Installer composes with any host-specific tweaks. |
| `postgres/`, `drizzle.config.ts`, migration scripts | **Copied** — operational scaffolding. |

The route files end up looking roughly like this:

```ts
// src/routes/(byline)/admin/collections/$collection/index.tsx
import { createCollectionListRoute } from '@byline/host-tanstack-start/routes'
export const Route = createCollectionListRoute(
  '/(byline)/admin/collections/$collection/'
)
```

Each route file becomes a one-liner that picks up loaders, components,
`beforeLoad`, error/notFound boundaries from the package. The installer
places the file at the right path and the package owns the behavior.

This is the same pattern Next.js uses for `auth.js` adapters: physical
files at known paths, but each file just re-exports a handler the
package owns.

---

## 4. Where the admin UI components belong

The admin UI components currently inside `src/modules/admin/*/components/*.tsx`
need a home. Three options:

**Option A — Bundle into `@byline/host-tanstack-start`.** Simpler, one
package to install. Downside: ties the React UI to TanStack Start. A
future Next.js host would have to either depend on
`@byline/host-tanstack-start` (carrying TanStack runtime weight) or
duplicate the components.

**Option B — A separate `@byline/admin-react` package.** UI components
depend only on `@byline/ui` + types, consume server fns through an
injected interface. Keeps the React UI framework-neutral but adds a
second React-only package alongside `@byline/ui`.

**Option C — Fold into `@byline/ui`.** The package already *is* the
framework-neutral React surface for Byline: it depends on
`@byline/client` + `@byline/core`, builds with rslib, and houses
`src/fields/*` (field widgets), `src/forms/*` (form-context,
form-renderer, document-actions, path-widget), `src/admin/*` (group,
row, tabs — admin layout primitives), `src/dnd/*`, and `src/services/*`.
The admin UI components have the same constraints (React + Byline
types, no router/server-fn coupling). Splitting React UI across two
packages along a "fields vs. admin" line splits on the wrong axis —
the meaningful axis is "framework-neutral vs. framework-coupled," and
the framework-coupled side is already covered by
`@byline/host-tanstack-start`.

**Recommendation: Option C.** Concretely:

- Fold `src/modules/admin/*/components/*.tsx` (admin-users, admin-roles,
  admin-permissions, admin-account, collections list/edit/create/diff/
  history/api/view-menu/status-badge, auth/sign-in-form) into
  `@byline/ui/src/admin/components/`. The existing `src/admin/` cluster
  (group, row, tabs) is the obvious neighbour.
- Fold `apps/webapp/src/ui/admin/*` (menu-drawer, menu-provider, content,
  hamburger, drawer-toggle) into `@byline/ui/src/admin/` as well —
  same shape: React-only, no router coupling.
- Fold `branding.tsx`, `th-sortable.tsx`, `sort-icons.tsx`,
  `local-date-time.tsx` from `apps/webapp/src/ui/components/` into
  `@byline/ui/src/components/` (currently empty) — these are generic
  React components with no router coupling.
- Components that *are* router-coupled (`admin-app-bar`, `route-error`,
  `router-pager`, `breadcrumbs/*`) stay out — they live in
  `@byline/host-tanstack-start/admin-shell`.
- Server fns are still injected via the existing
  `BylineFieldServices`-style context, just expanded to cover the admin
  modules. So the components stay framework-neutral; the host wires the
  server-fn implementations once at the admin route boundary.

Bundle-size isolation (a public site that only wants field rendering)
is what subpath exports are for, not what package boundaries are for.
`@byline/ui/admin` and `@byline/ui/fields` as distinct subpath exports
keep public-site consumers from pulling in admin code.

The decision rule going forward: "another React-only package alongside
`@byline/ui`" is a smell. If something can be framework-neutral React,
it goes in `@byline/ui`. If it can't, it goes in the host adapter.
There's no third bucket.

---

## 5. Simplifications worth doing **before** repackaging

A few things in the current host layout will make repackaging harder
than it needs to be. Worth fixing first:

### 5a. Keep the `(byline)` route group — it's an installer boundary.

Initial impulse was to drop `(byline)/` as redundant nesting (it adds
nothing to URLs — TanStack route groups are organizational only).
On reflection it earns its keep, *especially* in the packaging context:

- **It's a clean installer boundary.** `create-byline-app` drops
  `src/routes/(byline)/` as one contiguous folder — admin tree +
  `sign-in.tsx` + any future Byline-owned routes (a public `/api/*`
  surface when one materializes, password reset flows, magic-link
  confirm, etc.) all live inside it. `byline check` enumerates *that
  one folder* to verify the re-export shape and the package version.
  Without the group, those files scatter across `src/routes/admin/`,
  `src/routes/sign-in.tsx`, and eventually `src/routes/api/`, and the
  installer has to know about each by name.
- **It's a clear "don't put your stuff here" marker.** A host adding
  their own `(dashboard)/` or `(account)/` group reads naturally next
  to `(byline)/`. Without the group, host files and Byline files mix
  in the route root.
- **It pairs `sign-in.tsx` with `admin/`** without the awkward stray
  file at `src/routes/sign-in.tsx` that the no-group layout produces.

The real nesting reduction comes from 5b (dropping `{-$lng}` from
admin). With both decisions, the end state is
`src/routes/(byline)/admin/...` and `src/routes/(byline)/sign-in.tsx`
— two levels of grouping become one, and the one that's left is the
one doing useful work.

### 5b. The `{-$lng}` locale prefix on admin is a host policy, not a Byline requirement.

Admin UI language is held by `BylineI18nBridge` and the user's preference,
not the URL. Putting admin under `{-$lng}` means every admin link has to
thread a locale param, every `redirect()` in `beforeLoad` has to know the
current locale, and the installer has to make the prefix optional anyway
(some hosts won't want it).

Recommendation: move admin out of the locale-prefix group entirely. Admin
routes become `/admin/...` and `/sign-in`, sit at `src/routes/admin/`,
and the `{-$lng}` group is reserved for the host's public site. The
installer becomes much simpler: it always drops `src/routes/admin/` and
`src/routes/sign-in.tsx`, and never has to rewrite link helpers. See
also the related cleanup in `apps/webapp/src/i18n/hooks/use-locale-navigation.ts`
— the `lngParam` helper exists largely because admin routes need locale
params today.

### 5c. The mixing of server fns and components inside `src/modules/admin/*` is a packaging hazard.

Today `src/modules/admin/admin-users/` contains both `create.ts` (a
TanStack server fn) and `components/create.tsx` (the React form). They
can't go into the same package without dragging the React/JSX runtime
into a server-only context, or vice versa.

Recommendation: split the directory before packaging. Either:

- `src/modules/admin/admin-users/server/` (fns) + `src/modules/admin/admin-users/ui/` (components), or
- Two parallel trees: `src/server/admin-users/` and `src/ui/admin-users/`.

The split makes the eventual package boundaries (option B above) trivial
to draw — the `server/` tree lifts to `@byline/host-tanstack-start`, the
`ui/` tree lifts to `@byline/admin-react`.

### 5d. `src/lib/byline-*.ts` are integration glue, not host lib code.

They sit in `src/lib/` next to `api-utils.ts` and `start-errors.ts` like
any other host helper, but they're really part of the Byline integration
seam. Move them into a single `src/integrations/byline/` directory
(alongside `byline/` for content) so the seam is visually obvious. The
installer only manages files inside `src/integrations/byline/` and
`byline/` and `src/routes/admin/`.

These four cleanups (5a–5d) reduce the surface the installer has to
understand from "scattered across 6 directories" to "three directories
with explicit names" — and they're worth doing as a prerequisite refactor
*before* the first npm publish, because they materially affect the
public package boundaries.

---

## 6. The installer

### 6a. Shape

```
npx create-byline-app my-cms
  ✔ Pick a database driver  · postgres (only option for now)
  ✔ Pick a session provider · jwt (only option for now)
  ✔ Pick a storage provider · local · s3
  ✔ Include locale prefix?  · no  ← see 5b
  ✔ Sample collections?     · yes (docs, news, pages, media)
```

Then later, in an existing project:

```
npx byline add collection blog
npx byline add storage s3        # swap or add storage provider
npx byline add session-provider lucia    # post-1.0
npx byline check                 # verify integrity of the integration tree
```

### 6b. Implementation strategy

A `templates/tanstack-start/` directory at the **repo root** holds the
canonical scaffolding — the routes, the `byline.*.config.ts` files, the
vite config, the tsr config, the docker-compose, the seed script, the
sample `byline/collections/` set. `apps/webapp` becomes a *consumer of
this template* (the dogfood) plus an additional thin layer for repo-only
concerns. That keeps "what gets copied" honest: if it isn't in
`templates/tanstack-start/`, the installer doesn't know about it.

`@byline/cli` consists of:

- A `create-byline-app` bin that copies `templates/tanstack-start/` and
  runs templated substitution (project name, db url placeholder, JWT
  secret hint, etc.).
- An `add` bin that runs codemods over the host's existing
  `byline.admin.config.ts` and writes new files under `byline/`.
- A `check` bin that walks the host's integration tree and warns about
  drift (missing files, version mismatch between installed `@byline/*`
  packages, route file that no longer matches its package re-export).

### 6c. Versioning

The template + the package set ship as a single version (currently 0.9.x).
The installer pins exact `@byline/*` versions matching the template it
ships from, and `byline check` warns if the installed packages drift
from the template's expectation. Pre-1.0 we explicitly reserve the right
to break the template; users re-run `npx create-byline-app` against a
fresh directory and migrate by diff if they need to update.

### 6d. What we don't need to build for 1.0

- A code generator that scaffolds collections from a schema description
  (typing it by hand is fine for now).
- An ejector ("eject from package back into copied source"). The
  re-export route files are simple enough that users can just inline
  them if they need to customize.
- Multi-database, multi-host support. Postgres + TanStack Start only.

---

## 7. Recommended order of operations

1. **Prerequisite refactor** (this codebase, before any publishing):
   1. Keep the `(byline)` route group as the installer's filesystem boundary (5a).
   2. Move admin out from under `{-$lng}` (5b). End state: `src/routes/(byline)/admin/...` and `src/routes/(byline)/sign-in.tsx`.
   3. Split server fns and components inside `src/modules/admin/*` (5c).
   4. Move integration glue into `src/integrations/byline/` (5d).
2. **Publish v0.9.x to npm** with the existing 11 `@byline/*` packages
   only. No host adapter yet — the README explains "for now, copy from
   `apps/webapp`." This gets us dogfooding the npm-installed packages
   on the docs site without committing to the adapter API.
3. **Grow `@byline/ui`** by lifting `src/modules/admin/*/ui/` (after 5c)
   into `@byline/ui/src/admin/components/`, the host's `src/ui/admin/*`
   into `@byline/ui/src/admin/`, and the generic `src/ui/components/*`
   into `@byline/ui/src/components/`. Add subpath exports for `/admin`
   and `/fields` so public-site consumers can import without pulling in
   admin code. Replace the host's local imports with package imports;
   verify nothing changed.
4. **Build `@byline/host-tanstack-start`** by lifting the cleaned-up
   `src/integrations/byline/` and `src/modules/admin/*/server/` (after
   5c) verbatim into a new package, plus the router-coupled shell
   components (`admin-app-bar`, `route-error`, `router-pager`,
   `breadcrumbs/*`). Replace the host's local imports with package
   imports. Verify nothing changed.
5. **Build `@byline/cli`** with `create-byline-app` only. Skip `add`
   and `check` until a real user asks for them.
6. **Cut 1.0** when the docs site has been built end-to-end on the
   installer-scaffolded template, *not* on the in-repo `apps/webapp`.

The "build the docs site on the installed packages" gate in step 6 is
the single best test of whether the packaging story actually works.

---

## 8. Open questions

- **CSS shipping**: today the admin UI assumes Tailwind in the host. Do
  we keep that assumption (cheap, common) or ship pre-built CSS? Tailwind
  v4's CSS-first config makes "bring your own Tailwind" easier, so
  recommendation is to keep the assumption and document it.
- **Drizzle migrations**: `pnpm drizzle:migrate` runs against the host's
  DB. The migrations live in `@byline/db-postgres`. The installer needs
  to wire `drizzle.config.ts` so it points at the package's migrations
  folder; this is a one-line config but it has to be in the template.
- **Seed strategy**: today seeds live in `apps/webapp/byline/seeds/` and
  use the in-process `BylineClient`. Template ships the same shape; no
  change.
- **Locale param for the public site**: if the host's public site uses
  `{-$lng}`, the installer should still scaffold that group — we're only
  removing it from admin (5b), not from the host's content side.

---

## 9. Summary

The route + module surface is already coherent enough to package, but
it's split across six directories that an installer has to understand
piecemeal. Four small refactors (5a–5d) collapse that to three explicit
directories. After those, the existing `@byline/ui` package grows to
absorb the admin UI components and admin shell chrome (under
`/admin/components` and `/admin`), and a single new package —
`@byline/host-tanstack-start` — absorbs the server fns, auth glue,
field-services adapter, route factories, and router-coupled shell
components. The host is left with thin re-export route files, a
`byline/` content directory, the three `byline.*.config.ts` files, and
imports against `@byline/ui` + `@byline/host-tanstack-start`. A
`create-byline-app` installer scaffolds a TanStack Start template that
lands a host on that footprint in one command. 1.0 ships when the docs
site is built end-to-end on that installer, not on the in-repo
`apps/webapp`.
