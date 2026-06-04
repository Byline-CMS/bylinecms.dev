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

---

## Next

### `hasMany` relations

The single biggest planned addition to the relations surface. Schema, storage, populate output, and `where` quantifiers (`$some` / `$every` / `$none`) all change in concert. Largest item in this list by scope. See [RELATIONSHIPS.md → Phase — hasMany relations](./RELATIONSHIPS.md#phase--hasmany-relations).

### Bulk "refresh embedded relations" admin command

For richtext fields in snapshot mode (`embedRelationsOnSave: true, populateRelationsOnRead: false`), embedded data drifts when targets change. A bulk command would walk every richtext value in a chosen collection (or installation-wide), re-resolve each relation, and re-embed the cached fields in place — without bumping `documentVersions`. Useful when staleness compounds (e.g. a bulk title rename) and per-document re-saves aren't practical. See [RELATIONSHIPS.md → Phase — bulk refresh denormalised links](./RELATIONSHIPS.md#phase--bulk-refresh-denormalised-links-command).

### Cascade-delete acted on

The `cascade_delete` flag round-trips today but isn't enforced. Future write-path pass walks relations to deleted targets and applies the policy: `true` → hard-delete the referencing rows; `false` → leave in place (`_resolved: false` on read); `'restrict'` → refuse the delete with `ERR_REFERENTIAL_INTEGRITY`. Shares design surface with the integrity-scanning track. See [RELATIONSHIPS.md → Phase — cascade-delete acted on](./RELATIONSHIPS.md#phase--cascade-delete-acted-on).

### Cross-document link integrity job

Periodic admin command that scans richtext fields and `store_relation` rows for links to deleted or unresolvable targets, then surfaces them in a "broken links" admin view. Reuses populate's missing-target detection (`_resolved: false`) but materialises the result as a triage list. See [RELATIONSHIPS.md → Phase — cross-document link integrity job](./RELATIONSHIPS.md#phase--cross-document-link-integrity-job).

### Relation column formatter

List views currently render `target_document_id` as a string for relation fields. A formatter that resolves to the target's `useAsTitle` (with the picker's `displayField` fallback chain) is small, self-contained, and worth doing alongside `hasMany` so the formatter handles "A, B, +3 more" from the start. See [RELATIONSHIPS.md → Phase — relation column formatter](./RELATIONSHIPS.md#phase--relation-column-formatter).

### Historical config snapshots — `collection_versions` history table

COLLECTIONS versioning Phase 2 — the smallest useful follow-up to the schema-version recording that already ships. One row per version-bump carrying the snapshot of `CollectionDefinition` at that version. Unblocks Phase 3 (fetch-by-version) and is the prerequisite for any future read-time forward-migration work. See [COLLECTIONS.md → Phase 2 — historical config snapshots](./COLLECTIONS.md#phase-2--historical-config-snapshots).

### All things AI

Native MCP Server and AI / content integration.

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

### Framework guard for server-only code in collection hooks

**Trigger:** a third app hits the leak, or the shim discipline proves too easy to forget. A collection schema is isomorphic (bundled into the client admin), but `hooks` may reference server-only modules — and a static import of one drags it into the client bundle (today's mitigation is a client-safe, SSR-gated shim, applied by hand). Core could make this safe by construction: a first-class lazy-loader form of `hooks` (`hooks: () => import('./x.hooks')`, resolved once server-side in `document-lifecycle`), and/or a build-time `server-only` poison that fails loudly when a schema's client graph reaches it. See [COLLECTIONS.md → Hooks must not statically import server-only code](./COLLECTIONS.md#hooks-must-not-statically-import-server-only-code). Lives in `@byline/core` (`bylinecms.dev`), not this app.

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
