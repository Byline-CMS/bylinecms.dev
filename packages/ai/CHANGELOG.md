# @infonomic/ai

## 4.6.2

### Patch Changes

- fixed the collection editor losing its return-to-list page and filters across the preview round-trip (**`@byline/host-tanstack-start`**)
  hardened the admin-preferences migration to reassign table ownership to the app role (**`@byline/db-postgres`**)
- Updated dependencies
  - @byline/core@4.6.2
  - @byline/richtext-lexical@4.6.2
  - @byline/ui@4.6.2

## 4.6.1

### Patch Changes

- squashed the drizzle migration series into a single baseline migration and synced the `@byline/cli` scaffold template so fresh installs provision the `byline_admin_user_preferences` table
- Updated dependencies
  - @byline/core@4.6.1
  - @byline/richtext-lexical@4.6.1
  - @byline/ui@4.6.1

## 4.6.0

### Minor Changes

- added per-user list-view preferences (page-size + sort persistence) and return-to-list editor state, backed by a new `byline_admin_user_preferences` table and admin-preferences module

### Patch Changes

- Updated dependencies
  - @byline/core@4.6.0
  - @byline/richtext-lexical@4.6.0
  - @byline/ui@4.6.0

## 4.5.0

### Minor Changes

- added ComboButton menu icons, MarkdownIcon, and a dropdown anchor prop to `@byline/ui`
  fixed modal overlay-click dismissal and nested-heading anchor id derivation

### Patch Changes

- Updated dependencies
  - @byline/core@4.5.0
  - @byline/richtext-lexical@4.5.0
  - @byline/ui@4.5.0

## 4.4.1

### Patch Changes

- fixed admin form paths losing their target after a block or array reorder — items are now addressed by stable id, so edits, conditions and deferred uploads follow their own item. **`FieldHookContext.path`** and hook `setFieldValue` paths now use `[id=…]` selectors instead of positional indices

  tightened field path validation in **`@byline/core`** — bracket characters are rejected in field and block names, and a malformed path is reported as malformed rather than as a wrong-dialect index

- Updated dependencies
  - @byline/core@4.4.1
  - @byline/richtext-lexical@4.4.1
  - @byline/ui@4.4.1

## 4.4.0

### Minor Changes

- fixed upload fields declared inside blocks — **`@byline/admin`** now renders the drop zone and resolves `upload.context` against the addressed block
  added a shared field path grammar in **`@byline/core`**; boot now rejects unresolvable `search` config names and malformed patch paths

### Patch Changes

- Updated dependencies
  - @byline/core@4.4.0
  - @byline/richtext-lexical@4.4.0
  - @byline/ui@4.4.0

## 4.3.0

### Minor Changes

- arrays inside blocks are now fully editable and drag-sortable, and dotted schema-path keys let field admin overrides reach nested declarations (`faq.answer`);
  fixed patch aliasing that duplicated array items added inside a just-added block, and array items now validate against their child field schemas

### Patch Changes

- Updated dependencies
  - @byline/core@4.3.0
  - @byline/richtext-lexical@4.3.0
  - @byline/ui@4.3.0

## 4.2.0

### Minor Changes

- added per-block admin config (`defineBlockAdmin`) and a dedicated `code` field with a CodeMirror 6 admin widget
  added `upload.location` storage scoping, friendly upload keys with a configurable filename slugifier, and `itemViewSort` for relation pickers

### Patch Changes

- Updated dependencies [d169052]
- Updated dependencies [5993060]
- Updated dependencies
- Updated dependencies [5993060]
  - @byline/core@4.2.0
  - @byline/richtext-lexical@4.2.0
  - @byline/ui@4.2.0

## 4.1.0

### Minor Changes

- moved the typed server clients to `@byline/client/server` (Register declaration merge, `HostRequestBridge` seam in core) and app collection types to the new `@byline/generated-types` stub — codegen format 2, app-local `clients.server.ts` shim removed

### Patch Changes

- Updated dependencies
  - @byline/core@4.1.0
  - @byline/richtext-lexical@4.1.0
  - @byline/ui@4.1.0

## 4.0.0

### Major Changes

- introduced a host-agnostic `ServerConfig.hooks` registry (server-only lifecycle/upload hooks leave portable schemas) and hardened read-authorization, tree, delete, and routing boundaries
  made the mandatory `IDbAdapter` transaction/audit contract, resolved `routes.signIn`, and request-stable `RequestContext` factories the v4 baseline

### Patch Changes

- Updated dependencies
  - @byline/core@4.0.0
  - @byline/richtext-lexical@4.0.0
  - @byline/ui@4.0.0

## 3.21.0

### Minor Changes

- added **`@byline/client`** collection-type inference and a **`@byline/core`** deterministic type emitter for generating application collection types
  fixed hasMany relation, decimal, and file-size field-data types and canonicalized numeric writes across **`@byline/core`** / **`@byline/db-postgres`**

### Patch Changes

- Updated dependencies
  - @byline/core@3.21.0
  - @byline/richtext-lexical@3.21.0
  - @byline/ui@3.21.0

## 3.20.4

### Patch Changes

- added `listSearch` schema key, decoupling admin list-view search from `search.body`
- Updated dependencies
  - @byline/core@3.20.4
  - @byline/richtext-lexical@3.20.4
  - @byline/ui@3.20.4

## 3.20.3

### Patch Changes

- added configurable `defaultSort` for collection list views in **`@byline/admin`** and default padding for combo-button items in **`@byline/ui`**
- Updated dependencies
  - @byline/core@3.20.3
  - @byline/richtext-lexical@3.20.3
  - @byline/ui@3.20.3

## 3.20.2

### Patch Changes

- added a rounded frame + below-frame help text to **`@byline/admin`** relation fields, and fixed **`@byline/richtext-lexical`** settings forwarding resurrecting a removed InlineImageExtension
- Updated dependencies
  - @byline/core@3.20.2
  - @byline/richtext-lexical@3.20.2
  - @byline/ui@3.20.2

## 3.20.1

### Patch Changes

- fixed **`@byline/richtext-lexical`** merging field-level `editorConfig` over the registered editor config
- Updated dependencies
  - @byline/core@3.20.1
  - @byline/richtext-lexical@3.20.1
  - @byline/ui@3.20.1

## 3.20.0

### Minor Changes

- added virtual fields — hooks-visible computed values that are never persisted to storage
  fixed array item removal silently no-opping so removed items reappeared on save

### Patch Changes

- Updated dependencies
  - @byline/core@3.20.0
  - @byline/richtext-lexical@3.20.0
  - @byline/ui@3.20.0

## 3.19.0

### Minor Changes

- added full hook control over upload storage keys, upload context, and storage move/exists, plus scoped counters and a save-first upload gate

### Patch Changes

- Updated dependencies
  - @byline/core@3.19.0
  - @byline/richtext-lexical@3.19.0
  - @byline/ui@3.19.0

## 3.18.0

### Patch Changes

- Updated dependencies [43d3d97]
  - @byline/core@3.18.0
  - @byline/richtext-lexical@3.18.0
  - @byline/ui@3.18.0

## 3.17.1

### Patch Changes

- fixed upload fields nested in group/array/blocks — recursive upload-field discovery, upload transport resolution, and storage cleanup on delete
- Updated dependencies
  - @byline/core@3.17.1
  - @byline/richtext-lexical@3.17.1
  - @byline/ui@3.17.1

## 3.17.0

### Minor Changes

- added conditional field visibility (`condition` on schema fields) and cross-field writes via the field-hook context's `setFieldValue`

### Patch Changes

- Updated dependencies
  - @byline/core@3.17.0
  - @byline/richtext-lexical@3.17.0
  - @byline/ui@3.17.0

## 3.16.1

### Patch Changes

- fixed nested file/image uploads not rendering in array and group fields by threading `collectionPath` through
- Updated dependencies
  - @byline/core@3.16.1
  - @byline/richtext-lexical@3.16.1
  - @byline/ui@3.16.1

## 3.16.0

### Minor Changes

- added cross-collection zone search + hydrate (`client.search({ zone })`) and row-level authorization on search; added `hasMany` multi-select relation picker and `$some` / `$every` / `$none` query quantifiers

### Patch Changes

- Updated dependencies
  - @byline/core@3.16.0
  - @byline/richtext-lexical@3.16.0
  - @byline/ui@3.16.0

## 3.15.2

### Patch Changes

- fixed **`@byline/core`** `buildSearchDocument` so `search.body` entries that name a container field (`blocks` / `array` / `group`) are walked recursively, indexing nested richtext/text leaves — block-based prose was previously absent from the search index
- Updated dependencies
  - @byline/core@3.15.2
  - @byline/richtext-lexical@3.15.2
  - @byline/ui@3.15.2

## 3.15.1

### Patch Changes

- fixed `@byline/search-postgres` `migrate()` crashing under a bundled production server (Nitro) by embedding its SQL — it previously read the `.sql` files relative to `import.meta.url`, which a bundle breaks (ENOENT on boot)
- Updated dependencies
  - @byline/core@3.15.1
  - @byline/richtext-lexical@3.15.1
  - @byline/ui@3.15.1

## 3.15.0

### Minor Changes

- added full-text search: new `@byline/search-postgres` provider, the `SearchProvider` seam in `@byline/core`, `client.collection().search()`, lifecycle indexing + reindex, and the docs search frontend
  added the `lexicalToText` richtext extractor and generalised the relation `picker` config to `admin.itemView`

### Patch Changes

- Updated dependencies
  - @byline/core@3.15.0
  - @byline/richtext-lexical@3.15.0
  - @byline/ui@3.15.0

## 3.14.0

### Minor Changes

- added hasMany ordered multi-target relations — schema flag, indexed array storage, array-of-envelopes populate, and a drag-reorder/add/remove editor widget

### Patch Changes

- Updated dependencies
  - @byline/core@3.14.0
  - @byline/richtext-lexical@3.14.0
  - @byline/ui@3.14.0

## 3.13.3

### Patch Changes

- fixed admin theme switch being clobbered on navigation and blocks/array field items disappearing across tab switches
- Updated dependencies
  - @byline/core@3.13.3
  - @byline/richtext-lexical@3.13.3
  - @byline/ui@3.13.3

## 3.13.2

### Patch Changes

- refined `@byline/ui` prose typography — looser list-item spacing and primary-colored `ul` disc markers — plus normal-weight alert titles
- Updated dependencies
  - @byline/core@3.13.2
  - @byline/richtext-lexical@3.13.2
  - @byline/ui@3.13.2

## 3.13.1

### Patch Changes

- refined `@byline/ui` prose typography styles alongside docs index layout and prev/next css updates
- Updated dependencies
  - @byline/core@3.13.1
  - @byline/richtext-lexical@3.13.1
  - @byline/ui@3.13.1

## 3.13.0

### Minor Changes

- Document trees + squashed migration baseline.

  **Document trees (`tree: true` collections).** Self-referential collections can opt into a single-parent, ordered, document-grain hierarchy — the backbone for documentation / book sites. Includes the storage reshape, tree commands and `@byline/client` tree API (`placeTreeNode` / `removeFromTree` / `getSubtree` / `getAncestors` / `getTreeParent`), the admin tree list view (drag-to-reorder + re-parent) and sidebar placement widget, hierarchical public URLs (splat handler with canonical 301 / status-at-edge 404, HTML + `.md`), tree-rendered nav and prev/next, and tree-aware sitemap / `llms.txt` enumeration. `byline init` now scaffolds the docs collection in tree mode.

  **Migrations — squashed baseline.** The Drizzle migrations are squashed to a single `0000_ordinary_rhino.sql` baseline. **Fresh installs need no action** — `drizzle:migrate` applies the baseline.

  **⚠️ Existing-site migration.** A database already provisioned on a previous release must **not** re-run the squashed baseline. To adopt `tree: true` collections, apply the standalone DDL that reshapes `byline_document_relationships` from the dormant many-to-many edge list into the single-parent ordered adjacency model:

  ```sh
  psql "$DATABASE_URL" -f packages/db-postgres/sql/0004_document_relationships.sql
  ```

  The table is dormant and empty by contract, so this is pure DDL with **no data backfill**. The script lives in the GitHub repository (the published `@byline/db-postgres` package ships `dist` only, not `sql/`). See `packages/db-postgres/sql/0004_document_relationships.sql` and `docs/DOCUMENT-TREE.md` for the full reshape and invariants.

### Patch Changes

- Updated dependencies
  - @byline/core@3.13.0
  - @byline/richtext-lexical@3.13.0
  - @byline/ui@3.13.0

## 3.12.2

### Patch Changes

- fixed a **`@byline/ui`** drawer console warning by wrapping the popup in Base UI's viewport; refactored the **`@byline/admin`** form-renderer / form-context internals (no behavioural change)
- Updated dependencies
  - @byline/core@3.12.2
  - @byline/richtext-lexical@3.12.2
  - @byline/ui@3.12.2

## 3.12.1

### Patch Changes

- **`@byline/richtext-lexical`** editor loading placeholder now renders a document-shaped skeleton (heading, paragraphs, image, sub-heading) instead of a flat block of shimmer rows
- Updated dependencies
  - @byline/core@3.12.1
  - @byline/richtext-lexical@3.12.1
  - @byline/ui@3.12.1

## 3.12.0

### Minor Changes

- added Spanish, German, Italian, Simplified Chinese and Korean admin interface translations, plus an account colour-theme switch (light/dark/system)
  localised the account preferences drawer and moved the language menu off Tailwind to a CSS module

### Patch Changes

- Updated dependencies
  - @byline/core@3.12.0
  - @byline/richtext-lexical@3.12.0
  - @byline/ui@3.12.0

## 3.11.3

### Patch Changes

- polished the admin shell UI — compact menu-drawer items now render as square icon buttons
- Updated dependencies
  - @byline/core@3.11.3
  - @byline/richtext-lexical@3.11.3
  - @byline/ui@3.11.3

## 3.11.2

### Patch Changes

- added the `/admin/activity` route to the **`@byline/cli`** scaffold template so a fresh `byline init` wires the system activity area — the template had every other admin route but not activity, so fresh installs rendered the Activity menu item yet 404'd on the route (existing apps add the one-line route file themselves)
- Updated dependencies
  - @byline/core@3.11.2
  - @byline/richtext-lexical@3.11.2
  - @byline/ui@3.11.2

## 3.11.1

### Patch Changes

- fixed **`@byline/admin`** packaging so the `admin-activity` subpath is exposed in `publishConfig.exports` — the v3.11.0 subpath was declared only in the top-level `exports`, so the published package omitted it and broke downstream production builds importing `@byline/admin/admin-activity`
- Updated dependencies
  - @byline/core@3.11.1
  - @byline/richtext-lexical@3.11.1
  - @byline/ui@3.11.1

## 3.11.0

### Minor Changes

- added the system activity area (`/admin/activity`) — a paged, filterable feed over the version-stream + audit-log union, gated by the new `admin.activity.read` ability (audit Workstream 4)
  added hover tooltips to the collapsed admin sidebar menu icons

### Patch Changes

- Updated dependencies
  - @byline/core@3.11.0
  - @byline/richtext-lexical@3.11.0
  - @byline/ui@3.11.0

## 3.10.1

### Patch Changes

- fixed a dev-only hydration crash from the use-sync-external-store CJS shim and made the **`@byline/db-postgres`** audit-log migration superuser-safe
  migrated host/webapp server fns off the deprecated `createServerFn().inputValidator()`
- Updated dependencies
  - @byline/core@3.10.1
  - @byline/richtext-lexical@3.10.1
  - @byline/ui@3.10.1

## 3.10.0

### Minor Changes

- added the document-grain audit log: atomic audit rows for status, deletion, path, and available-locale changes, a gated auditLog() read, and a tabbed document-history view

### Patch Changes

- Updated dependencies
  - @byline/core@3.10.0
  - @byline/richtext-lexical@3.10.0
  - @byline/ui@3.10.0

## 3.9.0

### Minor Changes

- added a request-scoped `withTransaction` capability to the Postgres adapter — multiple storage commands now commit or roll back atomically via AsyncLocalStorage propagation, with no transaction handle threaded through their signatures
  fixed a v3.8.0 regression where script/seed writes with a non-UUID actor (e.g. the docs import) crashed on the new `created_by` column — such system writes now persist NULL

### Patch Changes

- Updated dependencies
  - @byline/core@3.9.0
  - @byline/richtext-lexical@3.9.0
  - @byline/ui@3.9.0

## 3.8.0

### Minor Changes

- added a per-version audit trail — the acting user and action behind every document version — surfaced as an audit strip in the admin history view
  fixed the history view to derive its identity column from useAsTitle and to keep page-size changes on the history route

### Patch Changes

- Updated dependencies
  - @byline/core@3.8.0
  - @byline/richtext-lexical@3.8.0
  - @byline/ui@3.8.0

## 3.7.0

### Minor Changes

- markdown export: added the one-way `lexicalToMarkdown` serializer (**`@byline/richtext-lexical/server`**) and the `documentToMarkdown` assembler + `fields.richText.toMarkdown` seam (**`@byline/core`**) — the agent-readable surface behind `.md` routes and `llms.txt` (see docs/MARKDOWN-EXPORT.md)

### Patch Changes

- Updated dependencies
  - @byline/core@3.7.0
  - @byline/richtext-lexical@3.7.0
  - @byline/ui@3.7.0

## 3.6.0

### Minor Changes

- create → edit: saving a new document now lands on its edit view instead of the collection list (**`@byline/host-tanstack-start`**); split **`@byline/core`**'s document-lifecycle service into per-operation modules (no behavioural change)

### Patch Changes

- Updated dependencies
  - @byline/core@3.6.0
  - @byline/richtext-lexical@3.6.0
  - @byline/ui@3.6.0

## 3.5.1

### Patch Changes

- updated admin forms to set an explicit post method
- Updated dependencies
  - @byline/core@3.5.1
  - @byline/richtext-lexical@3.5.1
  - @byline/ui@3.5.1

## 3.5.0

### Minor Changes

- reworked richtext admonitions for full markdown round-trip with doc-import detection; added responsive sizing and transparency to UI alerts

### Patch Changes

- Updated dependencies
  - @byline/core@3.5.0
  - @byline/richtext-lexical@3.5.0
  - @byline/ui@3.5.0

## 3.4.1

### Patch Changes

- fixed the **`@byline/richtext-lexical`** admonition markdown transformer so `:::note[Title]` directives convert in the as-you-type shortcut path (not just the source toggle)
- Updated dependencies
  - @byline/core@3.4.1
  - @byline/richtext-lexical@3.4.1
  - @byline/ui@3.4.1

## 3.4.0

### Minor Changes

- added a document-level markdown source toggle to the **`@byline/richtext-lexical`** editor, with table + admonition round-trip transformers
  fixed code blocks to scroll horizontally with a pinned line-number gutter instead of wrapping

### Patch Changes

- Updated dependencies
  - @byline/core@3.4.0
  - @byline/richtext-lexical@3.4.0
  - @byline/ui@3.4.0

## 3.3.1

### Patch Changes

- refined the immediate-save confirmation modal styling and layout
- Updated dependencies
  - @byline/core@3.3.1
  - @byline/richtext-lexical@3.3.1
  - @byline/ui@3.3.1

## 3.3.0

### Patch Changes

- Updated dependencies
  - @byline/core@3.3.0
  - @byline/richtext-lexical@3.3.0
  - @byline/ui@3.3.0

## 3.2.1

### Patch Changes

- removed lodash-es from the client bundle graph in `@byline/admin` and `@byline/richtext-lexical`, replacing it with local helpers to trim a transitive dependency
- Updated dependencies
  - @byline/core@3.2.1
  - @byline/richtext-lexical@3.2.1
  - @byline/ui@3.2.1

## 3.2.0

### Minor Changes

- added a lazy-loader form for collection and upload hooks (`hooks: () => import('./hooks.js')`) that keeps server-only hook code out of the isomorphic client bundle

### Patch Changes

- Updated dependencies
  - @byline/core@3.2.0
  - @byline/richtext-lexical@3.2.0
  - @byline/ui@3.2.0

## 3.1.1

### Patch Changes

- added `@byline/richtext-lexical/config` subpath for eager-light editor registration plus name-based extension toggling; fixed `availableLocales` reads to follow the configured content-locale order
- Updated dependencies
  - @byline/core@3.1.1
  - @byline/richtext-lexical@3.1.1
  - @byline/ui@3.1.1

## 3.1.0

### Minor Changes

- threaded the document's canonical (source-locale) `path` into the write-side collection hook contexts (`afterCreate`, `afterUpdate`, before/after `statusChange`, before/after `unpublish`, before/after `delete`) so cache-invalidation, CDN-purge, webhook, and search-reindex hooks can act on the specific document/URL

### Patch Changes

- Updated dependencies
- Updated dependencies [edd5228]
  - @byline/core@3.1.0
  - @byline/richtext-lexical@3.1.0
  - @byline/ui@3.1.0

## 3.0.2

### Patch Changes

- added a Delete Locale document action and an unsaved-changes prompt before guarded document actions
  fixed the locale badge on localized fields nested in blocks, groups, and arrays
- Updated dependencies
  - @byline/core@3.0.2
  - @byline/richtext-lexical@3.0.2
  - @byline/ui@3.0.2

## 3.0.1

### Patch Changes

- added an active-state cue to the richtext AI toolbar button and refined toolbar icon hover/active states (**`@byline/richtext-lexical`**, **`@byline/ai`**)
- Updated dependencies
  - @byline/core@3.0.1
  - @byline/richtext-lexical@3.0.1
  - @byline/ui@3.0.1

## 3.0.0

### Major Changes

- added switchable default content locale (per-document `source_locale`) and `availableLocales` editorial advertising with a sidebar widget, wired end-to-end through the read/write paths plus routable content-locale frontend routing
  squashed db migrations to a single 3.0 baseline with a migration guide and standalone upgrade SQL script

### Patch Changes

- Updated dependencies
  - @byline/core@3.0.0
  - @byline/richtext-lexical@3.0.0
  - @byline/ui@3.0.0

## 2.7.0

### Minor Changes

- added optional `i18n.content.localeDefinitions` for configuring per-content locale metadata

### Patch Changes

- Updated dependencies
  - @byline/core@2.7.0
  - @byline/richtext-lexical@2.7.0
  - @byline/ui@2.7.0

## 2.6.1

### Patch Changes

- fixed **`@byline/richtext-lexical`** inline-image modal layout and auto-filled alt-text from picked media
  improved **`@byline/ui`** shimmer skeleton contrast/sizing and added a `lineHeight` control
- Updated dependencies
  - @byline/core@2.6.1
  - @byline/richtext-lexical@2.6.1
  - @byline/ui@2.6.1

## 2.6.0

### Minor Changes

- shipped admin interface i18n — every shell surface renders in english/french with per-user locale preference
  moved document-editor forms/fields/widgets from **`@byline/ui`** into **`@byline/admin`**

### Patch Changes

- Updated dependencies
  - @byline/core@2.6.0
  - @byline/richtext-lexical@2.6.0
  - @byline/ui@2.6.0

## 2.5.2

### Patch Changes

- fixed `@byline/cli` install path: corrected phase ordering, moved the pnpm builds allow-list to `pnpm-workspace.yaml`, and floored `@byline/*` deps at `^2.5.0`
  `@byline/core` promoted `id` to a reserved document-level key in where clauses
- Updated dependencies
  - @byline/core@2.5.2
  - @byline/richtext-lexical@2.5.2
  - @byline/ui@2.5.2

## 2.5.1

### Patch Changes

- 7ed8425: fix(richtext-lexical): batched the link / inline-image populate fetch through `getDocumentsByDocumentIds` instead of `client.collection(...).find({ where: { id: { $in } } })`. `parseWhere` has no `id` handler, so the previous shape silently dropped the filter and returned arbitrary docs ordered by `created_at desc` — link embeds against any collection with more than one published doc could resolve to the wrong target (or trip the "internal link target not found" branch). Now mirrors the same adapter primitive relation populate already uses.
- Updated dependencies [7ed8425]
  - @byline/core@2.5.1
  - @byline/richtext-lexical@2.5.1
  - @byline/ui@2.5.1

## 2.5.0

### Minor Changes

- added a write-time richtext embed walker and `CollectionDefinition.buildDocumentPath` hook for canonical internal-link path composition in **`@byline/core`** and **`@byline/richtext-lexical`**
  rendered in-page anchors, tel:, and mailto: hrefs without the external-link affordance in the link serializer

### Patch Changes

- Updated dependencies
  - @byline/core@2.5.0
  - @byline/richtext-lexical@2.5.0
  - @byline/ui@2.5.0

## 2.4.4

### Patch Changes

- fixed select, autocomplete, and datepicker popovers rendering behind modal overlays
  removed `AutoLinkExtension` from `@byline/richtext-lexical` default extensions
- Updated dependencies
  - @byline/core@2.4.4
  - @byline/richtext-lexical@2.4.4
  - @byline/ui@2.4.4

## 2.4.3

### Patch Changes

- fixed **`@byline/cli`** seed phases not finding `BYLINE_JWT_SECRET` and other secrets in `.env.local` on fresh installs
- Updated dependencies
  - @byline/core@2.4.3
  - @byline/richtext-lexical@2.4.3
  - @byline/ui@2.4.3

## 2.4.2

### Patch Changes

- fixed **`@byline/cli`** persisting the Postgres superuser URL to `.byline-install.json` and pointed host-app env references at `.env.local`
- Updated dependencies
  - @byline/core@2.4.2
  - @byline/richtext-lexical@2.4.2
  - @byline/ui@2.4.2

## 2.4.1

### Patch Changes

- moved admin UI verticals into **`@byline/admin`** with per-vertical scoped exports, leaving **`@byline/ui`** as kit, form runtime, and shared widgets
  **`@byline/ui`** `DiffModal` now takes `loadHistoricalVersion` as a prop and lives at `widgets/diff-viewer` (decoupled from admin services)
- Updated dependencies
  - @byline/core@2.4.1
  - @byline/richtext-lexical@2.4.1
  - @byline/ui@2.4.1

## 2.4.0

### Minor Changes

- **`@byline/richtext-lexical`** lazy-loaded the editor module graph from `lexicalEditor()` so public-route consumers no longer ship the editor, and rendered a `Shimmer` skeleton in place of the editor while that chunk loads
  **`@byline/cli`** scaffold split the `_byline` pathless layout into `route.tsx` + `route.lazy.tsx` to keep admin chrome off public pages

### Patch Changes

- Updated dependencies
  - @byline/core@2.4.0
  - @byline/richtext-lexical@2.4.0
  - @byline/ui@2.4.0

## 2.3.3

### Patch Changes

- added optional Home link to the admin SignInForm and cleared the preview-mode cookie on admin sign-out
- Updated dependencies
  - @byline/core@2.3.3
  - @byline/richtext-lexical@2.3.3
  - @byline/ui@2.3.3

## 2.3.2

### Patch Changes

- fixed an unconditional session cookie clear in **`@byline/host-tanstack-start`** that emitted `Set-Cookie` on every anonymous request, causing CDN cache bypass on public pages
- Updated dependencies
  - @byline/core@2.3.2
  - @byline/richtext-lexical@2.3.2
  - @byline/ui@2.3.2

## 2.3.1

### Patch Changes

- fixed relation/file removal save crash in **`@byline/db-postgres`** and richtext caret-jump regression in **`@byline/richtext-lexical`**
- Updated dependencies
  - @byline/core@2.3.1
  - @byline/richtext-lexical@2.3.1
  - @byline/ui@2.3.1

## 2.3.0

### Minor Changes

- Upload progress indicators and redesigned image and field fields.

### Patch Changes

- Updated dependencies
  - @byline/ui@2.3.0
  - @byline/core@2.3.0
  - @byline/richtext-lexical@2.3.0

## 2.2.10

### Patch Changes

- storage-s3 ssr external in vite.config.ts
- Updated dependencies
  - @byline/core@2.2.10
  - @byline/richtext-lexical@2.2.10
  - @byline/ui@2.2.10

## 2.2.9

### Patch Changes

- gated markdown import-docs example script and deps behind an opt-in prompt
- Updated dependencies
  - @byline/core@2.2.9
  - @byline/richtext-lexical@2.2.9
  - @byline/ui@2.2.9

## 2.2.8

### Patch Changes

- Opened preview link in the current tab instead of a new tab. Added byline-icon.tsx to ui kit and updated admin bar. Removed year/month nesting from upload paths in s3 storage provider.
- Updated dependencies
  - @byline/ui@2.2.8
  - @byline/core@2.2.8
  - @byline/richtext-lexical@2.2.8

## 2.2.7

### Patch Changes

- feat(host-tanstack-start): collapsed breadcrumb overflow into a dropdown on narrow viewports
- Updated dependencies
  - @byline/core@2.2.7
  - @byline/richtext-lexical@2.2.7
  - @byline/ui@2.2.7

## 2.2.6

### Patch Changes

- Route progress indicator in admin shell. Admin shell mobile fixups.
- Updated dependencies
  - @byline/ui@2.2.6
  - @byline/core@2.2.6
  - @byline/richtext-lexical@2.2.6

## 2.2.5

### Patch Changes

- feat(richtext-lexical): scoped floating text-format popover to nested composers by default.
- Updated dependencies
  - @byline/richtext-lexical@2.2.5
  - @byline/core@2.2.5
  - @byline/ui@2.2.5

## 2.2.4

### Patch Changes

- exposed pg pool tuning via BYLINE_DB_POSTGRES_MAX_POOL / IDLE_TIMEOUT_MILLIS / CONNECTION_TIMEOUT_MILLIS
- Updated dependencies
  - @byline/core@2.2.4
  - @byline/richtext-lexical@2.2.4
  - @byline/ui@2.2.4

## 2.2.3

### Patch Changes

- .env vars and byline postgres connection string refactor.
- Updated dependencies
  - @byline/core@2.2.3
  - @byline/richtext-lexical@2.2.3
  - @byline/ui@2.2.3

## 2.2.2

### Patch Changes

- typed json/object/richText field data as JsonValue / JsonObject
- Updated dependencies
  - @byline/core@2.2.2
  - @byline/richtext-lexical@2.2.2
  - @byline/ui@2.2.2

## 2.2.1

### Patch Changes

- Fixed workflow status error in single status workflows. Updated CLI.
- Updated dependencies
  - @byline/core@2.2.1
  - @byline/richtext-lexical@2.2.1
  - @byline/ui@2.2.1

## 2.2.0

### Minor Changes

- Highlights

  - Counter field type — new allocator-assigned counter field that draws values from a shared group pool, perfect for cross-collection facet IDs (e.g.
    /library?t=1&t=4&t=9). Backed by Postgres sequences, registered automatically at boot, immutable after assignment, with structural validation
    banning counters inside array/blocks.
  - readOnly attribute on BaseField — render-time-only flag any field can declare to mount its widget in a non-editable state. Useful for computed
    values, externally-assigned IDs (DOIs, ISBNs), and workflow-locked fields. Honoured by NumericalField; other widgets will pick it up incrementally.
  - Unified audit timestamps — every created_at / updated_at column across the schema is now uniformly TIMESTAMPTZ(6) NOT NULL DEFAULT now(). Closes
    two pre-existing risks: locale-dependent reads on TIMESTAMP WITHOUT TIME ZONE, and ordering breaks from timestamp(0) second-truncation on fast
    writes. Single fresh migration (0000_cold_red_wolf.sql) collapses the previous two.
  - $in / $nin filter fix — field-level filters like where: { id: { $in: [...] } } now generate IN (...) SQL correctly. The previous shape emitted a
    row-constructor that Postgres rejected. Empty arrays short-circuit safely.

  CLI updates

  - Bundled migration template updated to the new single migration.
  - AI example wiring (@byline/ai) now ships out of the box on the news collection (title / summary / content). Six new AI files + the
    LexicalRichTextAi editor pattern + ai-plugin-text plugin demo. Five markdown-ingestion dev-deps added so byline/scripts/import-docs.ts runs cleanly
    in fresh installs.
  - Closed remaining example-tree drift against apps/webapp/byline (pages admin, media list view CSS, import-docs script + lib).
  - Interface locales now demo en + es to match where translations actually exist.

  Behaviour preserved

  All 169 integration tests, 591 unit tests, and the full typecheck stay green. No public-API breaks. The schema regen is non-destructive at the
  column-value level for any fresh install — but existing dev databases will need a pnpm db:init reset since the migration history changed.

### Patch Changes

- Updated dependencies
  - @byline/core@2.2.0
  - @byline/ui@2.2.0
  - @byline/richtext-lexical@2.2.0

## 2.1.3

### Patch Changes

- Updated CLI with new dep versions and @byline/ai package. Updated vite.config.ts
- Updated dependencies
  - @byline/core@2.1.3
  - @byline/richtext-lexical@2.1.3
  - @byline/ui@2.1.3

## 2.1.2

### Patch Changes

- fix(ai): clean dist before build to avoid shipping stale .js.map files.
- Updated dependencies
  - @byline/core@2.1.2
  - @byline/richtext-lexical@2.1.2
  - @byline/ui@2.1.2

## 2.1.1

### Patch Changes

- fix(ai): use relative imports inside package to prevent duplicate React context.
- Updated dependencies
  - @byline/core@2.1.1
  - @byline/richtext-lexical@2.1.1
  - @byline/ui@2.1.1

## 2.1.0

### Minor Changes

- AI package import fixes, CLI updates for db setup only.

### Patch Changes

- Updated dependencies
  - @byline/core@2.1.0
  - @byline/richtext-lexical@2.1.0
  - @byline/ui@2.1.0

## 2.0.2

### Patch Changes

- Minor fixes in core (mostly CI / test / lint setup)
- Updated dependencies
  - @byline/core@1.12.2
  - @byline/richtext-lexical@1.12.2
  - @byline/ui@1.12.2

## 2.0.1

### Patch Changes

- Simplified docs schema and admin examples, re-synced CLI templates.
- Updated dependencies
  - @byline/core@1.12.1
  - @byline/richtext-lexical@1.12.1
  - @byline/ui@1.12.1

## 2.0.0

### Minor Changes

- Richtext refactor to Lexical extensions API, extensibility, and updated docs.

### Patch Changes

- Updated dependencies
  - @byline/core@1.12.0
  - @byline/richtext-lexical@1.12.0
  - @byline/ui@1.12.0

## 1.11.2

### Patch Changes

- refactor(orderable): moved orderable flag from defineAdmin to defineCollection.
- Updated dependencies
  - @byline/core@1.11.2
  - @byline/ui@1.11.2

## 1.11.1

### Patch Changes

- Re-sync'd CLI deps and templates.
- Updated dependencies
  - @byline/core@1.11.1
  - @byline/ui@1.11.1

## 1.11.0

### Minor Changes

- Added orderable collections with drag-to-reorder list view.

### Patch Changes

- Updated dependencies
  - @byline/core@1.11.0
  - @byline/ui@1.11.0

## 1.10.3

### Patch Changes

- @byline/ui (patch)

  ▎ Fixed inline field error messages not appearing when fields mount after validation has already run (e.g. switching to a tab whose error badge is
  ▎ non-zero after a failed save). Also addressed fixups for the search and calendar widgets.

  @byline/ui (patch)

  ▎ Renamed infonomic-_ class prefixes to byline-_ across the UI kit (button, input, label, alert, toast, dropdown, etc.) so global override handles
  ▎ match the package name. Migration: consumers overriding kit styles via the .infonomic-_ global classes (e.g. .infonomic-button, .infonomic-input)
  ▎ need to update their selectors to the .byline-_ equivalents. Internal CSS-module class names are unchanged.

- Updated dependencies
  - @byline/core@1.10.3
  - @byline/ui@1.10.3

## 1.10.2

### Patch Changes

- New terminal state and revert to draft or published in form-renderer.
- Updated dependencies
  - @byline/core@1.10.2
  - @byline/ui@1.10.2

## 1.10.1

### Patch Changes

- Styling of Copy to Locale modal actions.
- Updated dependencies
  - @byline/ui@1.10.1
  - @byline/core@1.10.1

## 1.10.0

### Minor Changes

- Duplicate and Copy to Locale document lifecycle actions.

### Patch Changes

- Updated dependencies
  - @byline/core@1.10.0
  - @byline/ui@1.10.0

## 1.9.1

### Patch Changes

- AI package clean up. Removed Vercel SDK options, cleaned up logging and help modal.
- Updated dependencies
  - @byline/core@1.9.1
  - @byline/ui@1.9.1

## 1.9.0

### Minor Changes

- First phase of AI development - AI support in editable fields and richtext.

### Patch Changes

- Updated dependencies
  - @byline/ui@1.9.0

## 2.4.1

### Patch Changes

- f75938b: Updated deps.

## 2.4.0

### Minor Changes

- Select updates, model updates, and configuration updates.
