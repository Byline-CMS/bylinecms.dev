# @byline/generated-types

## 4.18.0

### Minor Changes

- Added provider-neutral field-scoped full-text search queries with client pass-through
  
  Fixed the admin list pager so page changes scroll back to the top

## 4.17.0

### Minor Changes

- added singleton document resources — a single named document slot with its own schema, lifecycle, typed client handle, and admin editor
  fixed dirty-state loss on failed form saves and corrected restore confirmation copy for single-status workflows

## 4.16.0

### Minor Changes

- Analytics

## 4.15.0

### Minor Changes

- added scheduled publication — arm, suspend on edit, re-confirm, and an operational admin queue — driven by a new in-process recurring-task scheduler
  added the MySQL scheduler adapter so both canonical adapters pass the shared conformance suite unchanged

## 4.14.1

### Patch Changes

- fixed the admin dashboard showing a zero total for collections with stats turned off, and pinned the admin menu drawer so it stays in view while the admin area scrolls

## 4.14.0

### Minor Changes

- added admin dashboard collection groups — an ordered `AdminConfig.collectionGroups` registry that collections join by key via `CollectionAdminConfig.group`, boot-validated and additive (omit it and the dashboard is unchanged)
  fixed the dashboard showing collections the administrator cannot read, which previously rendered every status tile as zero and was indistinguishable from an empty collection

## 4.13.1

### Patch Changes

- fixed **`@byline/richtext-lexical`** inline-image previews serving a stale URL in the editor after an upload was re-keyed or regenerated

## 4.13.0

### Minor Changes

- added a bundled Thai (`th`) admin interface locale to **`@byline/i18n`**
  fixed the admin route progress bar against TanStack Router's removal of `isTransitioning`

## 4.12.0

## 4.11.2

### Patch Changes

- fixed **`@byline/richtext-lexical`** and **`@byline/ai`** command payload types for lexical 0.49, including an inline-image enter handler that could throw on IME input

  **`@byline/cli`** wire prompt now names the vite.config.ts backup file

## 4.11.1

### Patch Changes

- replaced classnames with clsx across all packages, fixing a cold-start vite optimizer error that broke admin modules in cli-installed apps

## 4.11.0

### Minor Changes

- released document paths on soft delete so a new document can claim a deleted document's path, enforced live-only in **`@byline/db-postgres`** and **`@byline/db-mysql`**
  soft delete now retains uploaded sources and generated variants; existing installations must apply the numbered native `sql/` upgrade script for their provider

## 4.10.2

### Patch Changes

- fixed a fresh install failing to hydrate: use-sync-external-store is now installed as a host dependency, and `@byline/i18n/react` is pre-bundled so one <I18nProvider> instance serves the whole admin
  fixed `byline init` reporting an already-merged `vite.config.ts` as complete instead of bringing Byline-owned settings up to date

## 4.10.1

### Patch Changes

- fixed `byline init` leaving a fresh TanStack Start app unable to boot, by merging Byline's required Vite settings into an existing `vite.config.ts`
  fixed scaffolded seed and import scripts hanging instead of exiting once their work committed

## 4.10.0

### Minor Changes

- added MySQL as a first-class `byline init` / `byline setup` database choice, with per-adapter squashed baselines refused on any occupied database
  pinned `@byline/db-*` exactly to the CLI release carrying its baseline

## 4.9.0

### Minor Changes

- added portable multilingual search analysis with built-in PostgreSQL and MySQL full-text providers, shared provider conformance, and original-text highlighted snippets
  hardened query analysis against quadratic identifier scanning and preserved SKU/version constituent recall

## 4.8.0

## 4.7.0

## 4.6.2

### Patch Changes

- fixed the collection editor losing its return-to-list page and filters across the preview round-trip (**`@byline/host-tanstack-start`**)
  hardened the admin-preferences migration to reassign table ownership to the app role (**`@byline/db-postgres`**)

## 4.6.1

### Patch Changes

- squashed the drizzle migration series into a single baseline migration and synced the `@byline/cli` scaffold template so fresh installs provision the `byline_admin_user_preferences` table

## 4.6.0

### Minor Changes

- added per-user list-view preferences (page-size + sort persistence) and return-to-list editor state, backed by a new `byline_admin_user_preferences` table and admin-preferences module

## 4.5.0

### Minor Changes

- added ComboButton menu icons, MarkdownIcon, and a dropdown anchor prop to `@byline/ui`
  fixed modal overlay-click dismissal and nested-heading anchor id derivation

## 4.4.1

### Patch Changes

- fixed admin form paths losing their target after a block or array reorder — items are now addressed by stable id, so edits, conditions and deferred uploads follow their own item. **`FieldHookContext.path`** and hook `setFieldValue` paths now use `[id=…]` selectors instead of positional indices

  tightened field path validation in **`@byline/core`** — bracket characters are rejected in field and block names, and a malformed path is reported as malformed rather than as a wrong-dialect index

## 4.4.0

### Minor Changes

- fixed upload fields declared inside blocks — **`@byline/admin`** now renders the drop zone and resolves `upload.context` against the addressed block
  added a shared field path grammar in **`@byline/core`**; boot now rejects unresolvable `search` config names and malformed patch paths

## 4.3.0

### Minor Changes

- arrays inside blocks are now fully editable and drag-sortable, and dotted schema-path keys let field admin overrides reach nested declarations (`faq.answer`);
  fixed patch aliasing that duplicated array items added inside a just-added block, and array items now validate against their child field schemas

## 4.2.0

### Minor Changes

- added per-block admin config (`defineBlockAdmin`) and a dedicated `code` field with a CodeMirror 6 admin widget
  added `upload.location` storage scoping, friendly upload keys with a configurable filename slugifier, and `itemViewSort` for relation pickers

## 4.1.0

### Minor Changes

- moved the typed server clients to `@byline/client/server` (Register declaration merge, `HostRequestBridge` seam in core) and app collection types to the new `@byline/generated-types` stub — codegen format 2, app-local `clients.server.ts` shim removed
