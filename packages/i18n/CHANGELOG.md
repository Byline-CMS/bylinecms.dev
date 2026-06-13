# @byline/i18n

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
