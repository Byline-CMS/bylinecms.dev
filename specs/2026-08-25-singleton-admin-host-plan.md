# Singleton Admin Host Implementation Plan

> **For implementers:** Work the tasks in order. Each task is an independent
> red → green → commit cycle with its own tests; do not start a task before its
> predecessor is committed. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a singleton editable in the admin interface — a dashboard card, a stable
id-less route, and the existing document editor with its collection-only affordances removed.

**Architecture:** No new editor. `SingletonView` owns the route concerns — stable URL, lazy
first save, locale navigation, preview and history links, singleton server functions — and
delegates the entire editing experience to the shared `FormRenderer`, configured through the
capability props Plan 1 added. The admin-config surface becomes a discriminated union
mirroring the definition union.

**Tech Stack:** TanStack Start, React 19, TypeScript, Vitest, Biome, pnpm/Turborepo.

**Spec:** `specs/2026-08-25-singleton-documents-design.md` — this plan implements **Phase 3**
(“TanStack Start admin host”), plus the `SingletonAdminConfig` work deferred from Plan 2.

**Depends on:**
- `specs/2026-08-25-form-renderer-contracts-plan.md` — **complete** (commits `4a5c5164`,
  `8a9a10ce`, `7dbae9c9`, `c1b240aa`). This plan consumes `showPath`, `heading`, the
  `onDelete` gate, and `FormAdminConfig` directly.
- `specs/2026-08-25-singleton-schema-and-storage-plan.md` — all eight tasks.
- `specs/2026-08-25-singleton-lifecycle-and-client-plan.md` — all seven tasks. Every server
  function here is a thin wrapper over `SingletonHandle`.

## Granularity

Contract-level, as established for Plan 2's Tasks 6–8 and all of Plan 3: **required behaviour
→ artifacts → red/green tests → gates**. Call sites are discovered with `rg` and
`pnpm typecheck`. What is fixed is the behaviour and the gates.

## Global Constraints

- Biome formatting: 2-space indent, single quotes, no semicolons, 100-char line width,
  trailing commas (ES5).
- **Lint scope:** `pnpm exec biome check --write <paths>` per task; root `pnpm lint` once in
  final verification, with its diff inspected.
- **Focused test runs:** filter passed directly, no `--` separator. `packages/admin` and
  `apps/webapp` component tests are jsdom mode.
- Conventional commits, lowercase after the colon, past tense. `git commit -s`; the DCO
  `Signed-off-by` trailer is the ONLY permitted trailer.
- **Every commit leaves `pnpm typecheck` and `pnpm test` green.**
- Admin-interface strings are translated. Any new user-facing string needs a key in **every**
  locale bundle under `packages/i18n/src/admin/`, or the boot validator warns on key drift.

---

### Task 1: Add `SingletonAdminConfig` and the admin-config union

**Required behaviour**

1. `SingletonAdminConfig` extends `FormAdminConfig` (Plan 1 Task 2) and adds `slug`, the
   dashboard `group`, and `preview`. It has **no** `columns`, `defaultSort`, `defaultColumns`,
   `itemView`, `itemViewSort`, `listView`, or `listActions` — declare them `?: never` so the
   mistake is a compile error at the definition site, matching how `SingletonDefinition`
   handles collection-only schema options.
2. **The discriminator is explicit**, mirroring the definition union:
   `SingletonAdminConfig.singleton: true`, `CollectionAdminConfig.singleton?: false`. Both
   factories emit it, so authors never write it.
3. **Naming, decided:** `CollectionAdminConfig` keeps its current meaning — the
   **multi-collection** admin config — so every downstream app and every existing
   `defineAdmin()` call compiles untouched. `AdminConfig.admin` is typed by a **new** union
   name, `AdminResourceConfig = CollectionAdminConfig | SingletonAdminConfig`. Do not
   repurpose the existing exported name as the union; that silently changes what every
   downstream annotation means.
4. `defineSingletonAdmin(definition, config)` is the authoring factory, taking the definition
   first as the spec's example does.

   **Inference, decided: keys stay `string`, validated at startup.** An earlier draft promised
   "a `fields` key that is not a declared field name is a compile error". That is wrong against
   the existing contract: `FormAdminConfig.fields` keys are **dotted schema paths**
   (`files.filesGroup.publicationFile`), not bare field names, and `layout` members may name a
   schema field *or* a locally declared row, group, or tab set. Inferring that correctly means
   recursive path inference plus the locally-declared primitive names — a large type-level
   project with its own failure modes, and out of scope here. Keep the keys `string`, and rely
   on the startup validator, which already resolves these names for collections.
5. `preview` is **retained** for singletons: a settings or navigation singleton affects a real
   public page such as `/`, even though the singleton itself has no public document path.
6. `SingletonAdminConfig.group` references the existing `AdminConfig.collectionGroups` registry
   in this release. Generalise the *types and documentation* toward "dashboard resources" while
   keeping the existing property name compatible — do not rename `collectionGroups`.
7. Startup validation (`validate-admin-configs.ts`) rejects: a singleton admin config whose
   `slug` matches no singleton definition; a singleton admin config carrying a list-only key
   (the runtime counterpart to the `?: never` types, for untyped callers); a multi-collection
   admin config targeting a singleton path and vice versa; and an unknown `group`.

**Artifacts**

- `packages/core/src/@types/admin-types.ts` — the union, `SingletonAdminConfig`,
  `defineSingletonAdmin`
- `packages/core/src/config/validate-admin-configs.ts` + its tests
- `packages/core/src/config/group-collections.ts` — `groupCollectionsForAdmin` currently takes
  `readonly CollectionAdminConfig[]`; widen to the union

**Red/green**

- a singleton admin config with `columns` is a compile error (`@ts-expect-error` directly above
  the offending key) **and** a runtime rejection;
- a singleton admin config whose `slug` names a collection throws, and vice versa;
- a well-formed singleton admin config resolves and its `group` places it in the right bucket;
- a `fields` key naming no declared field or path is rejected **at startup** (not at compile
  time — see item 4), with the same message shape collections already produce;
- a dotted path key (`group.nested`) is accepted, proving the validator was not narrowed;
- collection admin configs are unaffected (regression).

**Gates**

- [ ] `pnpm --filter @byline/core test validate-admin-configs` green
- [ ] `pnpm typecheck` clean — `apps/webapp` compiles with **no** edits to its existing
      `defineAdmin()` calls, proving `CollectionAdminConfig` kept its meaning
- [ ] `pnpm test` green

---

### Task 2: Add the singleton server functions

**Required behaviour**

1. One thin `createServerFn` wrapper per `SingletonHandle` method that the admin needs:
   `get`, `update`, `changeStatus`, `unpublish`, `schedulePublish`,
   `confirmScheduledPublish`, `cancelScheduledPublish`, `getScheduledPublish`, `history`,
   `findByVersion`, `restoreVersion`, `copyToLocale`.
2. Each delegates to the handle obtained from `getAdminBylineClient()`, which **already
   resolves `getAdminRequestContext()` internally** — do not add a redundant explicit call.
   Tests should pin the *authentication behaviour* (an unauthenticated call rejects) rather
   than assert that a particular internal function was invoked.
3. **Thin wrappers are not sufficient on their own.** The collection loaders build an admin
   envelope the editor depends on: lenient reads, `onMissingLocale: 'omit'` behaviour, relation
   population for summary tiles, published-version metadata, restore warnings, scheduling
   capability metadata, `serialise()` across the server-fn boundary, and actor labels for
   history rows. `SingletonHandle` supplies none of that.

   Decide and record, per concern, whether it becomes a **shared host presentation adapter**
   (extracted from the collection loader and reused) or is **composed by the singleton route**.
   Default to extraction: two loaders drifting on published-version metadata or restore
   warnings is a bug class nobody will notice until an editor sees the wrong badge. Whatever is
   not extracted must be listed explicitly in Task 4's loader contract.
4. None of them accepts a `documentId`. The singleton path is the only identifier.
5. Errors propagate with their existing codes. `ERR_NOT_FOUND` from a mutation on an
   unmaterialised slot and `ERR_CONFLICT` from a stale `expectedVersionId` must reach the client
   distinguishably — the form surfaces different messages for "not configured yet" and "someone
   else saved first".

**Artifacts**

- `packages/host-tanstack-start/src/server-fns/singletons/*` — one file per operation, mirroring
  the layout of `server-fns/collections/*`
- `packages/host-tanstack-start/src/server-fns/singletons/index.ts`

**Red/green**

- each wrapper calls the matching handle method with the path it was given;
- a wrapper invoked with no session rejects with the authentication error rather than a generic
  failure (pin the behaviour, not the internal call);
- `update` forwards `expectedVersionId` unchanged;
- no wrapper accepts or forwards a `documentId`.

**Gates**

- [ ] `pnpm --filter @byline/host-tanstack-start test` green
- [ ] `rg "documentId" packages/host-tanstack-start/src/server-fns/singletons` returns nothing
- [ ] `pnpm typecheck` clean

---

### Task 3: Make the dashboard kind-aware

**Prerequisite: establish a jsdom test mode in `@byline/host-tanstack-start`**

This package's `vitest.config.ts` sets `environment: 'node'` and
`include: ['**/*.test.node.ts']` — there is **no** jsdom mode and no React plugin. Every
"component suite green" gate in Tasks 3–5 is a false green until this exists: the files would
not be collected at all, and the run would report a pass having executed nothing.

Mirror `packages/admin/vitest.config.ts`: a mode-switched config (`--mode=jsdom` collecting
`**/*.test.tsx`, `--mode=node` keeping `**/*.test.node.ts`), the `@vitejs/plugin-react` plugin,
`jsdom` and `react-dom` dev dependencies, and a package `test` script that runs **both** modes
(`vitest run --mode=jsdom && vitest run --mode=node`) so CI executes them. Land this as its own
commit before any component test is written.

- [ ] A deliberately failing `*.test.tsx` in this package is collected and reported as a
      failure. Confirm that before writing real tests — a config that silently collects nothing
      is the exact failure this prerequisite exists to prevent.

**Required behaviour**

1. `filterReadableCollections` (`packages/core/src/auth/filter-readable-collections.ts`)
   filters on `collectionAbilityKey(collection.path, 'read')` — hard-coded to the `collections.`
   namespace. A singleton must be filtered on `singletons.<path>.read` instead, via Plan 3
   Task 3's kind-aware key construction. The miss is deterministic, not random: a non-super-admin
   simply never holds `collections.<singleton-path>.read`, so the card disappears for every
   non-super-admin. It does not accidentally match an unrelated ability.
2. Grouping is unchanged in behaviour: singletons appear in `collectionGroups` buckets
   alongside collections, ordered by the existing registry, with ungrouped entries in the
   leading band.
3. A singleton card renders **without** count or workflow-stat tiles. `showStats` does not exist
   on a singleton definition, so this should fall out of the type — verify it rather than
   special-casing.
4. The card links to `getAdminRoutePath('singletons', '<path>')`. The helper takes free-form
   segments joined onto the configured admin base (`routes/admin-path.ts:12`), so **no route
   configuration change is needed** — do not add a `singletons` segment to `RoutesConfig`.
5. An update-only role remains unusable in the admin: no `read` ability means no card and no
   loadable form. This matches the existing collection rule and is deliberate, not a gap.

**Artifacts**

- `packages/core/src/auth/filter-readable-collections.ts` + tests
- `packages/core/src/config/group-collections.ts` — union-aware
- `packages/host-tanstack-start/src/admin-shell/chrome/dashboard.tsx`
- `packages/host-tanstack-start/src/routes/create-admin-dashboard-route.tsx`

**Red/green**

- an actor holding `singletons.site-settings.read` sees the card; one holding only
  `collections.site-settings.read` does **not** (proving the namespaces do not bleed, and that
  a stale key is not silently matching);
- a super-admin sees every resource of both kinds;
- a singleton card renders no stat tiles;
- the card's link resolves to the singleton route under a **custom configured admin base**, not
  just the default — the path helper is configurable and a hard-coded `/admin/...` would pass a
  default-base test and break a customised install;
- grouping places singletons and collections in one bucket in registry order.

**Gates**

- [ ] `pnpm --filter @byline/core test filter-readable-collections` green
- [ ] `pnpm --filter @byline/core test group-collections` green
- [ ] `pnpm test` green
- [ ] `rg "collectionAbilityKey" packages/core/src/auth` shows no remaining hard-coded namespace
      on a path that may be a singleton

---

### Task 4: Add the singleton editor route

**Required behaviour**

1. A route factory `createSingletonRoute(path)` registered by the app at
   `<admin>/singletons/$singleton/`, following the one-line registration pattern of
   `createCollectionEditRoute` (see
   `apps/webapp/src/routes/_byline/admin/collections/$collection/$id/index.tsx`).
2. The loader resolves the mapped document **server-side**. When none exists it renders the
   same form in initial state; the first Save calls the singleton update server fn. There is no
   separate create route and no id in the URL.
3. `SingletonView` composes `FormRenderer` with these props, all of which exist today thanks to
   Plan 1:

   | Prop | Value | Effect |
   |---|---|---|
   | `mode` | `document ? 'edit' : 'create'` | drives upload gating and the create/edit branch |
   | `heading` | the singleton's `label` | suppresses "Create <label>" before materialisation — the slot always existed |
   | `showPath` | `false` | no path widget, regardless of the internal generated path |
   | `onDelete` | omitted | no Delete item |
   | `onDuplicate` | omitted | no Duplicate item |
   | `advertiseLocales` / `tree` | omitted | inert |

   With `onDelete` and `onDuplicate` both omitted, the actions menu hides its trigger entirely
   unless copy-to-locale or a schedule action is available — the behaviour Plan 1 Task 1 added.
   Verify that; do not add a second suppression mechanism.

4. **Pre-materialisation capability table.** "Retained from the collection editor" means
   *after* materialisation. Before the first save there is no document, and offering an
   affordance that cannot work is worse than hiding it:

   | Affordance | Before first save | After |
   |---|---|---|
   | Save / update | **available** — this is the materialising call | available |
   | Locale switcher | **hidden** | available |
   | Preview link | hidden | available when `preview` is configured |
   | History link | hidden | available |
   | Workflow controls | hidden | available |
   | Scheduling | hidden | available |
   | Unpublish | hidden | available |
   | Copy-to-locale | hidden | available |
   | Field components, dirty state, navigation guard | available | available |

   The locale switcher is the load-bearing row: Plan 3 rejects a first save in a non-default
   content locale, so offering a locale switch before materialisation presents the editor with
   a guaranteed failure.

5. **The save contract, exactly:**
   - send the **full document data**, not collection-style patches — patches are admin-internal
     and tied to list/reorder intent that a singleton does not have;
   - send the active content locale;
   - send `expectedVersionId: document?.versionId` — `undefined` on initial materialisation,
     which Plan 3 specifies as valid there and a conflict once materialised;
   - on success, invalidate/reload the route so `mode` flips `create` → `edit` and gated upload
     fields unlock;
   - surface `ERR_CONFLICT` ("someone else saved first") and `ERR_NOT_FOUND` ("not configured
     yet") with **different** messages;
   - the singleton host handler **must rethrow** after its toast, or Plan 1 Task 4's dirty-state
     preservation is inert for this view.

6. Removed: return-to-list state, list breadcrumbs. Cancel/Close navigates to the **dashboard**,
   not a list. `onCancel` is a required prop, so it must be supplied explicitly.

7. **`ViewMenu` cannot be reused unchanged.** `admin-shell/collections/view-menu.tsx` types its
   targets as `'edit' | 'history' | 'api'`, requires `documentId: string`, builds
   `params: { collection, id: documentId }`, and renders an API view. Its preview fallback
   composes a URL from the document's internal path — which for a singleton is generated
   metadata that must never reach a URL. Build a resource-aware menu (or parameterise the
   existing one by capability) providing: id-less edit and history links, **no** API view, and
   **explicit-preview-only** behaviour for singletons — if `adminConfig.preview` is absent, no
   preview affordance, never a path-derived fallback. The singleton preview document type must
   not require `path`.
8. An upload field with `requireSavedDocument: true` stays gated until the first save, exactly
   as on a collection create form. This works because pre-materialisation is `mode: 'create'`
   and the upload executor only passes a `documentId` in edit mode — inherited, not
   re-implemented.
9. Breadcrumbs show the singleton's label under the admin root, with no intermediate list crumb.

**Artifacts**

- `packages/host-tanstack-start/src/routes/create-singleton-route.tsx`
- `packages/host-tanstack-start/src/admin-shell/singletons/view.tsx`
- Breadcrumb wiring in `admin-shell/chrome/`
- Any new i18n keys, added to **every** bundle under `packages/i18n/src/admin/`

**Red/green**

Component tests, following `packages/admin/src/forms/*.test.tsx` conventions (the shared mock
harness, `I18nProvider` with the real English bundle, no `@testing-library`):

- unmaterialised slot renders the form with schema defaults and a heading of the singleton's
  label — **not** "Create <label>";
- no path widget renders even when the loader envelope carries an internal path;
- no Delete and no Duplicate item; with no other actions available, no actions trigger at all;
- first Save calls the singleton update server fn with full data, the active locale, and
  `expectedVersionId: undefined` — not a collection create and not patches;
- a **second** save sends `expectedVersionId` equal to the loaded version id;
- a stale `expectedVersionId` surfaces the conflict message, distinct from the not-configured
  message;
- every "before first save" row of the capability table is absent, and present after — in
  particular the locale switcher;
- a failed save leaves the form dirty and the navigation guard active (inherited from Plan 1
  Task 4 — assert it here too, since this is a different host handler and must also rethrow);
- an upload field with `requireSavedDocument: true` is gated before the first save and
  available after **the loader refresh** — the test must re-run the loader and remount, since
  the same mounted `FormRenderer` stays in `mode: 'create'` and would report a false pass;
- Cancel navigates to the dashboard.

**Gates**

- [ ] Component suite green
- [ ] `pnpm typecheck` clean
- [ ] **Falsification, not grep:** temporarily swallow the submit rejection in the singleton
      view's catch and confirm the dirty-state test **fails**; restore it. A `rg "throw err"`
      gate proves only that the string exists. This is the exact defect Plan 1 Task 4 fixed for
      collections, and a new view is a fresh opportunity to reintroduce it
- [ ] No new i18n key is missing from any locale bundle — boot validator silent

---

### Task 5: Add the singleton history route

**Required behaviour**

1. `createSingletonHistoryRoute(path)` registered at `<admin>/singletons/$singleton/history`,
   resolving the mapped document id internally. No id in the URL.
2. **The surface is `admin-shell/collections/history.tsx`, not `document-history.tsx`.**
   `document-history.tsx` is the document-grain **audit log**; version history is `history.tsx`.
   An earlier draft named the wrong file.

3. `history.tsx` is deeply collection-specific: route params, `columns`, `useAsTitle`,
   `ViewMenu`, diff loading, restore transport, and an embedded audit-log tab. One detail makes
   naive reuse fail outright — **the restore control is injected relative to the `useAsTitle`
   column** (`history.tsx:151-153`), and a singleton has neither `columns` nor `useAsTitle`, so
   it would render **no restore button at all**.

   Extract a **shared version-history core** taking injected navigation, a version loader, a
   restore callback, and a row presentation, then give the singleton its own explicit row
   presentation (version, status, timestamp, actor, restore) that does not depend on
   `useAsTitle` or `columns`.

4. **The audit-log tab is collection-only** in this release. Plan 3 exposes no `auditLog` on
   `SingletonHandle`, so the tab has no data source. Omit it rather than adding an unplanned
   handle method — expanding Plan 3 is a deliberate decision, not a side effect of this task.
5. Restore calls the singleton restore server fn, which fires `beforeSave`/`afterSave` with the
   `{ type: 'restore', sourceVersionId }` discriminator from Plan 3.
6. History is paginated, matching `SingletonHandle.history` returning `FindResult`.
7. History reads require `singletons.<path>.read` — the same ability as the editor, per the
   design's "history reads use `read`" rule.
8. An unmaterialised slot renders an empty history, not an error. `history` returns an empty
   `FindResult` envelope — `{ docs: [], meta: … }` echoing the requested page and pageSize — not
   a bare array.

**Artifacts**

- `packages/host-tanstack-start/src/routes/create-singleton-history-route.tsx`
- Shared/parameterised history + restore-modal components

**Red/green**

- history lists versions for a materialised singleton, paginated;
- an unmaterialised slot renders empty, with no thrown error, and the returned envelope carries
  the requested `page` / `pageSize` in its meta;
- a singleton history row renders a working restore control **without** `useAsTitle` or
  `columns` — the case that fails under naive reuse;
- the audit-log tab is absent for a singleton and present for a collection;
- restore invokes the singleton restore server fn and navigates back to the editor;
- an actor without `singletons.<path>.read` cannot load the route;
- the collection history route still behaves identically (regression — this task touches shared
  components).

**Gates**

- [ ] Component suite green
- [ ] Collection history regression tests pass unchanged
- [ ] `pnpm typecheck` clean

---

### Task 6: Register the routes and ship a worked singleton in the webapp

This is the task that proves the feature end to end, and the first point at which anyone can
actually use it.

**Required behaviour**

1. Two one-line route registrations in `apps/webapp/src/routes/_byline/admin/singletons/`,
   matching the existing collection pattern. Then **regenerate `routeTree.gen.ts` through the
   TanStack generator / a build** — never hand-edit it.
2. **Package plumbing:** add the singleton server-function subpath to
   `packages/host-tanstack-start/package.json` `exports`, and export both route factories from
   `src/routes/index.ts`. Without these the app cannot import them, and `pnpm knip` flags the
   new modules as unreachable.
3. A worked singleton in `apps/webapp/byline/` exercising the shape a real site needs: a
   required text field, a localized `textArea` with length validation, and direct image uploads
   for the default social image and site icon. The default social image is deliberately owned by
   the singleton rather than related through `media`. Registered in the existing `collections`
   tuple and the existing `admin` tuple — **not** new registries.
4. Its admin config uses `tabSets` + `layout` and a `preview` returning `/`.
5. Generated types regenerate to include it, so `SingletonPath` is no longer `never` in the
   webapp and the exactness contract covers a real singleton.
6. **Workflow, decided:** the example uses `SINGLE_STATUS_WORKFLOW` — it is operational site
   configuration with no editorial lifecycle, saves land published immediately, and workflow
   controls hide themselves. Any integration test asserting a *published* read therefore needs
   no explicit publish step. If a later example keeps the default workflow instead, it must
   publish explicitly before asserting a published read.
7. **Seeding:** seed through the system `SingletonHandle`, and **only when the slot is empty**.
   Re-running the seed must neither overwrite an editor's changes nor mint a pointless version —
   both are easy to cause and annoying to diagnose in a dev database.

**Do not** name a real downstream site, organisation, or domain in the example. Describe the
pattern generically — this repository is public.

**Red/green**

- Before regenerating types after adding the worked singleton, run the webapp typecheck and
  confirm that exactly the four singleton exactness assertions in
  `apps/webapp/byline/collection-types.contract.ts` fail while the four collection assertions
  remain green. Then regenerate and confirm the full contract passes. This proves the app-level
  contract is non-vacuous once the first real singleton exists and that the inferred collection
  registry still excludes it.
- `pnpm byline:generate:check` passes with the singleton present;
- the webapp's exactness contract compiles with a non-empty `SingletonFieldsByPath`;
- an integration test saves the singleton through `@byline/client` and reads it back published.

**Manual verification** (cannot run in CI, and is the point of the task):

- [ ] `pnpm dev`, sign in, and confirm the singleton card appears in its dashboard group with no
      stat tiles — and assert in a test that the dashboard loader **never calls collection stats
      for a singleton**. "No tiles rendered" passes even when a pointless per-singleton stats
      round-trip is still being made on every dashboard load
- [ ] Open it before any save: heading reads the label, no path widget, no actions trigger,
      upload field gated
- [ ] Save; confirm it materialises and the heading is unchanged, then upload a file and confirm
      the unlocked field stores it successfully through the singleton transport
- [ ] Save again; confirm a second version appears in history, and that the document count in
      the database is still exactly one
- [ ] Edit a field, force a server error, and confirm the form stays dirty and blocks navigation
- [ ] Restore an earlier version from the history route
- [ ] Sign in as a role without `singletons.<path>.read` and confirm the card is absent and the
      route is not loadable

**Gates**

- [ ] `pnpm byline:generate:check` passes
- [ ] `routeTree.gen.ts` regenerated by the generator, not by hand — its diff contains only
      generator output
- [ ] `pnpm knip` clean — the new subpath export and route-factory exports are reachable
- [ ] `pnpm test && pnpm test:integration` green
- [ ] Every manual verification item above confirmed
- [ ] No client name, domain, or organisation appears in the example

---

## Out of scope for this plan

- Documentation and the Payload migration example (Plan 5).
- An embedded `type: 'tree'` field for atomic menu editing.
- Singleton search indexing, `reindex`, or list-style bulk actions — none exist for a singleton.
- Making a singleton a relation target.
- Any change to `RoutesConfig`: `getAdminRoutePath` takes free-form segments, so the singleton
  routes need no new configuration surface.

## Final verification

- [ ] `pnpm lint` — inspect the diff; revert unrelated reformatting
- [ ] `git diff --check` clean
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green
- [ ] `pnpm test:integration` green
- [ ] `pnpm byline:generate:check` passes
- [ ] `pnpm knip` and `pnpm knip:exports` clean — this plan adds route factories, server fns,
      and a view module, all new exports
- [ ] Every commit carries a DCO `Signed-off-by` trailer and no others:
      `git log --format='%H %(trailers)' origin/develop..HEAD`
