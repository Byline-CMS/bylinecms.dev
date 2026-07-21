# @byline/i18n

## 4.6.0

### Minor Changes

- added per-user list-view preferences (page-size + sort persistence) and return-to-list editor state, backed by a new `byline_admin_user_preferences` table and admin-preferences module

### Patch Changes

- Updated dependencies
  - @byline/ui@4.6.0

## 4.5.0

### Minor Changes

- added ComboButton menu icons, MarkdownIcon, and a dropdown anchor prop to `@byline/ui`
  fixed modal overlay-click dismissal and nested-heading anchor id derivation

### Patch Changes

- Updated dependencies
  - @byline/ui@4.5.0

## 4.4.1

### Patch Changes

- fixed admin form paths losing their target after a block or array reorder — items are now addressed by stable id, so edits, conditions and deferred uploads follow their own item. **`FieldHookContext.path`** and hook `setFieldValue` paths now use `[id=…]` selectors instead of positional indices

  tightened field path validation in **`@byline/core`** — bracket characters are rejected in field and block names, and a malformed path is reported as malformed rather than as a wrong-dialect index

- Updated dependencies
  - @byline/ui@4.4.1

## 4.4.0

### Minor Changes

- fixed upload fields declared inside blocks — **`@byline/admin`** now renders the drop zone and resolves `upload.context` against the addressed block
  added a shared field path grammar in **`@byline/core`**; boot now rejects unresolvable `search` config names and malformed patch paths

### Patch Changes

- Updated dependencies
  - @byline/ui@4.4.0

## 4.3.0

### Minor Changes

- arrays inside blocks are now fully editable and drag-sortable, and dotted schema-path keys let field admin overrides reach nested declarations (`faq.answer`);
  fixed patch aliasing that duplicated array items added inside a just-added block, and array items now validate against their child field schemas

### Patch Changes

- Updated dependencies
  - @byline/ui@4.3.0

## 4.2.0

### Minor Changes

- added per-block admin config (`defineBlockAdmin`) and a dedicated `code` field with a CodeMirror 6 admin widget
  added `upload.location` storage scoping, friendly upload keys with a configurable filename slugifier, and `itemViewSort` for relation pickers

### Patch Changes

- Updated dependencies
  - @byline/ui@4.2.0

## 4.1.0

### Minor Changes

- moved the typed server clients to `@byline/client/server` (Register declaration merge, `HostRequestBridge` seam in core) and app collection types to the new `@byline/generated-types` stub — codegen format 2, app-local `clients.server.ts` shim removed

### Patch Changes

- Updated dependencies
  - @byline/ui@4.1.0

## 4.0.0

### Major Changes

- introduced a host-agnostic `ServerConfig.hooks` registry (server-only lifecycle/upload hooks leave portable schemas) and hardened read-authorization, tree, delete, and routing boundaries
  made the mandatory `IDbAdapter` transaction/audit contract, resolved `routes.signIn`, and request-stable `RequestContext` factories the v4 baseline

### Patch Changes

- Updated dependencies
  - @byline/ui@4.0.0

## 3.21.0

### Minor Changes

- added **`@byline/client`** collection-type inference and a **`@byline/core`** deterministic type emitter for generating application collection types
  fixed hasMany relation, decimal, and file-size field-data types and canonicalized numeric writes across **`@byline/core`** / **`@byline/db-postgres`**

### Patch Changes

- Updated dependencies
  - @byline/ui@3.21.0

## 3.20.4

### Patch Changes

- added `listSearch` schema key, decoupling admin list-view search from `search.body`
- Updated dependencies
  - @byline/ui@3.20.4

## 3.20.3

### Patch Changes

- added configurable `defaultSort` for collection list views in **`@byline/admin`** and default padding for combo-button items in **`@byline/ui`**
- Updated dependencies
  - @byline/ui@3.20.3

## 3.20.2

### Patch Changes

- added a rounded frame + below-frame help text to **`@byline/admin`** relation fields, and fixed **`@byline/richtext-lexical`** settings forwarding resurrecting a removed InlineImageExtension
- Updated dependencies
  - @byline/ui@3.20.2

## 3.20.1

### Patch Changes

- fixed **`@byline/richtext-lexical`** merging field-level `editorConfig` over the registered editor config
- Updated dependencies
  - @byline/ui@3.20.1

## 3.20.0

### Minor Changes

- added virtual fields — hooks-visible computed values that are never persisted to storage
  fixed array item removal silently no-opping so removed items reappeared on save

### Patch Changes

- Updated dependencies
  - @byline/ui@3.20.0

## 3.19.0

### Minor Changes

- added full hook control over upload storage keys, upload context, and storage move/exists, plus scoped counters and a save-first upload gate

### Patch Changes

- Updated dependencies
  - @byline/ui@3.19.0

## 3.18.0

### Patch Changes

- @byline/ui@3.18.0

## 3.17.1

### Patch Changes

- fixed upload fields nested in group/array/blocks — recursive upload-field discovery, upload transport resolution, and storage cleanup on delete
- Updated dependencies
  - @byline/ui@3.17.1

## 3.17.0

### Minor Changes

- added conditional field visibility (`condition` on schema fields) and cross-field writes via the field-hook context's `setFieldValue`

### Patch Changes

- Updated dependencies
  - @byline/ui@3.17.0

## 3.16.1

### Patch Changes

- fixed nested file/image uploads not rendering in array and group fields by threading `collectionPath` through
- Updated dependencies
  - @byline/ui@3.16.1

## 3.16.0

### Minor Changes

- added cross-collection zone search + hydrate (`client.search({ zone })`) and row-level authorization on search; added `hasMany` multi-select relation picker and `$some` / `$every` / `$none` query quantifiers

### Patch Changes

- Updated dependencies
  - @byline/ui@3.16.0

## 3.15.2

### Patch Changes

- fixed **`@byline/core`** `buildSearchDocument` so `search.body` entries that name a container field (`blocks` / `array` / `group`) are walked recursively, indexing nested richtext/text leaves — block-based prose was previously absent from the search index
- Updated dependencies
  - @byline/ui@3.15.2

## 3.15.1

### Patch Changes

- fixed `@byline/search-postgres` `migrate()` crashing under a bundled production server (Nitro) by embedding its SQL — it previously read the `.sql` files relative to `import.meta.url`, which a bundle breaks (ENOENT on boot)
- Updated dependencies
  - @byline/ui@3.15.1

## 3.15.0

### Minor Changes

- added full-text search: new `@byline/search-postgres` provider, the `SearchProvider` seam in `@byline/core`, `client.collection().search()`, lifecycle indexing + reindex, and the docs search frontend
  added the `lexicalToText` richtext extractor and generalised the relation `picker` config to `admin.itemView`

### Patch Changes

- Updated dependencies
  - @byline/ui@3.15.0

## 3.14.0

### Minor Changes

- added hasMany ordered multi-target relations — schema flag, indexed array storage, array-of-envelopes populate, and a drag-reorder/add/remove editor widget

### Patch Changes

- Updated dependencies
  - @byline/ui@3.14.0

## 3.13.3

### Patch Changes

- fixed admin theme switch being clobbered on navigation and blocks/array field items disappearing across tab switches
- Updated dependencies
  - @byline/ui@3.13.3

## 3.13.2

### Patch Changes

- refined `@byline/ui` prose typography — looser list-item spacing and primary-colored `ul` disc markers — plus normal-weight alert titles
- Updated dependencies
  - @byline/ui@3.13.2

## 3.13.1

### Patch Changes

- refined `@byline/ui` prose typography styles alongside docs index layout and prev/next css updates
- Updated dependencies
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
  - @byline/ui@3.13.0

## 3.12.2

### Patch Changes

- fixed a **`@byline/ui`** drawer console warning by wrapping the popup in Base UI's viewport; refactored the **`@byline/admin`** form-renderer / form-context internals (no behavioural change)
- Updated dependencies
  - @byline/ui@3.12.2

## 3.12.1

### Patch Changes

- **`@byline/richtext-lexical`** editor loading placeholder now renders a document-shaped skeleton (heading, paragraphs, image, sub-heading) instead of a flat block of shimmer rows
- Updated dependencies
  - @byline/ui@3.12.1

## 3.12.0

### Minor Changes

- added Spanish, German, Italian, Simplified Chinese and Korean admin interface translations, plus an account colour-theme switch (light/dark/system)
  localised the account preferences drawer and moved the language menu off Tailwind to a CSS module

### Patch Changes

- Updated dependencies
  - @byline/ui@3.12.0

## 3.11.3

### Patch Changes

- polished the admin shell UI — compact menu-drawer items now render as square icon buttons
- Updated dependencies
  - @byline/ui@3.11.3

## 3.11.2

### Patch Changes

- added the `/admin/activity` route to the **`@byline/cli`** scaffold template so a fresh `byline init` wires the system activity area — the template had every other admin route but not activity, so fresh installs rendered the Activity menu item yet 404'd on the route (existing apps add the one-line route file themselves)
- Updated dependencies
  - @byline/ui@3.11.2

## 3.11.1

### Patch Changes

- fixed **`@byline/admin`** packaging so the `admin-activity` subpath is exposed in `publishConfig.exports` — the v3.11.0 subpath was declared only in the top-level `exports`, so the published package omitted it and broke downstream production builds importing `@byline/admin/admin-activity`
- Updated dependencies
  - @byline/ui@3.11.1

## 3.11.0

### Minor Changes

- added the system activity area (`/admin/activity`) — a paged, filterable feed over the version-stream + audit-log union, gated by the new `admin.activity.read` ability (audit Workstream 4)
  added hover tooltips to the collapsed admin sidebar menu icons

### Patch Changes

- Updated dependencies
  - @byline/ui@3.11.0

## 3.10.1

### Patch Changes

- fixed a dev-only hydration crash from the use-sync-external-store CJS shim and made the **`@byline/db-postgres`** audit-log migration superuser-safe
  migrated host/webapp server fns off the deprecated `createServerFn().inputValidator()`
- Updated dependencies
  - @byline/ui@3.10.1

## 3.10.0

### Minor Changes

- added the document-grain audit log: atomic audit rows for status, deletion, path, and available-locale changes, a gated auditLog() read, and a tabbed document-history view

### Patch Changes

- Updated dependencies
  - @byline/ui@3.10.0

## 3.9.0

### Minor Changes

- added a request-scoped `withTransaction` capability to the Postgres adapter — multiple storage commands now commit or roll back atomically via AsyncLocalStorage propagation, with no transaction handle threaded through their signatures
  fixed a v3.8.0 regression where script/seed writes with a non-UUID actor (e.g. the docs import) crashed on the new `created_by` column — such system writes now persist NULL

### Patch Changes

- Updated dependencies
  - @byline/ui@3.9.0

## 3.8.0

### Minor Changes

- added a per-version audit trail — the acting user and action behind every document version — surfaced as an audit strip in the admin history view
  fixed the history view to derive its identity column from useAsTitle and to keep page-size changes on the history route

### Patch Changes

- Updated dependencies
  - @byline/ui@3.8.0

## 3.7.0

### Minor Changes

- markdown export: added the one-way `lexicalToMarkdown` serializer (**`@byline/richtext-lexical/server`**) and the `documentToMarkdown` assembler + `fields.richText.toMarkdown` seam (**`@byline/core`**) — the agent-readable surface behind `.md` routes and `llms.txt` (see docs/MARKDOWN-EXPORT.md)

### Patch Changes

- Updated dependencies
  - @byline/ui@3.7.0

## 3.6.0

### Minor Changes

- create → edit: saving a new document now lands on its edit view instead of the collection list (**`@byline/host-tanstack-start`**); split **`@byline/core`**'s document-lifecycle service into per-operation modules (no behavioural change)

### Patch Changes

- Updated dependencies
  - @byline/ui@3.6.0

## 3.5.1

### Patch Changes

- updated admin forms to set an explicit post method
- Updated dependencies
  - @byline/ui@3.5.1

## 3.5.0

### Minor Changes

- reworked richtext admonitions for full markdown round-trip with doc-import detection; added responsive sizing and transparency to UI alerts

### Patch Changes

- Updated dependencies
  - @byline/ui@3.5.0

## 3.4.1

### Patch Changes

- fixed the **`@byline/richtext-lexical`** admonition markdown transformer so `:::note[Title]` directives convert in the as-you-type shortcut path (not just the source toggle)
- Updated dependencies
  - @byline/ui@3.4.1

## 3.4.0

### Minor Changes

- added a document-level markdown source toggle to the **`@byline/richtext-lexical`** editor, with table + admonition round-trip transformers
  fixed code blocks to scroll horizontally with a pinned line-number gutter instead of wrapping

### Patch Changes

- Updated dependencies
  - @byline/ui@3.4.0

## 3.3.1

### Patch Changes

- refined the immediate-save confirmation modal styling and layout
- Updated dependencies
  - @byline/ui@3.3.1

## 3.3.0

### Patch Changes

- @byline/ui@3.3.0

## 3.2.1

### Patch Changes

- removed lodash-es from the client bundle graph in `@byline/admin` and `@byline/richtext-lexical`, replacing it with local helpers to trim a transitive dependency
- Updated dependencies
  - @byline/ui@3.2.1

## 3.2.0

### Minor Changes

- added a lazy-loader form for collection and upload hooks (`hooks: () => import('./hooks.js')`) that keeps server-only hook code out of the isomorphic client bundle

### Patch Changes

- Updated dependencies
  - @byline/ui@3.2.0

## 3.1.1

### Patch Changes

- added `@byline/richtext-lexical/config` subpath for eager-light editor registration plus name-based extension toggling; fixed `availableLocales` reads to follow the configured content-locale order
- Updated dependencies
  - @byline/ui@3.1.1

## 3.1.0

### Minor Changes

- threaded the document's canonical (source-locale) `path` into the write-side collection hook contexts (`afterCreate`, `afterUpdate`, before/after `statusChange`, before/after `unpublish`, before/after `delete`) so cache-invalidation, CDN-purge, webhook, and search-reindex hooks can act on the specific document/URL

### Patch Changes

- Updated dependencies
  - @byline/ui@3.1.0

## 3.0.2

### Patch Changes

- added a Delete Locale document action and an unsaved-changes prompt before guarded document actions
  fixed the locale badge on localized fields nested in blocks, groups, and arrays
- Updated dependencies
  - @byline/ui@3.0.2

## 3.0.1

### Patch Changes

- added an active-state cue to the richtext AI toolbar button and refined toolbar icon hover/active states (**`@byline/richtext-lexical`**, **`@byline/ai`**)
- Updated dependencies
  - @byline/ui@3.0.1

## 3.0.0

### Major Changes

- added switchable default content locale (per-document `source_locale`) and `availableLocales` editorial advertising with a sidebar widget, wired end-to-end through the read/write paths plus routable content-locale frontend routing
  squashed db migrations to a single 3.0 baseline with a migration guide and standalone upgrade SQL script

### Patch Changes

- Updated dependencies
  - @byline/ui@3.0.0

## 2.7.0

### Minor Changes

- added optional `i18n.content.localeDefinitions` for configuring per-content locale metadata

### Patch Changes

- Updated dependencies
  - @byline/ui@2.7.0

## 2.6.1

### Patch Changes

- fixed **`@byline/richtext-lexical`** inline-image modal layout and auto-filled alt-text from picked media
  improved **`@byline/ui`** shimmer skeleton contrast/sizing and added a `lineHeight` control
- Updated dependencies
  - @byline/ui@2.6.1

## 2.6.0

### Minor Changes

- shipped admin interface i18n — every shell surface renders in english/french with per-user locale preference
  moved document-editor forms/fields/widgets from **`@byline/ui`** into **`@byline/admin`**

### Patch Changes

- Updated dependencies
  - @byline/ui@2.6.0
