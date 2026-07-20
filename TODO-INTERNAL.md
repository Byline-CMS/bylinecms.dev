---
title: "TODO — priority index"
path: "todo"
summary: "Single landing page for 'what's next?'. An index of authoritative phase sections across the docs — priority lives here, detail lives in the linked doc."
---

# TODO — priority index

Single landing page for "what's the next thing to work on?". This is an **index**, not a spec — each entry points to the authoritative phase section in the relevant doc. Detail lives there; priority lives here.

## How to read this

- **Now** — clear next-up work; intent committed, just hasn't landed yet.
- **Next** — known and queued; will surface in the coming PRs once Now items clear.
- **Deferred** — waiting for an explicit trigger (a second consumer, a named pre-condition, a real product ask). Each entry names the trigger.

Items are pruned as they ship. Trigger-conditional items stay until the trigger fires. If the spec for an item lives in a doc whose phase numbering shifts, the link is updated; the entry stays in place.

---

## Now

### Attachment text-extraction pipeline (search Phase 3)

Promoted now that the search query surface is complete: zone (cross-collection) query + `hydrate` shipped 2026-07-07 (`client.search({ zone })` — heterogeneous ranked hits, per-collection ability filtering + `beforeRead` row scoping, `hydrate` batch-reads into shaped `ClientDocument`s and drops stale index entries; see [07-search.md → Zone search](./docs/05-reading-and-delivery/07-search.md#zone-cross-collection-search-clientsearch-zone)). This is the next piece of the RAG/retrieval track: an extraction-provider interface — `file → { markdown, plainText, metadata }` — so structure-aware, markdown-emitting extractors (Docling-class) and classic extractors (Apache Tika) are interchangeable drivers. Extracted output lands in its own table keyed to the file (never as synthetic `store_*` field data), invalidated on re-upload, joined into the searchable `body`. Markdown-first output deliberately converges with the markdown-export surface, so documents and attachments share one representation for indexing, chunking, and agents. Full landscape + tiered strategy: [search extraction strategy](./docs/05-reading-and-delivery/08-search-extraction-strategy.md).

---

## Next

### Search — remaining phases (where/facets, exact paging under scoping)

Phase 2 **shipped**: the `SearchProvider` seam, the `@byline/search-postgres` FTS driver, `ServerConfig.search` registration/validation, lifecycle-hook indexing + `reindex` (ability-gated, admin button), `client.collection(x).search()` with the docs frontend as the worked example, row-level authorization, and the cross-collection `client.search({ zone })` + `hydrate` (all 2026-07-07). Present-state reference: [docs/05-reading-and-delivery/07-search.md](./docs/05-reading-and-delivery/07-search.md). Attachment extraction (Phase 3) is promoted to **Now** (above).

Remaining, specified in [07-search.md → Planned (not yet shipped)](./docs/05-reading-and-delivery/07-search.md#planned-not-yet-shipped):

1. **Structured `where` filtering + facet aggregation** — options accepted in the API; the Postgres driver doesn't yet apply them (`capabilities.facets === false`).
2. **Exact paging under row scoping** — core-side re-auth filters after ranking, so `total` / offset paging are approximate on scoped collections; the exact alternative pushes the `QueryPredicate` down into the provider (driver capability, needs indexed scoping columns).

Then external drivers (the RAG/vector/hybrid payoff; home for the private BM25 work), then the MCP `search` tool.

### Bulk "refresh embedded relations" admin command

For richtext fields in snapshot mode (`embedRelationsOnSave: true, populateRelationsOnRead: false`), embedded data drifts when targets change. A bulk command would walk every richtext value in a chosen collection (or installation-wide), re-resolve each relation, and re-embed the cached fields in place — without bumping `documentVersions`. Useful when staleness compounds (e.g. a bulk title rename) and per-document re-saves aren't practical. See [RELATIONSHIPS.md → Phase — bulk refresh denormalised links](./docs/04-collections/03-relationships.md#phase--bulk-refresh-denormalised-links-command).

### Cascade-delete acted on

The `cascade_delete` flag round-trips today but isn't enforced. Future write-path pass walks relations to deleted targets and applies the policy: `true` → hard-delete the referencing rows; `false` → leave in place (`_resolved: false` on read); `'restrict'` → refuse the delete with `ERR_REFERENTIAL_INTEGRITY`. Shares design surface with the integrity-scanning track. See [RELATIONSHIPS.md → Phase — cascade-delete acted on](./docs/04-collections/03-relationships.md#phase--cascade-delete-acted-on).

### Cross-document link integrity job

Periodic admin command that scans richtext fields and `store_relation` rows for links to deleted or unresolvable targets, then surfaces them in a "broken links" admin view. Reuses populate's missing-target detection (`_resolved: false`) but materialises the result as a triage list. See [RELATIONSHIPS.md → Phase — cross-document link integrity job](./docs/04-collections/03-relationships.md#phase--cross-document-link-integrity-job).

### Historical config snapshots — `collection_versions` history table

COLLECTIONS versioning Phase 2 — the smallest useful follow-up to the schema-version recording that already ships. One row per version-bump carrying the snapshot of `CollectionDefinition` at that version. Unblocks Phase 3 (fetch-by-version) and is the prerequisite for any future read-time forward-migration work. See [COLLECTIONS.md → Phase 2 — historical config snapshots](./docs/04-collections/index.md#phase-2--historical-config-snapshots).

### Native MCP server

Sequenced after the markdown / `llms.txt` surface and the search-provider seam: the agent-readable representation and the retrieval layer land first, then the protocol surface that exposes them. See [MCP.md](./docs/05-reading-and-delivery/05-mcp-server.md).

### Admin client-config registration — single-point resolution

The Byline client config (`defineClientConfig`) is registered from **two** points on the `_byline` route — `route.tsx` `beforeLoad` (loader phase) and `route.lazy.tsx`'s side-effect import (component render / hydration) — because neither alone covers both lifecycle moments. It works and is correct; collapsing to a **single eager point** only works if `admin.config`'s static graph is light enough not to bloat public-route bundles.

**Groundwork shipped (richtext side):** the `@byline/richtext-lexical/config` subpath + lazy `AiLexicalExtension` mean referencing the **editor runtime** no longer pulls it. **The blocker is now the admin side, not richtext:** collection admin configs hold live references to presentation slots (`DateTimeFormatter`, `MediaListView`, …) from `@byline/admin/react` — a deliberately indivisible single-Context-identity barrel — so eager registration would drag the whole admin document-editor surface into public bundles.

The eager single point **is** possible without breaking slot components' context access (defer *when* slot code loads, not *where* it renders), but the cost/benefit is poor today (reworks the slot authoring API + adds Suspense plumbing to remove two correct import statements). **Deferred until a concrete driver makes eager-light config necessary.** Full root-cause analysis, the three viable mechanisms, and the "is it even possible given slot components need context?" answer live in **[CLIENT-CONFIG-REGISTRATION.md](./docs/08-admin-ui/02-client-config-registration.md)**.

### Admin route splat handler — host-owned admin route resolution

Today every admin route is an **app-owned physical file** calling a `create*Route` factory from `@byline/host-tanstack-start/routes` (`src/routes/_byline/admin/<area>/index.tsx`). The package ships the route factory **and** the sidebar menu item, but not the route file — so adding a new admin area means the package renders a menu item that 404s in every consumer until each app hand-adds the matching route file. The v3.11.0 system activity area hit exactly this: the **Activity** menu item appeared on the downstream production sites while `/admin/activity` 404'd, and the CLI scaffold needed a follow-up (v3.11.2) to wire it for fresh installs. Each new admin area repeats the friction.

The strategy: a **single app-owned splat/catch-all route** under the admin layout (e.g. `_byline/admin/$.tsx`) that forwards all path segments to a host-package resolver. The host package then owns **both** the menu items and the routing — a new admin area is a package-only change, zero app wiring, no per-consumer route file, no scaffold drift. This also subsumes the floated `byline doctor` "menu-item-without-registered-route" check (the gap can't exist).

Design surface to work through: the per-route factories currently set `validateSearch` + `loader` per route, so a splat needs a **dispatch registry** keyed by the leading segment(s) that supplies each area's loader / search schema / component (the host already centralises these as factories — they'd become registry entries instead of file exports).

**The typing cost is already paid — this is the key reason the change is cheaper than it first looks.** The factories do not benefit from file-based route-tree codegen today: every one is `const Route: any = createFileRoute(path as never)(...)` with `Route.useLoaderData()` / `useParams()` / `useSearch()` hand-cast via `as`, `validateSearch` written as a manual Zod schema (not codegen-derived), and navigation routed through `admin-shell/chrome/loose-router.ts`, which deliberately collapses `Link` / `useNavigate` to `any` because "the package has no view of the host's generated route tree at type-check time." So a splat surrenders no typing that exists today; the per-area Zod schema + cast pattern moves verbatim from file exports into registry entries.

Real design wrinkles (all solvable, none about typing):

- **`validateSearch` selection.** A file route defines one `validateSearch`, and TanStack calls it with only the raw search record — no params — so a single splat can't pick the per-area schema at validate time. Validate leniently at the splat and narrow inside the dispatched loader/component, or apply the registry's per-area schema post-dispatch. This is the one spot a splat is genuinely less clean than per-file.
- **Preserve code-splitting.** Each route file is its own chunk today; a registry that statically imports every area's component would eagerly bundle the whole admin graph into public surface. Keep registry entries lazy — `() => import(...)` for components, and have the splat `loader` dynamic-`import()` the matching area's loader by leading segment (works server-side for SSR). This is the one piece of actual engineering.
- **Layout stays a real file.** Keep `admin/route.tsx` (`createAdminLayoutRoute` — `beforeLoad` auth + providers + `<Outlet/>`) as an actual file route; it's the auth boundary. The splat `$.tsx` is its child and renders the dispatched component into the Outlet. End state: **3 app files** (layout + splat + sign-in) instead of ~14, and the `/admin` → custom-slug rewrite applies to one file instead of the tree.
- **404 becomes a feature.** The splat matches everything under `/admin`; the resolver maps leading segment → component and throws `notFound()` for unknown areas. Because the resolver (package code) owns both the menu and the dispatch, the "menu ships, route 404s" class is structurally impossible — subsuming the floated `byline doctor` check.

Scope guard for whoever picks this up: keep it to dispatch mechanics. The factory bodies (loaders, Zod schemas, components) move almost verbatim into registry entries — resist redesigning them in the same pass.

Cost framing today is a 4-place tax per new admin area: package factory + webapp route file + each downstream consumer (bylinecms.app, modulus-learning.org) + CLI scaffold template. The splat collapses that to a one-package change. **Land it the next time an admin area is added** — you'd pay the 4-place tax anyway, so fold the refactor into that work rather than doing it speculatively. Low urgency on its own, but it permanently closes the "menu ships, route 404s on upgrade" class. (Idea raised 2026-06-13 during the activity-area rollout; reviewed and de-risked 2026-06-14.)

---

### Lazy admin-locale loading — async bundle map past the ~5-locale threshold

`@byline/i18n/admin` ships every bundled locale via static `import enJson from './en.json'` statements, so the bundler inlines a fixed-size set and **all** of them land in the initial admin JS payload. The design always named ~5 locales as the point where lazy loading earns its complexity (see [I18N.md → Bundling and code-splitting](./docs/07-internationalization/02-admin-translations.md#bundling-and-code-splitting) and the `Remaining work` bullet). **That threshold is now crossed:** as of 2026-06-14 the admin ships **7** interface locales (`en`, `fr`, `es`, `de`, `it`, `zh-CN`, `ko`) — so this is no longer hypothetical, it's a live (if low-severity) payload-weight item.

Severity is genuinely low today: the `byline-admin` bundle is ~5 kB gzipped per locale (flat key→string JSON), so 7 locales is roughly ~35 kB of admin-only JS — real but small, and it never touches the public bundle (the admin graph is already code-split out via the `_byline` lazy route). The cost grows linearly: every locale added, and every plugin/custom-field/extension namespace that fans out across those locales (e.g. the `webapp-media-admin` bundle), adds its slice to the eager payload.

The strategy: replace the eager static-import `BUNDLES` map with async loaders (`() => import('./<code>.json')`) resolved per active locale, so only the locale(s) actually in use are fetched. Design surface to work through: (1) the locale is resolved server-side in `beforeLoad` (host adapter, for no-flicker SSR) **and** read on the client — the async load has to satisfy both without a hydration flash; (2) the `adminTranslations({ locales })` factory is currently synchronous and returns a fully-materialised `TranslationBundle` — going async changes its contract and the `mergeTranslations(...)` composition in `byline/i18n.ts`, which also has to thread through every contributed namespace (the same fan-out the media bundle demonstrates); (3) the boot validator (`initBylineCore()`) currently fails fast on a missing bundle by reading the eager map — under lazy loading it can only validate the *requested* locale(s) eagerly, or move to a manifest of available codes. Trigger to actually do it: the admin payload weight shows up in a real measurement, or locale count keeps climbing. (Threshold crossed 2026-06-14 during the ES/DE/IT/zh-CN/ko rollout.)

### Persisted list-view preferences — remember page size / sort across sessions

The collections standard list view (`packages/host-tanstack-start/src/admin-shell/collections/list.tsx`) holds all of its view state — `page`, `page_size`, `order`, `desc`, `query`, `locale`, `status` — in the URL search params (validated + threaded by `create-collection-list-route.tsx`). That's correct for shareable/bookmarkable state, but it means preferences reset to the route defaults every time a user lands on a collection fresh (a new tab, a bookmark without params, following an admin-menu link). A user who always wants 50 rows per page, or a preferred default column sort, re-sets it on every visit.

The ask: persist the *sticky* per-user view preferences — at minimum `page_size` and the default column sort (`order` / `desc`) — so they survive across sessions and carry to a params-less landing. Same idea applies to the admin-users list and any future list surface.

Design surface to work through: (1) **scope** — preferences are almost certainly per-collection (a docs list and a media list want different sort columns / page sizes), so the store key needs the collection path; (2) **storage** — `localStorage` is the low-friction option (client-only, no schema/migration), but it doesn't survive to SSR, so the *first* server render still uses route defaults and the client rehydrates the preference on mount (a visible re-sort/re-page unless handled) — the server-persisted alternative is a `preferred_locale`-style column/JSON blob on `byline_admin_users` (like the i18n cascade already does), which is heavier but flicker-free and cross-device; (3) **precedence** — an explicit URL param must always win over the stored preference (a shared link opens exactly as sent), so the stored value only seeds a params-less landing, it never overrides present params; (4) **which keys are sticky** — `page` and `query` are almost certainly *not* sticky (you don't want to land on page 7 of a stale search), so this is a deliberate subset, not "persist the whole search record." Start with `localStorage` + `page_size`/sort as the minimum useful slice; graduate to the server-persisted store if cross-device or no-flicker becomes a real ask. (Raised 2026-07-14.)

**Shipped groundwork (2026-07-14):** the *collection-configured* layer landed — `CollectionAdminConfig.defaultSort: { field, direction }` (boot-validated; rejected on `orderable` collections), applied by the list server fn when no explicit `order` param is present and echoed through `meta.order`/`meta.desc` so the header sort indicator shows the effective sort on a params-less landing. The per-user preference described above slots between the URL params and that configured default: URL → user preference → `defaultSort` → `created_at desc`.

**Two mechanisms, not one (raised 2026-07-19).** The ask has since widened to include filter options and "return to the page I was on after editing and closing a document". Those are not the same feature as sticky preferences, and conflating them produces the wrong behaviour in both:

- **Preferences** are durable and cross-visit: `page_size`, default sort, and now arguably the filter set (`status`, `locale`). A user who always works in French drafts wants that on every landing. These are what the entry above describes.
- **Return-to state** is a single round trip: open a document from page 7 of a filtered list, save, close, land back on page 7 of that same list. This is navigation state belonging to one journey, not a preference. Persisting `page` as a preference is the wrong shape — it strands a user on page 7 of a list they have since re-filtered, which is exactly why the entry above excludes it.

The return-to half is probably the cheaper and more valuable of the two, and it does not need any storage mechanism: the list route already holds complete state in its search params, so the editor can carry a return target (a `from` param, or router history state) and the close/save action can navigate back to it. Precedence stays as stated above — an explicit URL param always wins — and a return target is just an explicit param, so the two compose without conflict.

Worth settling which of the two is actually wanted before building either. If the ask is "stop re-setting my page size", that is the preference store. If it is "closing a document dumps me back at page 1", that is the return target, and no persistence is involved.

---

## Deferred

Each entry names the trigger that would move it into Next. No work happens until the trigger fires.

### Upload `Content-Disposition` — original filenames on download

With friendly storage keys shipped (4.2: `<location|collection>/<slug>-<suffix>.<ext>`), the remaining download-UX gap is cosmetic: the saved filename carries the slug + suffix, not the pretty original (`Meeting Agenda 2026.pdf`, Unicode/Thai names). `Content-Disposition` closes it: S3 accepts it as per-object metadata at `PutObject` time (we already persist `originalFilename` in `StoredFileValue`, and the S3 provider already sets analogous per-upload metadata — roughly one RFC 5987 `filename*` encoding plus one parameter), and presigned URLs can set it dynamically via `response-content-disposition` with zero stored state.

**Trigger:** two design questions need owners before shipping. (1) **Local-provider symmetry** — local storage doesn't serve HTTP; the host's runtime handler would need the original filename at request time, meaning either a `store_file` lookup per static-file request or sidecar metadata written next to the file. Shipping S3-only would make provider behavior visibly divergent. (2) **The `inline` vs `attachment` policy** — images want `inline`, `.docx` wants `attachment`, PDFs are debatable; likely a small per-field or per-MIME policy on `UploadConfig`. Move to Next when a real download-affordance ask arrives (or the FORRU beta wants original Thai filenames on library downloads).

### Uploads — transactional staging, committed with the document write

Today an upload and the document write that references it are two independent operations. The admin defers pending uploads and executes them on save (`executeUploads`, `packages/admin/src/forms/upload-executor.ts`), each one storing its file through the provider and returning a `StoredFileValue` that is then written into the document. If the document write fails after that point — validation, a hook throwing, a lost connection — the file is already stored and nothing references it. The reverse also holds: a partially successful multi-file save leaves some files stored and some not, with no record of which.

The proposal is to make the upload two-phase. Files land in a temporary staging area first, optionally alongside a sidecar carrying the metadata and placement instructions, and are promoted to their final storage keys only as part of committing the document create or update. A failed document write discards the staging area instead of leaving orphans.

Design surface to work through: (1) **storage providers are not transactional** — neither the local filesystem nor S3 can enrol in the Postgres transaction, so this is a two-phase commit with compensating actions, and the honest goal is a narrow failure window plus a sweeper for what escapes it, not true atomicity; (2) **where the boundary sits** — promotion has to happen inside the same `document-lifecycle` create/update call that opens the transaction, which means the lifecycle service gains knowledge of staged files it does not have today; (3) **staging lifetime and cleanup** — abandoned staging entries need a TTL and a sweep, which is the same machinery the cleanup entry below wants; (4) **friendly storage keys** (4.2) are derived at store time from the collection and slug, so promotion is a rename/copy into the final key rather than a no-op move, and on S3 a copy plus delete.

**Trigger:** orphaned files from failed saves become operationally visible — storage growth, a reconciliation script, or a support case where a file exists but no document references it. Until then the single-phase path is simpler and the failure is rare and non-corrupting. Shares a sweeper with the cleanup entry below; do them together if either is picked up.

### Uploads — deletion and cleanup across versioned history

Collection-owned `file` and `image` fields never delete stored media. Removing the field value, removing the block or array item that contains it, or deleting the document itself all leave the stored file in place. Storage grows monotonically, and there is currently no way to satisfy a deletion request for a specific asset.

The reason this is not a simple "delete on removal" is immutable versioning. A `store_file` row belongs to one document version. Removing a file in the current version does not remove it from the versions before it, so deleting the stored object on removal would retroactively break history — an older version would still reference an object that no longer exists, and restoring that version would produce a broken document. Any strategy has to answer what file deletion means when history is meant to be immutable.

Options, roughly in increasing order of cost: (1) **never delete**, and treat storage as append-only — honest, cheapest, and what happens today by accident rather than by decision; (2) **reference-count across versions** and delete only when the last referencing version is itself pruned, which requires a version-pruning story that does not exist yet; (3) **soft-delete plus a garbage-collection sweep** that marks candidates and deletes after a retention window, keeping restore possible inside that window; (4) **hard-delete on request** as an explicit destructive admin action that accepts breaking older versions, needed for takedown and erasure requests regardless of which of the above is chosen.

Related surfaces: `upload.location` scoping (4.2) determines what a per-collection or per-location sweep can address; the transactional staging entry above needs the same sweeper for abandoned staging entries; and this shares its shape with [Cascade-delete acted on](#cascade-delete-acted-on), which asks the same question for relation targets.

**Trigger:** storage cost or growth becomes visible, or a deletion request arrives that must be honoured (takedown, erasure). Option (4) alone may be enough to satisfy the second without committing to a full lifecycle.

### Build-time `server-only` poison for collection hooks

**Shipped (the isolation half):** `@byline/core` now accepts a first-class lazy-loader form of `hooks` — `hooks: () => import('./x.hooks')`, resolved once and memoized via `resolveHooks` across every lifecycle and read site. Because the schema reaches the hooks only through `import()`, the hooks module's server-only graph is structurally absent from the client bundle. See [COLLECTIONS.md → Hooks must not statically import server-only code](./docs/04-collections/index.md#hooks-must-not-statically-import-server-only-code).

**Trigger (the guardrail half, still deferred):** someone bypasses the loader (static-imports a `*.hooks` module into a schema) and ships dead weight or a runtime throw without noticing. Add a `@byline/core/server-only` subpath — the React/Next pattern: a browser-conditional export that fails the build — that authors `import` at the top of a `*.hooks` file, so a hooks module pulled into the client build fails loudly instead of silently. Verify-first: confirm the webapp's **Vite client build** actually honors the poisoned export condition before promising it (if it silently resolves, the guard doesn't guard). Lives in `@byline/core` (`bylinecms.dev`), not this app.

### Stable HTTP API transport

**Trigger:** first non-admin client arrives (mobile, desktop, third-party). Today every read/write goes through TanStack Start server fns inside the admin webapp; no stable HTTP shape is published. Designed across the full surface area at that point, not just one verb. See [ROUTING-API.md](./docs/05-reading-and-delivery/02-routing-and-api.md) and the deferral note in `CLAUDE.md`.

### `search.body` — address a specific nested field

**Shipped (what works today):** `search.{body,facets,filters}` name **top-level** fields. Nested content is still indexed — naming a container (`group` / `array` / `blocks`) in `search.body` walks it recursively and flattens every nested `richText` / `text` / `textArea` leaf into one body string. So for a publications-style schema, `body: ['files']` does index `files[].filesGroup.caption`, and `body: ['content']` does index a photo block's caption. Boot validation (2026-07-19) rejects a dotted path with a message pointing the author at the container, rather than the previous silent no-op.

**What is missing.** Container naming is all-or-nothing, which leaves three things unexpressible:

1. **Exclusion** — `body: ['files']` also indexes an `internalNote` sibling; there is no way to take the caption without the note.
2. **Block-type selectivity** — `body: ['content']` indexes captions from *every* block variant. "Photo captions but not video captions" cannot be said at all, and no amount of container naming approximates it.
3. **Differentiated weighting** — everything inside a container inherits that container's single `boost`. Captions cannot be weighted differently from the prose around them.

(2) and (3) are the real gaps; (1) is mostly cosmetic since extra text costs recall, not correctness.

**What it would take.** The resolution half already exists: `resolveDeclarationPath` (`packages/core/src/paths/`) resolves `files.filesGroup.caption` and `content.photoBlock.caption` today, including reclassifying `photoBlock` as a block-type segment. What is new is *value* collection — walk schema and data together, fanning out at each array (collect from every item) and at each blocks field (collect only from items whose `_type` matches the block-type segment), then flatten the terminal leaves. Same shape as the schema-plus-data walk in `admin/forms/upload-executor.ts`, but collecting many values rather than resolving one. Roughly 70–90 lines plus tests; the block-type filter falls out of the grammar rather than needing invention.

**Design question to settle first.** How a nested entry with its own boost coexists with a broader container entry covering the same text — `body: ['content', { field: 'content.photoBlock.caption', boost: 3 }]` would index that caption twice at two weights. Either define the narrower entry as overriding the broader one for its subtree, or reject the overlap at boot. Worth deciding before writing the collector, since it shapes the API.

**Trigger:** search quality actually needs per-field weighting or exclusion inside a container — most likely when tuning relevance on a corpus where captions or block prose are drowning out titles/abstracts. Until then, naming the container indexes the right content at a single weight, which is sufficient. Note that the boot validation makes demand visible: anyone reaching for the dotted form now gets an error, so this will resurface as a question rather than as silent under-indexing.

### Field path grammar — remaining follow-ons

**Shipped:** `packages/core/src/paths/` is the single implementation of both field-path notations, and every config-time producer and consumer routes through it (see [Path Grammar](./docs/03-architecture/04-path-grammar.md)). Two follow-ons were identified and deliberately left.

**Trigger (relax upload leaf-name uniqueness):** ships with the stable HTTP API transport above, not before. `attach-hooks.ts` rejects duplicate upload-capable leaf names within a collection because the *server* selects the target field by leaf name (`resolveUploadField` in `host-tanstack-start/src/server-fns/collections/upload.ts` matches `f.name === requested`). The grammar now makes the alternative straightforward — the client computes the block-qualified declaration path (it can read `_type` from form state) and the server resolves it with `resolveDeclarationPath` — but that changes what the upload request carries, and the transport boundary should be designed across the whole surface at once rather than around one field.

**Trigger (paired resolution / index trail):** a second consumer asks for it. FORRU's extraction config uses a wildcard notation of its own (`files[].filesGroup.publicationFile`) with a hand-rolled walker that fans out across array items and resolves sibling paths against the *same* item. The `[]` marker is redundant against a schema-aware resolver — the schema already knows `files` is an array — so that half is obsoleted by this work. The paired-resolution semantic is a genuine gap with exactly one consumer today, which is too thin a basis for a public API.

### Block-qualified runtime paths — implemented and rejected

**Status: not a pending item.** Recorded so the design is not proposed a second time. [Path Grammar](./docs/03-architecture/04-path-grammar.md) is authoritative for what Byline does today.

Form and patch paths carry no block type; persisted storage paths do, because a value row has no `_type` column while an in-memory item does. Carrying the block type through the runtime notations as well was implemented in full on 2026-07-19, to give one visually consistent notation across logs, patch payloads and storage rows. It was abandoned rather than merged.

**Why.** The added segment addresses nothing in the data — block items are stored flat, `{ _id, _type, ...fields }` — so every consumer had to recognise it and skip it. Three did: the patch walkers, the admin form store, and upload resolution. Three defects followed:

1. A reorder combined with a heterogeneous block wrote a phantom object into a stale item.
2. The block type was carried but never enforced, so a mismatched segment silently edited the real field. The cost of an assertion was paid without gaining the integrity of one.
3. `UploadConfig.context` regressed. `resolveContextPath` counts every dotted segment as one scope level, so `../` stopped inside the block instead of reaching the document root. Confirmed by direct test — a public API regression.

The general lesson is the third: each non-navigating segment creates another place that must know to erase it, and nothing enforces that obligation. Two of the three consumers were missed on the first implementation pass and the third was found only in review. The cost kept growing while the value stayed fixed at visual consistency alone.

Both real benefits — resolving the exact block declaration, and resolving an upload without form data — are obtainable from a schema-and-data-aware resolver that reads `_type`, with no change to any payload.

**Trigger to revisit:** a genuinely cold consumer, meaning a persisted operation log, peer synchronisation, or collaborative editing, where a path is read without the document in hand. At that point the block type becomes load-bearing rather than decorative, and should be a validated assertion that is rejected on mismatch, parsed centrally, and explicitly ignored by relative-scope arithmetic — not a pseudo-navigation segment that every data walker strips. The regression in (3) is now pinned by a test (`packages/admin/src/forms/upload-executor.test.node.ts`, "climbs out of the block to the document root").

### Per-locale paths (translated slugs)

**Trigger:** a real consumer needs translated slugs as a CMS concern (not just locale-prefixed routing in the frontend). The structural answer is on file: a new `document_paths` table keyed by `(collection_id, locale, path)`, not extending the existing column or pushing `path` into the EAV. See [DOCUMENT-PATHS.md → Phase — per-locale paths](./docs/04-collections/05-document-paths.md#phase--per-locale-paths-the-larger-one).

### Per-collection slugifier override

**Trigger:** a real need (e.g. media collection that wants to preserve filename extensions). The plumbing point is well-defined: `useAsPath: { source, formatter }` taking precedence over `ServerConfig.slugifier`. See [DOCUMENT-PATHS.md → Phase — per-collection slugifier override](./docs/04-collections/05-document-paths.md#phase--per-collection-slugifier-override).

### Editor lifecycle hooks for richtext (Phase 3b)

**Trigger:** a second editor implementation arrives (`@byline/richtext-tiptap`, `@byline/richtext-md`) **and** it can't achieve correct round-trip behaviour through the existing `FieldHooks` and collection hooks alone. Adapter-level `beforeChange` / `afterChange` / `beforeRead` / `serialize` / `deserialize` is genuinely editor-specific and best designed against two concrete shapes rather than one. See [RICHTEXT.md → Phase 3b](./docs/04-collections/07-rich-text.md#phase-3b--user-land-editor-lifecycle-hooks-deferred).

### Feature-graph configuration for richtext (Phase 4)

**Trigger:** at least two editor packages have a *compatible* feature surface that cannot be expressed as plain editor-specific props. Until then, `RichTextField.editorConfig: unknown` plus per-package config types is the right shape. See [RICHTEXT.md → Phase 4](./docs/04-collections/07-rich-text.md#phase-4--feature-graph-configuration-only-if-phase-23-demand-it).

### Editor-side server pipeline — search / excerpt / plain text (richtext Phase 5)

**Trigger:** the search / indexing story takes shape. Independent of the adapter contract; could ship at any point but slots most naturally next to a search consumer. See [RICHTEXT.md → Phase 5](./docs/04-collections/07-rich-text.md#phase-5--editor-side-server-pipeline-search-excerpt-plain-text).

### Per-collection / per-field editor selection (richtext Phase 6)

**Trigger:** a real product ask for editor variance per collection or per field (e.g. markdown editor in a docs collection alongside Lexical in a marketing collection). Mechanically easy; the product question is the harder half. Note: the *component*-level halves of this shipped in 4.2 — per-field `FieldAdminConfig.editor` at the collection level and per-block-field via `defineBlockAdmin` ([BLOCKS.md](./docs/04-collections/02-blocks.md)); what remains is schema-side *adapter* selection (a different editor package per collection/field, with per-adapter value shapes). See [RICHTEXT.md → Phase 6](./docs/04-collections/07-rich-text.md#phase-6--per-collection--per-field-editor-selection).

### Collection-versioning Phases 3–5

**Trigger:** something needs to render an old document against its original schema, or CI needs strict version pinning. Phase 3 (fetch by version) is the smallest read-side piece that unblocks anything interesting; Phase 4 (in-memory forward-migration) is the load-bearing one; Phase 5 (`strictCollectionVersions: true`) is a CI ergonomics flag. Each is independently shippable once Phase 2 lands. See [COLLECTIONS.md → Future phases](./docs/04-collections/index.md#future-phases-versioning-phases-25).

### CORE-COMPOSITION Phases 2–5

**Trigger:** the per-line repetition cost in admin commands becomes the bottleneck (Phase 1 — the `createCommand` wrapper — has shipped). Phase 2 = module-level registry factories. Phase 3 = compose registries in `initBylineCore()` + expose a command tree on `BylineCore`. Phase 4 = typed request-context builders per actor realm. Phase 5 = `loadConfig()` single env-parsing boundary. Phases 4 and 5 are independent of 2/3. See [CORE-COMPOSITION.md → Future phases of work](./docs/03-architecture/02-core-composition.md#future-phases-of-work).

### `UserAuth` (end-user authentication) and adjacent deferred surfaces

Distinct from the shipped admin-auth subsystem (`AdminAuth`, `JwtSessionProvider`, admin user/role/permission management, document-collection and admin-management ability enforcement, `beforeRead` row-scoping). The pieces below are reserved in the contract — `Actor = AdminAuth | UserAuth | null`, the `SessionProvider` interface — but the implementations wait.

**Trigger:** a concrete end-user-facing feature (public sign-in, gated content, member-only routes), real demand for SSO/OIDC, role-editable rules pressure, or a site-settings need.

Specifically:

- **`UserAuth` sign-in surface** — end-user authentication realm. The `Actor` union already accepts `UserAuth`; the DB tables, sign-in flow, and UI wait.
- **Magic-link / SSO / OIDC providers** — `SessionProvider` accommodates them; only the built-in `JwtSessionProvider` ships today.
- **UI-editable conditional rules (CASL-style)** — currently expressed via collection hooks; a UI for role-editable rules is the deferred bit.
- **Site-settings storage and editor** — orthogonal to auth; bundled here because it surfaces with similar UI/runtime concerns.

See [AUTHN-AUTHZ.md → Explicitly deferred](./docs/06-auth-and-security/01-authn-authz.md#explicitly-deferred).

### Stable HTTP transport for `path`

**Trigger:** the broader stable HTTP API transport (see above). The widget already posts `path` as a top-level field through server fns; once the HTTP boundary lands, `path` falls out of the same wire-shape pass. Trivial work; flagged here so it isn't forgotten. See [DOCUMENT-PATHS.md → Phase — stable HTTP transport for path](./docs/04-collections/05-document-paths.md#phase--stable-http-transport-for-path).
