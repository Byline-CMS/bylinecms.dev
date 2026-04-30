# Host Packaging — Implementation Plan

Companion to [HOST-PACKAGING-ANALYSIS.md](./HOST-PACKAGING-ANALYSIS.md).
Decisions are settled in the analysis; this doc is the execution path.

Scope: TanStack Start hosts, pre-1.0, leading up to a docs site built
end-to-end on the installer-scaffolded template.

---

## Status (as of 2026-04-30)

| Phase | Status | Commit |
|---|---|---|
| 0 — Prerequisite refactors (0.1, 0.2, 0.3) | ✅ shipped | `36924ca` |
| 1 — First npm publish | ⏸ deferred (skip until Phase 3 / 4 land) | — |
| 2 — Grow `@byline/ui` to absorb admin UI | ✅ shipped | `36924ca` |
| 2.1 — Lift admin UI components | ✅ shipped (14 of 15 — `api.tsx` deferred to 3.5, transitively router-coupled via `view-menu`) | — |
| 2.2 — Lift admin shell chrome to `@byline/ui` | ⏭ **redirected to 3.5** — every file in `src/ui/admin/*` is router-coupled (`useRouterState`, `LangLink`) | — |
| 2.3 — Lift generic UI to `@byline/ui` | ⏭ **redirected to 3.5** — only `local-date-time.tsx` qualified (already a duplicate of `@byline/ui`'s); rest is router-coupled | — |
| 2.4 — `@byline/ui` subpath exports | ✅ shipped | — |
| 2.5 — Replace host imports | ✅ shipped (rolled into 2.1) | — |
| 2.6 — Wire `BylineAdminServicesProvider` | ✅ shipped (rolled into 2.1) | — |
| 3.1 — Scaffold `@byline/host-tanstack-start` | ✅ shipped | `2d1b096` |
| 3.2 — Lift server fns | ✅ shipped | `2d1b096` |
| 3.3 — Lift auth context + cookies | ✅ shipped | `2d1b096` |
| 3.4 — Lift integration glue | ✅ shipped (`byline-i18n.tsx` + `empty-module.ts` stayed in `apps/webapp` — see §3.4) | `2d1b096` |
| 3.5 — Lift admin shell components | ✅ shipped — chrome (15 files) + per-area page containers (14 files) lifted with Tailwind→CSS-modules migration; `app-bar.tsx` stays in `apps/webapp` (public-only). | — |
| 3.6 — Build route factories | pending | — |
| 3.7 — Replace host route bodies | pending | — |
| 3.8 — `apps/webapp` end-state check | pending | — |
| 4 — `@byline/cli` + template | pending | — |
| 5 — Build the docs site on the installer | pending | — |
| 6 — Cut 1.0 | pending | — |

Phase 1 (first npm publish) was originally sequenced between Phase 0
and Phase 2 in the plan but skipped on the user's call — the dogfood
loop works fine with `workspace:*` while the host adapter is still
under construction. Reactivate before any external consumer (e.g.
`docs.bylinecms.dev`) lands.

---

## Sequencing principle

Each phase ends with the repo in a **shippable, dogfood-able state**. We
do not start phase N+1 until phase N's verification gate passes. The
verification gate for every phase is the same triple:

- `pnpm build` clean across the workspace.
- `pnpm typecheck` clean across the workspace.
- `pnpm test` clean across the workspace.
- `pnpm dev` boots the admin UI; manual smoke on the dashboard, one
  document collection (create / list / edit / status / delete), one
  upload collection, sign-in / sign-out, admin-users CRUD, admin-roles
  CRUD, permissions inspector.

Where a phase changes the public API of a `@byline/*` package, the
verification gate also includes a pass through `apps/webapp` to confirm
the host code compiles against the new surface.

---

## Phase 0 — Prerequisite refactors (in-repo, no publishing)

Goal: collapse the host integration surface from six directories to
three explicit ones, so the package boundaries can be drawn cleanly in
phases 2–3.

### 0.1 — Move admin out from under `{-$lng}` ✅ shipped (`36924ca`)

Per analysis §5b. Admin UI locale is held by `BylineI18nBridge` and the
user's preference, not the URL.

**Changes:**

- Move `apps/webapp/src/routes/{-$lng}/(byline)/` → `apps/webapp/src/routes/(byline)/`.
- Update every `redirect()` / `Link` / `to=` in those routes to drop the
  `{-$lng}` segment and the `lngParam(...)` thread.
- Update `apps/webapp/src/i18n/hooks/use-locale-navigation.ts` to remove
  the `lngParam` helper if it only existed for admin link helpers.
- Regenerate `routeTree.gen.ts` via the Vite/TSR plugin.

**Files touched:** ~25 files across `src/routes/(byline)/**` and a
handful of admin component files that build `Link` props.

**Risk:** medium. Every admin link / redirect has to thread through
correctly. Sign-in callback URLs need verification.

**Verification:** the standard gate, plus explicit smoke on:

- Sign-in redirects to `/admin` (not `/<locale>/admin`).
- Sign-in `callbackUrl` round-trips correctly.
- Public site (`/{-$lng}/...`) is unaffected.

### 0.2 — Split server fns from components inside `src/modules/admin/*` ✅ shipped (`36924ca`)

Per analysis §5c. Today each module mixes `create.ts` (server fn) with
`components/create.tsx` (React form); they cannot go into the same
package without dragging React/JSX into a server-only context.

**Changes:**

- For each of `admin-account`, `admin-permissions`, `admin-roles`,
  `admin-users`, `auth`, `collections`:
  - Move every `*.ts` server-fn file → `src/modules/admin/<module>/server/`.
  - Move every `components/*.tsx` → `src/modules/admin/<module>/ui/`.
  - Update each `index.ts` barrel to re-export from the new sub-paths.
- Update host imports (`src/routes/(byline)/admin/...`,
  `src/lib/byline-field-services.ts`) to consume from the barrel — they
  shouldn't need to know about the internal split.

**Files touched:** ~70 file moves, ~6 barrel updates, ~15 import-path
adjustments. Mechanical.

**Risk:** low. Pure file relocation, no behavior change.

**Verification:** the standard gate. Anything broken here surfaces as an
import error during build or typecheck.

### 0.3 — Move integration glue into `src/integrations/byline/` ✅ shipped (`36924ca`)

Per analysis §5d. Make the seam between "host" and "Byline integration"
visually obvious.

**Changes:**

- Create `apps/webapp/src/integrations/byline/`.
- Move into it: `src/lib/auth-context.ts`, `src/lib/auth-cookies.ts`,
  `src/lib/byline-client.ts`, `src/lib/byline-field-services.ts`,
  `src/lib/byline-i18n.tsx`, `src/lib/api-utils.ts`,
  `src/lib/abilities.tsx`, `src/lib/start-errors.ts`,
  `src/lib/empty-module.ts` (if Byline-related — verify).
- Update all imports throughout `apps/webapp` from `@/lib/...` →
  `@/integrations/byline/...`.

**Files touched:** ~10 file moves, ~50 import-path updates across the
host (most of `src/routes/(byline)/**` and `src/modules/admin/**` will
need touching).

**Risk:** low. Pure file relocation; tests verify wiring.

**Verification:** the standard gate.

### Phase 0 ship gate

Repo is on `develop`, all three sub-phases merged, no behavior change
visible to the running admin UI. Tag a commit so we have a clean rollback
point before any package work begins.

**Estimated effort:** 0.5–1 day for an experienced contributor. Largely
mechanical.

---

## Phase 1 — First npm publish (`@byline/*` 0.9.x)

Goal: get the existing 11 packages onto npm so external consumers (the
forthcoming docs site, in particular) can install them. **No host
adapter yet.** The README of `apps/webapp` documents "for now, copy from
this directory" as the integration story.

### 1.1 — Pre-publish package hygiene

**Per package, verify:**

- `package.json` `name`, `version`, `license`, `repository`, `homepage`,
  `bugs` are populated and consistent (already done — see existing
  package.json files).
- `package.json` `exports` map is complete; no accidental deep imports
  baked into existing host code.
- `package.json` `files` array is set so `npm pack` produces a clean
  tarball (run `npm pack --dry-run` per package and inspect).
- `dist/` builds clean and the `types` entry resolves.
- README.md is in place (already done).
- LICENSE file is present at package root (verify, add if missing).

**Subpath exports to confirm:**

- `@byline/db-postgres/admin` (already in use).
- `@byline/admin/auth` (already in use).
- `@byline/core/workflow` (already in use).
- `@byline/ui/react` (verify it resolves; current `exports` map looks
  correct).

### 1.2 — Versioning and publish

- Decide whether to publish under `@byline` org (requires npm org setup)
  or a personal scope first. Recommendation: `@byline` org from the
  start to avoid a rename later.
- Set up an npm publish token; store in repo secrets only if we later
  add a release workflow. For 1.x of this plan, manual publish.
- Tag the commit: `v0.9.2` (or whatever version we land on).
- Publish in dependency order:
  1. `@byline/auth`
  2. `@byline/core`
  3. `@byline/client`, `@byline/admin`, `@byline/ui`
  4. `@byline/db-postgres`, `@byline/db-mysql`, `@byline/db-remote`
     (wait: there is no `db-remote`; the repo has `core-remote`).
     Re-check: publish `@byline/core-remote`.
  5. `@byline/storage-local`, `@byline/storage-s3`
  6. `@byline/richtext-lexical`

(All packages are at `version: "0.9.2"` today. Decide whether to bump to
`0.9.3` for the publish or just publish 0.9.2.)

### 1.3 — Verify a fresh consumer install

Outside the monorepo, in a throwaway directory:

```sh
mkdir /tmp/byline-install-check && cd /tmp/byline-install-check
pnpm init
pnpm add @byline/core @byline/db-postgres @byline/storage-local
node -e "import('@byline/core').then(c => console.log(Object.keys(c)))"
```

Confirms the published tarballs resolve, that the type bundle ships
correctly, and that ESM `import` works.

### Phase 1 ship gate

All 11 packages live on npm. `apps/webapp` continues to use
`workspace:*` for development; we have not broken the dogfood loop.

**Estimated effort:** 0.5 day, mostly waiting on `npm pack --dry-run`
inspection across packages.

---

## Phase 2 — Grow `@byline/ui` to absorb admin UI

Goal: every framework-neutral React surface lives in `@byline/ui`.
After this phase, `apps/webapp` imports admin UI components from
`@byline/ui` instead of from local `src/modules/admin/*/ui/`.

### 2.1 — Lift admin UI components into `@byline/ui/src/admin/components/` ✅ shipped (`36924ca`) — 14 of 15 (`api.tsx` deferred to 3.5)

**Source → destination:**

- `apps/webapp/src/modules/admin/admin-account/ui/*` → `packages/ui/src/admin/components/admin-account/`
- `apps/webapp/src/modules/admin/admin-permissions/ui/*` → `packages/ui/src/admin/components/admin-permissions/`
- `apps/webapp/src/modules/admin/admin-roles/ui/*` → `packages/ui/src/admin/components/admin-roles/`
- `apps/webapp/src/modules/admin/admin-users/ui/*` → `packages/ui/src/admin/components/admin-users/`
- `apps/webapp/src/modules/admin/auth/sign-in-form.tsx` → `packages/ui/src/admin/components/auth/sign-in-form.tsx`
- `apps/webapp/src/modules/admin/collections/ui/*` → `packages/ui/src/admin/components/collections/`

**Server-fn injection:**

These components currently import server fns directly from the host's
`src/modules/admin/<module>/server/*`. After the lift, they cannot do
that — `@byline/ui` is framework-neutral and cannot depend on
`@tanstack/react-start`.

The pattern is already established by `BylineFieldServicesProvider` for
collection field services. Extend it:

- Define `BylineAdminServices` in `packages/ui/src/services/admin-services.ts`
  — a typed contract carrying every server fn the admin UI needs:
  `listAdminUsers`, `createAdminUser`, `setAdminUserPassword`,
  `listRoles`, `createRole`, `setRoleAbilities`, `signIn`, `signOut`,
  `getCurrentAdminUser`, etc.
- Create `BylineAdminServicesProvider` in
  `packages/ui/src/services/admin-services-provider.tsx`.
- Each lifted component swaps direct server-fn imports for
  `useBylineAdminServices()`.

**Risk:** medium. The `BylineAdminServices` contract has to be complete
on first pass — every server fn the admin UI calls. Missing one
surfaces as a runtime error. Mitigate by enumerating directly from
the (now-split) `src/modules/admin/*/server/*.ts` files.

### 2.2 — Lift admin shell chrome into `@byline/ui/src/admin/` ⏭ redirected to 3.5

**Phase 2 reality-check:** every file in `src/ui/admin/*` is router-coupled
(`useRouterState`, `LangLink`, host's `useAbilities`, hardcoded admin paths).
Lifting into `@byline/ui` would either require a 3rd injection layer
("navigation services") or break `@byline/ui`'s framework-neutral
contract. Honest call was to redirect the entire shell chrome to
`@byline/host-tanstack-start/admin-shell/chrome/` in Phase 3.5.

**Source → destination:**

- `apps/webapp/src/ui/admin/menu-drawer.{tsx,css}` → `packages/ui/src/admin/menu-drawer.{tsx,module.css}`
- `apps/webapp/src/ui/admin/menu-provider.tsx` → `packages/ui/src/admin/menu-provider.tsx`
- `apps/webapp/src/ui/admin/content.tsx` → `packages/ui/src/admin/content.tsx`
- `apps/webapp/src/ui/admin/hamburger.tsx` → `packages/ui/src/admin/hamburger.tsx`
- `apps/webapp/src/ui/admin/drawer-toggle.tsx` → `packages/ui/src/admin/drawer-toggle.tsx`

These are pure React with no router coupling — straight lift.

### 2.3 — Lift generic UI into `@byline/ui/src/components/` ⏭ mostly redirected to 3.5

**Phase 2 reality-check:** of the 8 files in `src/ui/components/`, 7 are
router-coupled (`admin-app-bar`, `app-bar`, `branding`, `route-error`,
`router-pager`, `th-sortable`, `sort-icons`). Only `local-date-time.tsx`
qualified for `@byline/ui` — and it was already a duplicate of an
existing file there. Phase 2.3 deleted the host duplicate and rewired
5 import sites. The other 7 files lift in 3.5 to
`@byline/host-tanstack-start/admin-shell/chrome/`.

Currently empty; this fills it.

**Source → destination:**

- `apps/webapp/src/ui/components/branding.tsx` → `packages/ui/src/components/branding.tsx`
- `apps/webapp/src/ui/components/th-sortable.tsx` → `packages/ui/src/components/th-sortable.tsx`
- `apps/webapp/src/ui/components/sort-icons.tsx` → `packages/ui/src/components/sort-icons.tsx`
- `apps/webapp/src/ui/components/local-date-time.tsx` → `packages/ui/src/components/local-date-time.tsx` (deduplicate against existing `src/ui/fields/local-date-time.tsx` — pick one home, eliminate the other).

**Stays out** (router-coupled):

- `admin-app-bar.tsx`, `route-error.tsx`, `router-pager.tsx` — Phase 3.
- `breadcrumbs/*` — Phase 3.

### 2.4 — Add subpath exports ✅ shipped (`36924ca`)

Update `packages/ui/package.json` `exports`:

```json
{
  ".": "./dist/react.js",
  "./react": "./dist/react.js",
  "./admin": "./dist/admin/index.js",
  "./admin/components": "./dist/admin/components/index.js",
  "./fields": "./dist/fields/index.js",
  "./forms": "./dist/forms/index.js",
  "./components": "./dist/components/index.js",
  "./services": "./dist/services/index.js"
}
```

Confirm rslib emits the entry points correctly (may need `lib`-array
config update).

### 2.5 — Replace host imports ✅ shipped (`36924ca`) — rolled into 2.1

Mechanical pass through `apps/webapp/src/routes/(byline)/**`, swap:

- `@/modules/admin/<x>/ui/...` → `@byline/ui/admin/components/...`
- `@/ui/admin/...` → `@byline/ui/admin/...`
- `@/ui/components/<generic>` → `@byline/ui/components/...`

After replacement, `apps/webapp/src/modules/admin/*/ui/` and
`apps/webapp/src/ui/admin/` and the lifted bits of
`apps/webapp/src/ui/components/` should be deletable.

### 2.6 — Wire `BylineAdminServicesProvider` at the admin route boundary ✅ shipped (`36924ca`) — rolled into 2.1

In `apps/webapp/src/routes/(byline)/admin/route.tsx`, wrap the existing
`BylineFieldServicesProvider` with `BylineAdminServicesProvider`,
threading the host's server-fn implementations through.

The host's `src/integrations/byline/byline-field-services.ts` grows a
sibling `byline-admin-services.ts` that maps server fns to the contract.

### Phase 2 ship gate

Standard verification gate. Bump `@byline/ui` to 0.10.0 (minor — public
surface grew). `apps/webapp` continues to work end-to-end. The
`@byline/ui` tarball when unpacked contains the admin components.

**Estimated effort:** 2–3 days. The mechanical work is fast; the
`BylineAdminServices` contract design needs care.

---

## Phase 3 — Build `@byline/host-tanstack-start`

Goal: every framework-coupled piece of host integration lives in one
package. After this phase, `apps/webapp` is reduced to:

- `byline.{common,server,admin}.config.ts`
- `byline/` (collections, blocks, fields, seeds)
- `src/routes/(byline)/**` — all files are ~10-line re-exports
- `src/integrations/byline/` — only the small wiring file that calls
  `createBylineHost(config)` and the `BylineAdminServicesProvider` setup
- Host vite/tsr/tailwind config files

### 3.1 — Scaffold the package ✅ shipped (`2d1b096`)

```
packages/host-tanstack-start/
├── package.json     # @byline/host-tanstack-start
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── server-fns/
│   │   ├── admin-account/
│   │   ├── admin-permissions/
│   │   ├── admin-roles/
│   │   ├── admin-users/
│   │   ├── auth/
│   │   └── collections/
│   ├── auth/
│   │   ├── auth-context.ts
│   │   └── auth-cookies.ts
│   ├── integrations/
│   │   ├── byline-client.ts
│   │   ├── byline-field-services.ts
│   │   ├── byline-admin-services.ts
│   │   ├── byline-core.ts        # NEW — typed accessor for the composed BylineCore
│   │   ├── api-utils.ts
│   │   ├── abilities.tsx
│   │   └── start-errors.ts
│   │   # byline-i18n.tsx and empty-module.ts STAY in apps/webapp — see §3.4
│   ├── admin-shell/
│   │   ├── chrome/                  # shared shell — used by every admin area
│   │   │   ├── menu-drawer.{tsx,module.css}
│   │   │   ├── menu-provider.tsx
│   │   │   ├── content.tsx
│   │   │   ├── hamburger.tsx
│   │   │   ├── drawer-toggle.tsx
│   │   │   ├── admin-app-bar.tsx
│   │   │   ├── app-bar.tsx
│   │   │   ├── branding.tsx
│   │   │   ├── route-error.tsx
│   │   │   ├── router-pager.tsx
│   │   │   ├── th-sortable.tsx
│   │   │   ├── sort-icons.tsx
│   │   │   └── breadcrumbs/
│   │   ├── admin-roles/             # per-area page containers
│   │   │   ├── container.tsx
│   │   │   ├── list.tsx
│   │   │   └── delete.tsx
│   │   ├── admin-users/
│   │   │   ├── container.tsx
│   │   │   ├── list.tsx
│   │   │   └── delete.tsx
│   │   └── collections/
│   │       ├── api.tsx
│   │       ├── create.tsx
│   │       ├── edit.tsx
│   │       ├── history.tsx
│   │       ├── list.tsx
│   │       ├── view-menu.tsx
│   │       └── tanstack-navigation-guard.ts
│   └── routes/
│       ├── createAdminLayoutRoute.tsx
│       ├── createAdminDashboardRoute.tsx
│       ├── createSignInRoute.tsx
│       ├── createCollectionListRoute.tsx
│       ├── createCollectionCreateRoute.tsx
│       ├── createCollectionEditRoute.tsx
│       ├── createCollectionHistoryRoute.tsx
│       ├── createCollectionApiRoute.tsx
│       ├── createAdminUsersListRoute.tsx
│       ├── createAdminUserEditRoute.tsx
│       ├── createAdminRolesListRoute.tsx
│       ├── createAdminRoleEditRoute.tsx
│       ├── createAdminPermissionsRoute.tsx
│       └── createAdminAccountRoute.tsx
└── README.md
```

The `admin-shell/` split — `chrome/` for the shared shell vs. one
sub-folder per admin area for that area's page containers — keeps the
package navigable as it grows. Each `routes/createXRoute.tsx` factory
imports the matching `admin-shell/<area>/<view>.tsx` page container and
wires it into a `createFileRoute()` with the loader, `beforeLoad`
guards, and parameter shape.

Build pipeline: **rslib** (matches `@byline/ui`), set up from the
start so 3.5's CSS-module-bearing shell components don't need a
pipeline switch later. `bundle: false`, per-file emit, `cssModules: {}`
+ `emitCss: true`. The same `rslib build` + `tsc-alias`-free pattern
as `@byline/ui`.

**Lessons learned during the scaffold (so the next host package
doesn't re-discover them):**

1. **`tsconfig.build.json` must include all source files**, not just
   the entry barrel. rslib's per-file declaration emission only
   generates `.d.ts` for files reachable from the build's `include`.
   When the entry barrel is empty (subpath-only public surface),
   that's only the barrel itself — every other file ends up without
   declarations, breaking subpath imports for consumers. Use
   `"include": ["./src/**/*", "./src/declarations.d.ts"]` with the
   test files explicitly excluded.

2. **Subpath wildcards don't auto-resolve `index.js`.** A pattern
   like `"./server-fns/*"` with target `"./dist/server-fns/*.js"`
   substitutes `*` literally. So `import from
   '@byline/host-tanstack-start/server-fns/admin-roles'` fails
   because there's no `server-fns/admin-roles.js` — only
   `server-fns/admin-roles/index.js`. The fix is **explicit per-module
   entries** for the barrels, plus a single-`*` wildcard for deep
   imports:

   ```json
   "./server-fns/admin-roles": {
     "types": "./dist/server-fns/admin-roles/index.d.ts",
     "import": "./dist/server-fns/admin-roles/index.js"
   },
   "./server-fns/*": {
     "types": "./dist/server-fns/*.d.ts",
     "import": "./dist/server-fns/*.js"
   }
   ```

   The `*` matches anything including slashes, so `/admin-roles/reorder`
   resolves to `./dist/server-fns/admin-roles/reorder.js`. (One `*`
   per pattern is the Node.js spec.)

3. **The host package's empty root barrel is intentional.** Every
   consumption path is a subpath import — there's no
   `import { ... } from '@byline/host-tanstack-start'` API. Keeps the
   public surface explicit and forces consumers to pull from the
   correct subpath.

**Dependencies:**

- `@tanstack/react-start` (peer)
- `@tanstack/react-router` (peer)
- `@byline/core`, `@byline/client`, `@byline/auth`, `@byline/admin`,
  `@byline/ui` (peer)
- `react`, `react-dom` (peer)

### 3.2 — Lift server fns ✅ shipped (`2d1b096`)

**Source → destination:**

- `apps/webapp/src/modules/admin/<m>/server/*` →
  `packages/host-tanstack-start/src/server-fns/<m>/*`
- `apps/webapp/src/modules/admin/<m>/index.ts` (the barrel) →
  `packages/host-tanstack-start/src/server-fns/<m>/index.ts`. The
  barrel's relative paths flatten from `./server/<x>` → `./<x>`.

**Architectural change in `@byline/core`:** the lifted server fns
previously imported `bylineCore` from a relative
`apps/webapp/byline.server.config.js` path. That path no longer
resolves from inside the package. Added:

- `defineBylineCore(core)` / `getBylineCoreUnsafe()` in
  `packages/core/src/config/config.ts` — same `Symbol.for(...)`
  global-singleton pattern as `defineServerConfig` /
  `getServerConfig`.
- `getBylineCore<TAdminStore>()` typed accessor in
  `packages/core/src/core.ts` and re-exported from
  `@byline/core`.
- `initBylineCore()` now calls `defineBylineCore(core)` at the end
  of init.

This is the host-agnostic accessor for `core.adminStore` /
`core.abilities` / etc. Future host packages (`@byline/host-nextjs`,
…) consume it the same way.

A small typed helper `packages/host-tanstack-start/src/integrations/byline-core.ts`
pre-binds `TAdminStore` to `AdminStore` from `@byline/admin`:

```ts
import type { AdminStore } from '@byline/admin'
import { type BylineCore, getBylineCore } from '@byline/core'

export function bylineCore(): BylineCore<AdminStore> {
  return getBylineCore<AdminStore>()
}
```

The 24 server fns that previously did `bylineCore.adminStore!` (where
`bylineCore` was the relative import) now do `bylineCore().adminStore!`
(where `bylineCore` is the helper).

### 3.3 — Lift auth context + cookies ✅ shipped (`2d1b096`)

**Source → destination:**

- `apps/webapp/src/integrations/byline/auth-context.ts` →
  `packages/host-tanstack-start/src/auth/auth-context.ts`
- `apps/webapp/src/integrations/byline/auth-cookies.ts` →
  `packages/host-tanstack-start/src/auth/auth-cookies.ts`
- `auth-context.test.node.ts` lifted with the file. Vitest config
  (`vitest.config.ts`) and `test` script added to the package; the 6
  unit tests pass in their new home.

These read TanStack Start request headers via
`@tanstack/react-start/server`. Straight lift.

`apps/webapp`'s test script kept its node-mode run with
`--passWithNoTests` so it doesn't fail with "no test files found"
now that the only `.test.node.ts` it had has moved out.

### 3.4 — Lift the remaining integration glue ✅ shipped (`2d1b096`)

**Source → destination:**

- `byline-client.ts` → `packages/host-tanstack-start/src/integrations/byline-client.ts`
- `byline-field-services.ts` → `packages/host-tanstack-start/src/integrations/byline-field-services.ts`
- `byline-admin-services.ts` → `packages/host-tanstack-start/src/integrations/byline-admin-services.ts`
- `api-utils.ts` → `packages/host-tanstack-start/src/integrations/api-utils.ts`
- `abilities.tsx` → `packages/host-tanstack-start/src/integrations/abilities.tsx`
- `start-errors.ts` → `packages/host-tanstack-start/src/integrations/start-errors.ts`

**Stayed in `apps/webapp`** for honest reasons:

- **`byline-i18n.tsx`** — bridges the host's webapp-specific i18n
  setup (`TranslationsContext`, `useLocale`, `i18nConfig`,
  `interfaceLanguageMap`) into Byline's `BylineI18nProvider` from
  `@byline/ui`. Not portable to other hosts without dragging the
  webapp's i18n machinery along. A future Next.js host would ship
  its own bridge file with the same shape; the `@byline/ui` consumer
  contract stays unchanged.
- **`empty-module.ts`** — pure vite-config shim for
  `@node-rs/argon2-wasm32-wasi`. Build infrastructure, not adapter
  code. Each host's `vite.config.ts` aliases the WASM peer to a
  local stub.

`byline-admin-services.ts` and `byline-field-services.ts` had their
internal imports rewired from `@/modules/admin/<m>` (host alias) to
relative imports `../server-fns/<m>/index.js` since the server fns
now live in the same package. `api-utils.ts` switched from the
relative `byline.server.config.js` import to the new `bylineCore()`
helper (see §3.2).

**No `createBylineHost(config)` aggregator** — the original plan
proposed a single root entry that returned all wired adapters as a
frozen object. Skipped because (a) the package's public surface is
subpath-only by design (see §3.1 lessons), (b) the host wires the
named adapters individually at the route shell anyway
(`bylineFieldServices`, `bylineAdminServices`), and (c) adding an
aggregator would re-introduce a root entry whose only purpose is to
re-export. Each adapter is its own subpath import.

**Known limitations carried into Phase 3.5+:**

- `@byline/db-postgres` and `@byline/storage-local` are non-optional
  peer deps because `server-fns/auth/current-user.ts` imports
  `PgAdapter` / `createAdminUsersRepository` and
  `server-fns/collections/upload.ts` imports the storage-local image
  helpers. This bakes concrete-adapter choices into the host package.
  Untangling these into an adapter-agnostic shape is a separate
  refactor — for Phase 3 the package is fine as "TanStack Start host
  adapter that presumes Postgres + filesystem-storage Byline."

### 3.5 — Lift router-coupled shell components 🔜 next session

Phase 2 confirmed that the entire admin shell — both the chrome and the
per-area page containers — is router-coupled and belongs in this
package. Lifts split into **shared chrome** and **per-area page
containers**.

**Starting conditions** (verified clean at commit `2d1b096`):

- `pnpm typecheck`, `pnpm lint`, `pnpm test` all green across the
  workspace.
- `apps/webapp/src/modules/admin/` contains only `admin-roles/ui/`,
  `admin-users/ui/`, and `collections/ui/` (the page containers that
  move in this phase). All other module subdirs were emptied in
  Phase 3.2 + Phase 0.2.
- `apps/webapp/src/ui/admin/` and `apps/webapp/src/ui/components/`
  still contain the chrome that moves in this phase. `local-date-time`
  is gone from `src/ui/components/` — it's already in `@byline/ui`
  post-Phase-2.3.
- `packages/host-tanstack-start/src/admin-shell/` skeleton dirs exist
  (`chrome/`, `admin-roles/`, `admin-users/`, `collections/`) but are
  empty.
- The package's rslib pipeline + CSS-module support is already
  configured — no build-pipeline work needed in 3.5.

**Estimated scope:** ~30 files moving + Tailwind→CSS-modules migration
of all of them. Comparable to (slightly heavier than) Phase 2.1.
Realistic floor: 3–5 hours of focused work. Plan to break across two
sittings if needed: (a) the lift itself + chrome migration, (b) the
per-area page-container migration. Each batch is independently
verifiable.

**Migration pattern reminder** — every file that lifts into the
package needs every Tailwind utility removed from React `className=`
strings. Replace with the `@byline/ui` dual-class convention (CSS
module local + `:global(.byline-<scope>-<thing>)` override handle).
Watch specifically for:

- Tailwind classes passed as `className` strings (the obvious case)
- Tailwind classes passed as `containerClasses` / `componentClasses`
  / similar named slot props on uikit components (the `!w-auto` trap
  from Phase 2.1)
- Tailwind classes inside `cx()` calls
- The `italic` and `font-bold` cases — `font-bold` ships in uikit
  globally so it works as-is, `italic` does not and needs a CSS
  module class.
- `bg-canvas-{25,50,…}` Tailwind classes map to uikit
  `var(--canvas-{25,50,…})` tokens (a webapp-specific extension to
  the standard Tailwind scale; both exist).
- `bg-gray-25` exists too — map to `var(--gray-25)`. Other gray scales
  follow the standard Tailwind→uikit pattern.

**Shared chrome** (`apps/webapp/src/ui/admin/*` + router-coupled bits of
`apps/webapp/src/ui/components/*` + `apps/webapp/src/ui/breadcrumbs/*`)
→ `packages/host-tanstack-start/src/admin-shell/chrome/`:

- `menu-drawer.{tsx,css}` (move `menu-drawer.css` → `menu-drawer.module.css`)
- `menu-provider.tsx`
- `content.tsx`
- `hamburger.tsx`
- `drawer-toggle.tsx`
- `admin-app-bar.tsx`
- `app-bar.tsx`
- `branding.tsx`
- `route-error.tsx`
- `router-pager.tsx`
- `th-sortable.tsx`
- `sort-icons.tsx`
- `breadcrumbs/{breadcrumbs,breadcrumbs-client,breadcrumbs-provider,@types}.{tsx,ts}`

**Per-area page containers** → `packages/host-tanstack-start/src/admin-shell/<area>/`:

- `apps/webapp/src/modules/admin/admin-roles/ui/{container,list,delete}.tsx`
  → `admin-shell/admin-roles/`
- `apps/webapp/src/modules/admin/admin-users/ui/{container,list,delete}.tsx`
  → `admin-shell/admin-users/`
- `apps/webapp/src/modules/admin/collections/ui/{api,create,edit,history,list,view-menu,tanstack-navigation-guard}.{tsx,ts}`
  → `admin-shell/collections/`

These page containers carry their own Tailwind utilities today (same
class of regression we hit in Phase 2.1 — see the `!w-auto` /
`italic` fixes on lifted `@byline/ui` components). Plan to convert
their Tailwind class strings to CSS modules at lift time, following the
`@byline/ui` dual-class convention.

The host's own `apps/webapp/src/ui/admin/` and `apps/webapp/src/ui/components/`
directories should be empty after this lift (the `LocalDateTime` import
already comes from `@byline/ui` post-Phase-2.3).

### 3.6 — Build route factories

The big design step in this phase. Each route file in the host becomes
a one-liner that calls a factory.

**Factories to build** (`packages/host-tanstack-start/src/routes/`):

- `createAdminLayoutRoute(path)` — handles auth gate, wraps
  `BylineFieldServicesProvider` + `BylineAdminServicesProvider` +
  `BylineI18nBridge` + `AdminMenuProvider` + admin shell chrome.
- `createAdminDashboardRoute(path)` — the index route with stat tiles.
- `createCollectionListRoute(path)` — the `/admin/collections/$collection/`
  list view.
- `createCollectionCreateRoute(path)`
- `createCollectionEditRoute(path)` — `/admin/collections/$collection/$id/`
- `createCollectionHistoryRoute(path)`
- `createCollectionApiRoute(path)`
- `createAdminUsersListRoute(path)`, `createAdminUserEditRoute(path)`
- `createAdminRolesListRoute(path)`, `createAdminRoleEditRoute(path)`
- `createAdminPermissionsRoute(path)`
- `createAdminAccountRoute(path)`
- `createSignInRoute(path)`

Each factory returns the `Route` object (the result of
`createFileRoute(path)({ ... })`) ready for assignment to the host's
`export const Route = ...`.

**Why factories instead of "import the Route directly"?** TanStack
file-routes take their path string at creation time and generate types
keyed off it. The path lives in the host's filesystem, not the package.
Factories let the package own the implementation while the host owns
the path string.

### 3.7 — Replace host route bodies with factory calls

Each file in `apps/webapp/src/routes/(byline)/**` collapses to:

```ts
import { createCollectionListRoute } from '@byline/host-tanstack-start/routes'
export const Route = createCollectionListRoute(
  '/(byline)/admin/collections/$collection/'
)
```

After replacement, regenerate `routeTree.gen.ts`.

### 3.8 — `apps/webapp` end state check

After Phase 3, `apps/webapp/src/` should contain:

- `routes/(byline)/**` — all files ~10 lines, all calls to factories
  from `@byline/host-tanstack-start/routes/*`.
- `routes/__root.tsx`, `routes/{-$lng}/_public/**` — host-owned public
  site.
- `integrations/byline/byline-i18n.tsx` — the host-app-specific i18n
  bridge that mounts the webapp's `TranslationsContext` into Byline's
  `BylineI18nProvider`. Stays in apps/webapp because it's tied to
  the webapp's specific i18n setup.
- `integrations/byline/empty-module.ts` — vite-shim for
  `@node-rs/argon2-wasm32-wasi`. Stays because it's host-bundler
  infrastructure, not adapter code.
- `client.tsx`, `server.ts`, `start.ts`, `router.tsx` — TanStack Start
  scaffolding (host-owned).
- `i18n/` — host's own i18n implementation for the public site.
- `byline.{common,server,admin}.config.ts` (at the webapp root) —
  collection definitions + adapter wiring.

`src/modules/` should be empty and removable. `src/ui/admin/`,
`src/ui/components/`, and `src/ui/breadcrumbs/` should be empty and
removable. The host's `src/lib/` was already removed in Phase 0.3 —
nothing to revisit there.

There is **no** `src/integrations/byline/host.ts` aggregator (was
proposed earlier). The host wires the named adapters individually at
the admin route shell — `bylineFieldServices`, `bylineAdminServices`,
the admin `BylineClient` — by importing them from the relevant
`@byline/host-tanstack-start/integrations/*` subpaths. See §3.4.

### Phase 3 ship gate

Standard verification gate. Publish `@byline/host-tanstack-start@0.10.0`
alongside the corresponding `@byline/ui@0.10.x`. Bump host adapter and
related packages in the same release wave.

**Estimated effort:** 4–6 days. The route factories are the design-heavy
piece; everything else is mechanical lifts.

---

## Phase 4 — Build `@byline/cli` and the template

Goal: `npx create-byline-app my-cms` scaffolds a working TanStack Start
host on the cleaned-up footprint from Phase 3.

### 4.1 — Extract `templates/tanstack-start/`

At the **repo root**, create `templates/tanstack-start/`. This is the
canonical scaffolding; `apps/webapp` becomes a *consumer of this
template* + repo-only additions.

The template contains:

- `byline.{common,server,admin}.config.ts` (with placeholders for
  project name, signing-secret hint, DB URL).
- `byline/` — a starter set: one document collection (`pages`), one
  upload collection (`media`).
- `src/routes/__root.tsx`, `src/routes/(byline)/**` — full re-export
  tree against `@byline/host-tanstack-start`.
- `src/routes/index.tsx` — a placeholder public landing page.
- `src/integrations/byline/host.ts` — the `createBylineHost(config)` wiring.
- `src/client.tsx`, `src/server.ts`, `src/start.ts`, `src/router.tsx`,
  `src/routeTree.gen.ts`.
- `vite.config.ts`, `tsr.config.json`, `tailwind.config.{js,ts}`,
  `postcss.config.js`, `tsconfig.json`.
- `postgres/postgres.sh` + `docker-compose.yml` — dev DB.
- `drizzle.config.ts`.
- `.env.example`, `.gitignore`.
- `package.json` with placeholder name and the full `@byline/*`
  dependency set pinned to the release.
- `README.md` for the scaffolded project.

**Verification:** copy the template manually to a fresh directory, run
`pnpm install && pnpm dev`, confirm a working admin UI. Doing this
manually first proves the template is self-sufficient before the CLI
gets involved.

### 4.2 — Reduce `apps/webapp` to a template consumer

`apps/webapp` keeps only what's repo-specific (extra demo content for
the dogfood, contributor docs). Everything else is symlinked /
generated from `templates/tanstack-start/` so the two cannot drift.

Concretely: a small build script syncs `templates/tanstack-start/` →
`apps/webapp/` (with a configurable overlay for repo-only files) before
`pnpm dev` / `pnpm build`. Or simpler: `apps/webapp` *is* the template,
and the CLI copies it directly. The latter is less ceremony if we
accept that `apps/webapp/package.json` becomes templated.

Decision deferred until 4.1 lands; the manual-copy verification will
inform which approach is cleaner.

### 4.3 — Build `@byline/cli`

```
packages/cli/
├── package.json     # @byline/cli, bin: { "create-byline-app": "./bin/create.js" }
├── bin/
│   └── create.js    # entry
└── src/
    ├── create.ts    # the create-byline-app implementation
    ├── prompts.ts   # interactive prompts (db driver, storage, etc.)
    └── template.ts  # template copy + variable substitution
```

The first cut of `create-byline-app`:

- Takes a target directory as the only positional argument.
- Prompts: project name, storage provider (local/s3), include sample
  collections (yes/no).
- Copies `templates/tanstack-start/` → target dir.
- Substitutes placeholders (project name, signing secret hint).
- Runs `pnpm install` (or `npm install` / `yarn install` based on
  detection).
- Prints next steps: `cd <name>`, set `.env`, `pnpm dev`.

**Skip for first cut:** `byline add`, `byline check`. Those land
post-1.0 when a real user asks for them.

### 4.4 — Publish a separate scope binary

Decide: ship as `@byline/cli` (with bin `create-byline-app`) or as a
standalone `create-byline-app` package?

Recommendation: both. `create-byline-app` is the package most users
will type after `npx`. `@byline/cli` is the package that holds future
`add` / `check` commands. The two share the same source; one is a
thin re-export bin.

This mirrors `create-next-app` + `next` and `create-vite` + `vite`.

### Phase 4 ship gate

`npx create-byline-app /tmp/test-byline` produces a working host on a
fresh machine (verified on macOS + Linux). The produced host runs the
admin UI end-to-end. Publish `@byline/cli` and `create-byline-app`
0.11.0.

**Estimated effort:** 2–3 days. The template extraction is the bulk;
the CLI itself is small.

---

## Phase 5 — Build the docs site on the installer

Goal: prove the packaging story by using it.

### 5.1 — Scaffold

`npx create-byline-app docs.bylinecms.dev` against a fresh repo (or
fresh directory in a separate repo). Use only the published `@byline/*`
packages — no `workspace:*` references.

### 5.2 — Shape the content model

Define docs-site collections in the scaffolded `byline/`:

- `docs-pages` — markdown / richtext content with `slug`, `category`,
  `order`, `summary`.
- `docs-categories` — sidebar grouping.
- `media` — assets.

Migrate the analysis docs from this repo into the docs collection over
time.

### 5.3 — Build the public site

The docs site's `src/routes/{-$lng}/_public/**` (or whatever the host
chooses) renders content from `@byline/client`. This exercises the
public-read path on the published packages, with `status: 'published'`
defaults, populate, beforeRead access control, and the `@byline/ui`
field renderers — everything the analysis claimed would work.

Bugs found here are real bugs in the public surface. Fix them in the
relevant `@byline/*` package, publish a 0.11.x patch, bump the docs
site.

### Phase 5 ship gate

Docs site is deployed and serves content from a Byline backend installed
via `npx create-byline-app`. No `workspace:*` references in the docs
site's `package.json`.

**Estimated effort:** open-ended (depends on docs content). The
infrastructure side is days; the content side is weeks.

---

## Phase 6 — Cut 1.0

When Phase 5 is live and stable for two weeks with no critical bugs,
bump every `@byline/*` package to 1.0.0. The 0.x → 1.0 transition is
purely a versioning signal — the public API does not change.

The 1.0 README of `bylinecms.dev` updates the "early beta" note to
"stable, semver-protected from here." All breaking changes from this
point require a major-version bump.

---

## Tracking

Each phase gets its own short status doc as work progresses, mirroring
the pattern in `docs/analysis/PHASES-OF-WORK.md`. The MEMORY index in
`/Users/tony/.claude/projects/.../memory/MEMORY.md` should grow a
`project_packaging_status.md` entry that this doc updates per phase.

## Open decisions to make before starting Phase 0

These don't block Phase 0 but should be settled by Phase 1:

1. **npm org name.** `@byline` confirmed available?
2. **`db-mysql` and `core-remote`.** Both ship as placeholders today.
   Publishing a placeholder is fine, but the README should be explicit
   that they're not implemented. (Already done in the READMEs we just
   wrote.)
3. **`@byline/ui` style of subpath exports.** Confirm rslib supports the
   multi-entry pattern proposed in 2.4 — if not, fall back to a single
   entry with named exports.
4. **TanStack Start version pin.** The peer-dep range on
   `@byline/host-tanstack-start` matters. Pin to the major TanStack Start
   has been stable on; widen later.
5. **Tailwind assumption.** The analysis recommends "bring your own
   Tailwind." Confirm that's acceptable, or commit to shipping pre-built
   CSS.
