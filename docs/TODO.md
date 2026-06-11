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

### Richtext populate integration test

Deferred from the round that landed the populate primitive. The CI integration-test pipeline now runs the suite on every PR (see [TESTING.md](./TESTING.md)) so this can land at any time. Shape: seed a doc with rich-text-in-blocks, mutate the source target, re-read, assert the embedded envelope refreshes when `populateRelationsOnRead: true` and stays stale when `false`. Pattern: existing `packages/client/tests/integration/client-populate.integration.test.ts`. See [RICHTEXT.md → Relations — embed and populate](./RICHTEXT.md#relations--embed-and-populate) for the populate primitive itself.

### Admin editor smoke suite — remaining scenarios

The Playwright harness shipped (see [TESTING.md → Editor smoke suite](./TESTING.md#editor-smoke-suite-playwright)): auth setup through the real sign-in form, dashboard/list rendering, create → edit → save round-trip, and a workflow status transition. Remaining scenarios from the growth checklist in `apps/webapp/e2e/editor-smoke.spec.ts`: each remaining field type (datetime, select, checkbox, relation, richtext), file upload (media collection), content-locale switch + translation save, duplicate / restore-version flows. Scope stays ~10–15 happy-path scenarios, not coverage. Completes **before `hasMany`** (which is heavily an admin-UI feature: multi-relation picker, list rendering).

---

## Next

### Markdown export — `documentToMarkdown` + `.md` routes

**Core pipeline shipped:** `lexicalToMarkdown` (`@byline/richtext-lexical/server`, one-way stored-JSON walk, GFM alerts for admonitions), `documentToMarkdown` (`@byline/core`, schema-aware assembler with frontmatter), the `ServerConfig.fields.richText.toMarkdown` seam, and the first `.md` route — `/docs/{path}.md` per content locale via a `{$path}[.]md` suffixed-param route, L1-cached on the document's detail tag. The locale rewrite treats `.md` as content (one variant per content locale), and `devMarkdownPassthrough` (vite.config.ts) keeps Vite's dev middleware from claiming `.md` requests. Contract tests pin the format in both packages; e2e covers the route.

**Also shipped:** `llms.txt` (sitemap-sibling route; both surfaces consume one shared published-URL enumeration in `apps/webapp/src/lib/published-index.ts` — one scan, one cache entry, no drift; links point at the `.md` representations), and the news/pages route rollout (generic loader in `apps/webapp/src/lib/markdown.ts`, per-area page routes with an `area` acceptance guard).

**Remaining:** `<link rel="alternate" type="text/markdown">` in HTML heads, optional `Accept: text/markdown` negotiation on canonical URLs, a `docs/MARKDOWN-EXPORT.md` present-state doc (including the GFM-alert vs `:::` importer dialect asymmetry), and the docs-corpus round-trip test.

Serve a markdown representation of published documents at their routes (`/news/foo.md`, `Accept: text/markdown` content negotiation, a `<link rel="alternate" type="text/markdown">` in the page head, an `llms.txt` index) — increasingly expected by AI agents and documentation tooling, and the stronger strategic reason to invest in markdown serialization. **Ranked high.**

Key decisions already settled (so this can be picked up cold):

- **Export-first and one-way.** `SerializedEditorState → markdown` is a pure tree walk; output is read-only and never re-imported, so *lossy is acceptable* (flatten an inline image to `![alt](url)`, a layout column to stacked sections). This is **not** the same problem as the editor's markdown source toggle — that one needs bidirectional, lossless transformers (`BYLINE_TRANSFORMERS`); export does not. Build the one-way serializer; don't let the toggle's harder fidelity bar gate it.
- **No `@lexical/headless` on the server** — it has been unreliable for Byline's node set. Walk the stored serialized JSON directly, following the existing pattern in `apps/webapp/src/ui/byline/components/richtext-lexical/serialize/` and the `packages/ai` text utilities. No editor instantiation, no DOM, no node registration.
- **Document-grain, not field-grain.** A page is a composite (text, multiple richtext fields, blocks, arrays, relations). `documentToMarkdown(doc, collectionDef)` walks the collection's fields → one markdown file (frontmatter from title/meta, fields/blocks as sections, relations as links). Two registries: a Lexical-node→markdown serializer and a field/block→markdown assembler.
- **Caching** keys purely on the **content locale in the URL** (default-locale fallback for untranslated docs); UI locale stays the invisible signal. Same cache key as the HTML page — one `.md` variant per content locale.
- **Published-only, opt-in per collection.** The `.md` routes and `llms.txt` read through `@byline/client` with `status: 'published'` — drafts never leak; unpublished/missing → 404 same as HTML. Collections opt in to the agent-readable surface via admin config (no accidental exposure of e.g. a media library). Relations serialize as links to the targets' canonical URLs (which have their own `.md` variants), so the corpus is traversable.
- **The output is a contract surface.** Agents will build on the shape — snapshot-test the serializer per field type from day one so format drift is loud, not silent.

Likely home for the serializer is `@byline/core/services` (or the richtext adapter's `/server` entry for the Lexical-node half); the `.md` route handler is host-side. See [RICHTEXT.md → Phase 8 — markdown export](./RICHTEXT.md#phase-8--markdown-export).

### `hasMany` relations

The single biggest planned addition to the relations surface. Schema, storage, populate output, and `where` quantifiers (`$some` / `$every` / `$none`) all change in concert. Largest item in this list by scope. See [RELATIONSHIPS.md → Phase — hasMany relations](./RELATIONSHIPS.md#phase--hasmany-relations).

### Search-provider interface (design doc first)

A pluggable search seam in core: a `SearchProvider` interface with Postgres FTS as the built-in driver, so external providers (BM25 rankers, vector / hybrid retrieval) plug in through a sanctioned extension point instead of ad-hoc forks. First deliverable is the design doc (`docs/SEARCH.md`): interface shape, index lifecycle (publish/unpublish hooks, reindex command), what feeds it (richtext plain-text extraction — Phase 5's named trigger "the search/indexing story takes shape" fires here — and the attachment text-extraction pipeline below), and the query surface. Implementation follows once the doc settles.

### Attachment text-extraction pipeline

Extract text and structure from uploaded file attachments (PDF, DOCX, …) to feed search indexing and downstream retrieval. Shape: an extraction-provider interface — `file → { markdown, plainText, metadata }` — so structure-aware, markdown-emitting extractors (Docling-class) and classic extractors (Apache Tika) are interchangeable drivers. Extracted output lands in its own table keyed to the file (never as synthetic `store_*` field data), invalidated on re-upload. Markdown-first output deliberately converges with the markdown-export surface, so documents and attachments share one representation for indexing, chunking, and agents.

### Relation column formatter

List views currently render `target_document_id` as a string for relation fields. A formatter that resolves to the target's `useAsTitle` (with the picker's `displayField` fallback chain) is small, self-contained, and worth doing alongside `hasMany` so the formatter handles "A, B, +3 more" from the start. See [RELATIONSHIPS.md → Phase — relation column formatter](./RELATIONSHIPS.md#phase--relation-column-formatter).

### Document-grain audit log + system-history view

Phase 2 of the v3.3.0 system-field decoupling. The non-versioned writes for document-grain fields (`path`, editorial `availableLocales`) are immediate and deliberately absent from version history — so they currently leave no audit trail. Round out Byline's auditable history so *every* change is accountable, not just content: a document-grain audit-log table (`actor` / `action` / `field` / `before` → `after` / `occurred_at`) written from `updateDocumentSystemFields` (and optionally `changeDocumentStatus`) under the existing auth gate, plus a **new tab under the document History view** — content/version history on the current tab, **system & document-level history** on the new one (who changed the path / advertised locales / status, when, and from→to). See [CORE-DOCUMENT-STORAGE.md → Phase — document-grain audit log](./CORE-DOCUMENT-STORAGE.md#phase--document-grain-audit-log-planned).

### Bulk "refresh embedded relations" admin command

For richtext fields in snapshot mode (`embedRelationsOnSave: true, populateRelationsOnRead: false`), embedded data drifts when targets change. A bulk command would walk every richtext value in a chosen collection (or installation-wide), re-resolve each relation, and re-embed the cached fields in place — without bumping `documentVersions`. Useful when staleness compounds (e.g. a bulk title rename) and per-document re-saves aren't practical. See [RELATIONSHIPS.md → Phase — bulk refresh denormalised links](./RELATIONSHIPS.md#phase--bulk-refresh-denormalised-links-command).

### Cascade-delete acted on

The `cascade_delete` flag round-trips today but isn't enforced. Future write-path pass walks relations to deleted targets and applies the policy: `true` → hard-delete the referencing rows; `false` → leave in place (`_resolved: false` on read); `'restrict'` → refuse the delete with `ERR_REFERENTIAL_INTEGRITY`. Shares design surface with the integrity-scanning track. See [RELATIONSHIPS.md → Phase — cascade-delete acted on](./RELATIONSHIPS.md#phase--cascade-delete-acted-on).

### Cross-document link integrity job

Periodic admin command that scans richtext fields and `store_relation` rows for links to deleted or unresolvable targets, then surfaces them in a "broken links" admin view. Reuses populate's missing-target detection (`_resolved: false`) but materialises the result as a triage list. See [RELATIONSHIPS.md → Phase — cross-document link integrity job](./RELATIONSHIPS.md#phase--cross-document-link-integrity-job).

### Historical config snapshots — `collection_versions` history table

COLLECTIONS versioning Phase 2 — the smallest useful follow-up to the schema-version recording that already ships. One row per version-bump carrying the snapshot of `CollectionDefinition` at that version. Unblocks Phase 3 (fetch-by-version) and is the prerequisite for any future read-time forward-migration work. See [COLLECTIONS.md → Phase 2 — historical config snapshots](./COLLECTIONS.md#phase-2--historical-config-snapshots).

### Native MCP server

Sequenced after the markdown / `llms.txt` surface and the search-provider seam: the agent-readable representation and the retrieval layer land first, then the protocol surface that exposes them. See [MCP.md](./MCP.md).

### Block config analogue — per-block `schema` / `admin` split

Blocks today are a single `defineBlock()` schema object (e.g. `apps/webapp/byline/blocks/richtext-block.ts`), with **no admin-side counterpart**. Collections get the clean schema-vs-presentation split (`schema.ts` + `admin.tsx` via `defineAdmin()`); blocks don't. The consequence: a richText field nested inside a block can't be opted into a specific editor (or any other per-field admin override) the way a top-level collection field can — `blocks-field.tsx` renders block children through `GroupField → FieldRenderer` with no per-field admin config threaded down, so block-nested fields can only inherit the **global** `fields.richText.editor` registration in `admin.config.ts`. (That global is what AI richtext currently rides on — see the active registration in `byline/admin.config.ts`.)

Sketch + implement a block analogue to the collection model: a `defineBlockAdmin()` (or equivalent) carrying a per-field admin map keyed by the block's field names, paired with the React-free `defineBlock()` schema — same "schema files stay tsx-loadable / React-free, admin config lives separately" contract the collections enforce. Then thread the resolved block admin config from `blocks-field.tsx` into each child `FieldRenderer` so per-block-field overrides (starting with `editor`, e.g. `aiRichTextAdmin()` on one block's richText but not another's) actually land. Scope spans `@byline/core` (the new define/types), `@byline/admin` (`blocks-field.tsx` propagation + field-renderer wiring), and the `apps/webapp/byline/blocks/*` authoring surface. Closely related to the deferred [per-collection / per-field editor selection](#per-collection--per-field-editor-selection-richtext-phase-6) item — this is the block-scoped half of that same editor-variance question.

Note: this is **only** about field config inside the block field itself. The `LexicalNestedComposer`-based nested editors (admonition body, inline-image caption) bypass the extension graph entirely and are intentionally out of scope — AI is not available there by design.

### Admin client-config registration — single-point resolution

The Byline client config (`defineClientConfig`) is registered from **two** points on the `_byline` route — `route.tsx` `beforeLoad` (loader phase) and `route.lazy.tsx`'s side-effect import (component render / hydration) — because neither alone covers both lifecycle moments. It works and is correct; collapsing to a **single eager point** only works if `admin.config`'s static graph is light enough not to bloat public-route bundles.

**Groundwork shipped (richtext side):** the `@byline/richtext-lexical/config` subpath + lazy `AiLexicalExtension` mean referencing the **editor runtime** no longer pulls it. **The blocker is now the admin side, not richtext:** collection admin configs hold live references to presentation slots (`DateTimeFormatter`, `MediaListView`, …) from `@byline/admin/react` — a deliberately indivisible single-Context-identity barrel — so eager registration would drag the whole admin document-editor surface into public bundles.

The eager single point **is** possible without breaking slot components' context access (defer *when* slot code loads, not *where* it renders), but the cost/benefit is poor today (reworks the slot authoring API + adds Suspense plumbing to remove two correct import statements). **Deferred until a concrete driver makes eager-light config necessary.** Full root-cause analysis, the three viable mechanisms, and the "is it even possible given slot components need context?" answer live in **[CLIENT-CONFIG-REGISTRATION.md](./CLIENT-CONFIG-REGISTRATION.md)**.

---

## Deferred

Each entry names the trigger that would move it into Next. No work happens until the trigger fires.

### Build-time `server-only` poison for collection hooks

**Shipped (the isolation half):** `@byline/core` now accepts a first-class lazy-loader form of `hooks` — `hooks: () => import('./x.hooks')`, resolved once and memoized via `resolveHooks` across every lifecycle and read site. Because the schema reaches the hooks only through `import()`, the hooks module's server-only graph is structurally absent from the client bundle. See [COLLECTIONS.md → Hooks must not statically import server-only code](./COLLECTIONS.md#hooks-must-not-statically-import-server-only-code).

**Trigger (the guardrail half, still deferred):** someone bypasses the loader (static-imports a `*.hooks` module into a schema) and ships dead weight or a runtime throw without noticing. Add a `@byline/core/server-only` subpath — the React/Next pattern: a browser-conditional export that fails the build — that authors `import` at the top of a `*.hooks` file, so a hooks module pulled into the client build fails loudly instead of silently. Verify-first: confirm the webapp's **Vite client build** actually honors the poisoned export condition before promising it (if it silently resolves, the guard doesn't guard). Lives in `@byline/core` (`bylinecms.dev`), not this app.

### Stable HTTP API transport

**Trigger:** first non-admin client arrives (mobile, desktop, third-party). Today every read/write goes through TanStack Start server fns inside the admin webapp; no stable HTTP shape is published. Designed across the full surface area at that point, not just one verb. See [ROUTING-API.md](./ROUTING-API.md) and the deferral note in `CLAUDE.md`.

### Per-locale paths (translated slugs)

**Trigger:** a real consumer needs translated slugs as a CMS concern (not just locale-prefixed routing in the frontend). The structural answer is on file: a new `document_paths` table keyed by `(collection_id, locale, path)`, not extending the existing column or pushing `path` into the EAV. See [DOCUMENT-PATHS.md → Phase — per-locale paths](./DOCUMENT-PATHS.md#phase--per-locale-paths-the-larger-one).

### Per-collection slugifier override

**Trigger:** a real need (e.g. media collection that wants to preserve filename extensions). The plumbing point is well-defined: `useAsPath: { source, formatter }` taking precedence over `ServerConfig.slugifier`. See [DOCUMENT-PATHS.md → Phase — per-collection slugifier override](./DOCUMENT-PATHS.md#phase--per-collection-slugifier-override).

### Editor lifecycle hooks for richtext (Phase 3b)

**Trigger:** a second editor implementation arrives (`@byline/richtext-tiptap`, `@byline/richtext-md`) **and** it can't achieve correct round-trip behaviour through the existing `FieldHooks` and collection hooks alone. Adapter-level `beforeChange` / `afterChange` / `beforeRead` / `serialize` / `deserialize` is genuinely editor-specific and best designed against two concrete shapes rather than one. See [RICHTEXT.md → Phase 3b](./RICHTEXT.md#phase-3b--user-land-editor-lifecycle-hooks-deferred).

### Feature-graph configuration for richtext (Phase 4)

**Trigger:** at least two editor packages have a *compatible* feature surface that cannot be expressed as plain editor-specific props. Until then, `RichTextField.editorConfig: unknown` plus per-package config types is the right shape. See [RICHTEXT.md → Phase 4](./RICHTEXT.md#phase-4--feature-graph-configuration-only-if-phase-23-demand-it).

### Editor-side server pipeline — search / excerpt / plain text (richtext Phase 5)

**Trigger:** the search / indexing story takes shape. Independent of the adapter contract; could ship at any point but slots most naturally next to a search consumer. See [RICHTEXT.md → Phase 5](./RICHTEXT.md#phase-5--editor-side-server-pipeline-search-excerpt-plain-text).

### Per-collection / per-field editor selection (richtext Phase 6)

**Trigger:** a real product ask for editor variance per collection or per field (e.g. markdown editor in a docs collection alongside Lexical in a marketing collection). Mechanically easy; the product question is the harder half. See [RICHTEXT.md → Phase 6](./RICHTEXT.md#phase-6--per-collection--per-field-editor-selection).

### Collection-versioning Phases 3–5

**Trigger:** something needs to render an old document against its original schema, or CI needs strict version pinning. Phase 3 (fetch by version) is the smallest read-side piece that unblocks anything interesting; Phase 4 (in-memory forward-migration) is the load-bearing one; Phase 5 (`strictCollectionVersions: true`) is a CI ergonomics flag. Each is independently shippable once Phase 2 lands. See [COLLECTIONS.md → Future phases](./COLLECTIONS.md#future-phases-versioning-phases-25).

### CORE-COMPOSITION Phases 2–5

**Trigger:** the per-line repetition cost in admin commands becomes the bottleneck (Phase 1 — the `createCommand` wrapper — has shipped). Phase 2 = module-level registry factories. Phase 3 = compose registries in `initBylineCore()` + expose a command tree on `BylineCore`. Phase 4 = typed request-context builders per actor realm. Phase 5 = `loadConfig()` single env-parsing boundary. Phases 4 and 5 are independent of 2/3. See [CORE-COMPOSITION.md → Future phases of work](./CORE-COMPOSITION.md#future-phases-of-work).

### `UserAuth` (end-user authentication) and adjacent deferred surfaces

Distinct from the shipped admin-auth subsystem (`AdminAuth`, `JwtSessionProvider`, admin user/role/permission management, document-collection and admin-management ability enforcement, `beforeRead` row-scoping). The pieces below are reserved in the contract — `Actor = AdminAuth | UserAuth | null`, the `SessionProvider` interface — but the implementations wait.

**Trigger:** a concrete end-user-facing feature (public sign-in, gated content, member-only routes), real demand for SSO/OIDC, role-editable rules pressure, or a site-settings need.

Specifically:

- **`UserAuth` sign-in surface** — end-user authentication realm. The `Actor` union already accepts `UserAuth`; the DB tables, sign-in flow, and UI wait.
- **Magic-link / SSO / OIDC providers** — `SessionProvider` accommodates them; only the built-in `JwtSessionProvider` ships today.
- **UI-editable conditional rules (CASL-style)** — currently expressed via collection hooks; a UI for role-editable rules is the deferred bit.
- **Site-settings storage and editor** — orthogonal to auth; bundled here because it surfaces with similar UI/runtime concerns.

See [AUTHN-AUTHZ.md → Explicitly deferred](./AUTHN-AUTHZ.md#explicitly-deferred).

### Stable HTTP transport for `path`

**Trigger:** the broader stable HTTP API transport (see above). The widget already posts `path` as a top-level field through server fns; once the HTTP boundary lands, `path` falls out of the same wire-shape pass. Trivial work; flagged here so it isn't forgotten. See [DOCUMENT-PATHS.md → Phase — stable HTTP transport for path](./DOCUMENT-PATHS.md#phase--stable-http-transport-for-path).
