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

Promoted now that the search query surface is complete: zone (cross-collection) query + `hydrate` shipped 2026-07-07 (`client.search({ zone })` — heterogeneous ranked hits, per-collection ability filtering + `beforeRead` row scoping, `hydrate` batch-reads into shaped `ClientDocument`s and drops stale index entries; see [07-search.md → Zone search](./docs/05-reading-and-delivery/07-search.md#zone-cross-collection-search--clientsearch-zone-)). This is the next piece of the RAG/retrieval track: an extraction-provider interface — `file → { markdown, plainText, metadata }` — so structure-aware, markdown-emitting extractors (Docling-class) and classic extractors (Apache Tika) are interchangeable drivers. Extracted output lands in its own table keyed to the file (never as synthetic `store_*` field data), invalidated on re-upload, joined into the searchable `body`. Markdown-first output deliberately converges with the markdown-export surface, so documents and attachments share one representation for indexing, chunking, and agents. Full landscape + tiered strategy: [byline-search-extraction-strategy.md](./docs/byline-search-extraction-strategy.md).

---

## Next

### Markdown export — remaining polish

The agent-readable surface **shipped** (the full present-state reference is [MARKDOWN-EXPORT.md](./docs/05-reading-and-delivery/04-markdown-export.md)): `lexicalToMarkdown`, `documentToMarkdown`, the `fields.richText.toMarkdown` seam, `.md` routes per content locale for docs/news/pages, `llms.txt` over a shared published-URL index with the sitemap, and all three advertisement channels (`.md` URLs, head `rel=alternate` links, strict `Accept: text/markdown` 302 negotiation).

Remaining, specified in [MARKDOWN-EXPORT.md → Future phases](./docs/05-reading-and-delivery/04-markdown-export.md#future-phases): the **docs-corpus round-trip test** (`import(export(import(md))) ≅ import(md)` over `docs/*.md`, comparing Lexical trees — tests the export serializer against production-shaped content; preferred companion: teach `parse-markdown.ts` to also accept GFM alerts, erasing the admonition dialect asymmetry documented there). Deferred with triggers: per-field markdown opt-out, host-package route factories, `llms-full.txt` / MCP consumption.

### Search — remaining phases (where/facets, exact paging under scoping)

Phase 2 **shipped**: the `SearchProvider` seam, the `@byline/search-postgres` FTS driver, `ServerConfig.search` registration/validation, lifecycle-hook indexing + `reindex` (ability-gated, admin button), `client.collection(x).search()` with the docs frontend as the worked example, row-level authorization, and the cross-collection `client.search({ zone })` + `hydrate` (all 2026-07-07). Present-state reference: [docs/05-reading-and-delivery/07-search.md](./docs/05-reading-and-delivery/07-search.md). Attachment extraction (Phase 3) is promoted to **Now** (above).

Remaining, specified in [07-search.md → Planned (not yet shipped)](./docs/05-reading-and-delivery/07-search.md#planned-not-yet-shipped):

1. **Structured `where` filtering + facet aggregation** — options accepted in the API; the Postgres driver doesn't yet apply them (`capabilities.facets === false`).
2. **Exact paging under row scoping** — core-side re-auth filters after ranking, so `total` / offset paging are approximate on scoped collections; the exact alternative pushes the `QueryPredicate` down into the provider (driver capability, needs indexed scoping columns).

Then external drivers (the RAG/vector/hybrid payoff; home for the private BM25 work), then the MCP `search` tool.

### Bulk "refresh embedded relations" admin command

For richtext fields in snapshot mode (`embedRelationsOnSave: true, populateRelationsOnRead: false`), embedded data drifts when targets change. A bulk command would walk every richtext value in a chosen collection (or installation-wide), re-resolve each relation, and re-embed the cached fields in place — without bumping `documentVersions`. Useful when staleness compounds (e.g. a bulk title rename) and per-document re-saves aren't practical. See [RELATIONSHIPS.md → Phase — bulk refresh denormalised links](./docs/04-collections/02-relationships.md#phase--bulk-refresh-denormalised-links-command).

### Cascade-delete acted on

The `cascade_delete` flag round-trips today but isn't enforced. Future write-path pass walks relations to deleted targets and applies the policy: `true` → hard-delete the referencing rows; `false` → leave in place (`_resolved: false` on read); `'restrict'` → refuse the delete with `ERR_REFERENTIAL_INTEGRITY`. Shares design surface with the integrity-scanning track. See [RELATIONSHIPS.md → Phase — cascade-delete acted on](./docs/04-collections/02-relationships.md#phase--cascade-delete-acted-on).

### Cross-document link integrity job

Periodic admin command that scans richtext fields and `store_relation` rows for links to deleted or unresolvable targets, then surfaces them in a "broken links" admin view. Reuses populate's missing-target detection (`_resolved: false`) but materialises the result as a triage list. See [RELATIONSHIPS.md → Phase — cross-document link integrity job](./docs/04-collections/02-relationships.md#phase--cross-document-link-integrity-job).

### Historical config snapshots — `collection_versions` history table

COLLECTIONS versioning Phase 2 — the smallest useful follow-up to the schema-version recording that already ships. One row per version-bump carrying the snapshot of `CollectionDefinition` at that version. Unblocks Phase 3 (fetch-by-version) and is the prerequisite for any future read-time forward-migration work. See [COLLECTIONS.md → Phase 2 — historical config snapshots](./docs/04-collections/index.md#phase-2--historical-config-snapshots).

### Native MCP server

Sequenced after the markdown / `llms.txt` surface and the search-provider seam: the agent-readable representation and the retrieval layer land first, then the protocol surface that exposes them. See [MCP.md](./docs/05-reading-and-delivery/05-mcp-server.md).

### Block config analogue — per-block `schema` / `admin` split

Blocks today are a single `defineBlock()` schema object (e.g. `apps/webapp/byline/blocks/richtext-block.ts`), with **no admin-side counterpart**. Collections get the clean schema-vs-presentation split (`schema.ts` + `admin.tsx` via `defineAdmin()`); blocks don't. The consequence: a richText field nested inside a block can't be opted into a specific editor (or any other per-field admin override) the way a top-level collection field can — `blocks-field.tsx` renders block children through `GroupField → FieldRenderer` with no per-field admin config threaded down, so block-nested fields can only inherit the **global** `fields.richText.editor` registration in `admin.config.ts`. (That global is what AI richtext currently rides on — see the active registration in `byline/admin.config.ts`.)

Sketch + implement a block analogue to the collection model: a `defineBlockAdmin()` (or equivalent) carrying a per-field admin map keyed by the block's field names, paired with the React-free `defineBlock()` schema — same "schema files stay tsx-loadable / React-free, admin config lives separately" contract the collections enforce. Then thread the resolved block admin config from `blocks-field.tsx` into each child `FieldRenderer` so per-block-field overrides (starting with `editor`, e.g. `aiRichTextAdmin()` on one block's richText but not another's) actually land. Scope spans `@byline/core` (the new define/types), `@byline/admin` (`blocks-field.tsx` propagation + field-renderer wiring), and the `apps/webapp/byline/blocks/*` authoring surface. Closely related to the deferred [per-collection / per-field editor selection](#per-collection--per-field-editor-selection-richtext-phase-6) item — this is the block-scoped half of that same editor-variance question.

Note: this is **only** about field config inside the block field itself. The `LexicalNestedComposer`-based nested editors (admonition body, inline-image caption) bypass the extension graph entirely and are intentionally out of scope — AI is not available there by design.

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

---

## Deferred

Each entry names the trigger that would move it into Next. No work happens until the trigger fires.

### Build-time `server-only` poison for collection hooks

**Shipped (the isolation half):** `@byline/core` now accepts a first-class lazy-loader form of `hooks` — `hooks: () => import('./x.hooks')`, resolved once and memoized via `resolveHooks` across every lifecycle and read site. Because the schema reaches the hooks only through `import()`, the hooks module's server-only graph is structurally absent from the client bundle. See [COLLECTIONS.md → Hooks must not statically import server-only code](./docs/04-collections/index.md#hooks-must-not-statically-import-server-only-code).

**Trigger (the guardrail half, still deferred):** someone bypasses the loader (static-imports a `*.hooks` module into a schema) and ships dead weight or a runtime throw without noticing. Add a `@byline/core/server-only` subpath — the React/Next pattern: a browser-conditional export that fails the build — that authors `import` at the top of a `*.hooks` file, so a hooks module pulled into the client build fails loudly instead of silently. Verify-first: confirm the webapp's **Vite client build** actually honors the poisoned export condition before promising it (if it silently resolves, the guard doesn't guard). Lives in `@byline/core` (`bylinecms.dev`), not this app.

### Stable HTTP API transport

**Trigger:** first non-admin client arrives (mobile, desktop, third-party). Today every read/write goes through TanStack Start server fns inside the admin webapp; no stable HTTP shape is published. Designed across the full surface area at that point, not just one verb. See [ROUTING-API.md](./docs/05-reading-and-delivery/02-routing-and-api.md) and the deferral note in `CLAUDE.md`.

### Per-locale paths (translated slugs)

**Trigger:** a real consumer needs translated slugs as a CMS concern (not just locale-prefixed routing in the frontend). The structural answer is on file: a new `document_paths` table keyed by `(collection_id, locale, path)`, not extending the existing column or pushing `path` into the EAV. See [DOCUMENT-PATHS.md → Phase — per-locale paths](./docs/04-collections/04-document-paths.md#phase--per-locale-paths-the-larger-one).

### Per-collection slugifier override

**Trigger:** a real need (e.g. media collection that wants to preserve filename extensions). The plumbing point is well-defined: `useAsPath: { source, formatter }` taking precedence over `ServerConfig.slugifier`. See [DOCUMENT-PATHS.md → Phase — per-collection slugifier override](./docs/04-collections/04-document-paths.md#phase--per-collection-slugifier-override).

### Editor lifecycle hooks for richtext (Phase 3b)

**Trigger:** a second editor implementation arrives (`@byline/richtext-tiptap`, `@byline/richtext-md`) **and** it can't achieve correct round-trip behaviour through the existing `FieldHooks` and collection hooks alone. Adapter-level `beforeChange` / `afterChange` / `beforeRead` / `serialize` / `deserialize` is genuinely editor-specific and best designed against two concrete shapes rather than one. See [RICHTEXT.md → Phase 3b](./docs/04-collections/06-rich-text.md#phase-3b--user-land-editor-lifecycle-hooks-deferred).

### Feature-graph configuration for richtext (Phase 4)

**Trigger:** at least two editor packages have a *compatible* feature surface that cannot be expressed as plain editor-specific props. Until then, `RichTextField.editorConfig: unknown` plus per-package config types is the right shape. See [RICHTEXT.md → Phase 4](./docs/04-collections/06-rich-text.md#phase-4--feature-graph-configuration-only-if-phase-23-demand-it).

### Editor-side server pipeline — search / excerpt / plain text (richtext Phase 5)

**Trigger:** the search / indexing story takes shape. Independent of the adapter contract; could ship at any point but slots most naturally next to a search consumer. See [RICHTEXT.md → Phase 5](./docs/04-collections/06-rich-text.md#phase-5--editor-side-server-pipeline-search-excerpt-plain-text).

### Per-collection / per-field editor selection (richtext Phase 6)

**Trigger:** a real product ask for editor variance per collection or per field (e.g. markdown editor in a docs collection alongside Lexical in a marketing collection). Mechanically easy; the product question is the harder half. See [RICHTEXT.md → Phase 6](./docs/04-collections/06-rich-text.md#phase-6--per-collection--per-field-editor-selection).

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

**Trigger:** the broader stable HTTP API transport (see above). The widget already posts `path` as a top-level field through server fns; once the HTTP boundary lands, `path` falls out of the same wire-shape pass. Trivial work; flagged here so it isn't forgotten. See [DOCUMENT-PATHS.md → Phase — stable HTTP transport for path](./docs/04-collections/04-document-paths.md#phase--stable-http-transport-for-path).
