# @byline/search-postgres

## 4.17.0

### Minor Changes

- added singleton document resources — a single named document slot with its own schema, lifecycle, typed client handle, and admin editor
  fixed dirty-state loss on failed form saves and corrected restore confirmation copy for single-status workflows

### Patch Changes

- Updated dependencies
  - @byline/core@4.17.0
  - @byline/search-analysis@4.17.0

## 4.16.0

### Minor Changes

- Analytics

### Patch Changes

- Updated dependencies
  - @byline/core@4.16.0
  - @byline/search-analysis@4.16.0

## 4.15.0

### Minor Changes

- added scheduled publication — arm, suspend on edit, re-confirm, and an operational admin queue — driven by a new in-process recurring-task scheduler
  added the MySQL scheduler adapter so both canonical adapters pass the shared conformance suite unchanged

### Patch Changes

- Updated dependencies
  - @byline/core@4.15.0
  - @byline/search-analysis@4.15.0

## 4.14.1

### Patch Changes

- fixed the admin dashboard showing a zero total for collections with stats turned off, and pinned the admin menu drawer so it stays in view while the admin area scrolls
- Updated dependencies
  - @byline/core@4.14.1
  - @byline/search-analysis@4.14.1

## 4.14.0

### Minor Changes

- added admin dashboard collection groups — an ordered `AdminConfig.collectionGroups` registry that collections join by key via `CollectionAdminConfig.group`, boot-validated and additive (omit it and the dashboard is unchanged)
  fixed the dashboard showing collections the administrator cannot read, which previously rendered every status tile as zero and was indistinguishable from an empty collection

### Patch Changes

- Updated dependencies
  - @byline/core@4.14.0
  - @byline/search-analysis@4.14.0

## 4.13.1

### Patch Changes

- fixed **`@byline/richtext-lexical`** inline-image previews serving a stale URL in the editor after an upload was re-keyed or regenerated
- Updated dependencies
  - @byline/core@4.13.1
  - @byline/search-analysis@4.13.1

## 4.13.0

### Minor Changes

- added a bundled Thai (`th`) admin interface locale to **`@byline/i18n`**
  fixed the admin route progress bar against TanStack Router's removal of `isTransitioning`

### Patch Changes

- Updated dependencies
  - @byline/core@4.13.0
  - @byline/search-analysis@4.13.0

## 4.12.0

### Patch Changes

- Updated dependencies [ae500fb]
- Updated dependencies [1a1c2d0]
- Updated dependencies [7df2278]
- Updated dependencies [c6ee4b5]
  - @byline/core@4.12.0
  - @byline/search-analysis@4.12.0

## 4.11.2

### Patch Changes

- fixed **`@byline/richtext-lexical`** and **`@byline/ai`** command payload types for lexical 0.49, including an inline-image enter handler that could throw on IME input

  **`@byline/cli`** wire prompt now names the vite.config.ts backup file

- Updated dependencies
  - @byline/core@4.11.2
  - @byline/search-analysis@4.11.2

## 4.11.1

### Patch Changes

- replaced classnames with clsx across all packages, fixing a cold-start vite optimizer error that broke admin modules in cli-installed apps
- Updated dependencies
  - @byline/core@4.11.1
  - @byline/search-analysis@4.11.1

## 4.11.0

### Minor Changes

- released document paths on soft delete so a new document can claim a deleted document's path, enforced live-only in **`@byline/db-postgres`** and **`@byline/db-mysql`**
  soft delete now retains uploaded sources and generated variants; existing installations must apply the numbered native `sql/` upgrade script for their provider

### Patch Changes

- Updated dependencies
- Updated dependencies [540b06f]
  - @byline/core@4.11.0
  - @byline/search-analysis@4.11.0

## 4.10.2

### Patch Changes

- fixed a fresh install failing to hydrate: use-sync-external-store is now installed as a host dependency, and `@byline/i18n/react` is pre-bundled so one <I18nProvider> instance serves the whole admin
  fixed `byline init` reporting an already-merged `vite.config.ts` as complete instead of bringing Byline-owned settings up to date
- Updated dependencies
  - @byline/core@4.10.2
  - @byline/search-analysis@4.10.2

## 4.10.1

### Patch Changes

- fixed `byline init` leaving a fresh TanStack Start app unable to boot, by merging Byline's required Vite settings into an existing `vite.config.ts`
  fixed scaffolded seed and import scripts hanging instead of exiting once their work committed
- Updated dependencies
  - @byline/core@4.10.1
  - @byline/search-analysis@4.10.1

## 4.10.0

### Minor Changes

- added MySQL as a first-class `byline init` / `byline setup` database choice, with per-adapter squashed baselines refused on any occupied database
  pinned `@byline/db-*` exactly to the CLI release carrying its baseline

### Patch Changes

- Updated dependencies
  - @byline/core@4.10.0
  - @byline/search-analysis@4.10.0

## 4.9.0

### Minor Changes

- added portable multilingual search analysis with built-in PostgreSQL and MySQL full-text providers, shared provider conformance, and original-text highlighted snippets
  hardened query analysis against quadratic identifier scanning and preserved SKU/version constituent recall
- 2ecdbcc: Replaced PostgreSQL-native term analysis with the shared portable
  multilingual analyzer and query plan. The adapter now supports all/any,
  minimum-should-match, phrases, protected identifiers, exact-preserving
  expansions, ordered Han-bigram fallback, and analyzer-fingerprint rebuild
  guards through one weighted `tsvector`. Ranked hits again include highlighted
  snippets, now produced from shared portable offsets rather than PostgreSQL's
  native analyzer.

  This is a direct cutover for the disposable search projection: reset the
  provider-owned search tables, apply the rewritten `0001_init.sql`, and rebuild
  published indexes. There is no native compatibility mode or in-place search
  migration. Fingerprint checks read the per-collection metadata projection
  instead of scanning indexed documents, including zone-scoped checks, and
  ranked pagination uses stable document tie-breaks.

### Patch Changes

- Updated dependencies
- Updated dependencies [635c16a]
- Updated dependencies [78726f3]
  - @byline/core@4.9.0
  - @byline/search-analysis@4.9.0

## 4.8.0

### Patch Changes

- Updated dependencies [7211479]
  - @byline/core@4.8.0

## 4.7.0

### Patch Changes

- Updated dependencies [f91732b]
  - @byline/core@4.7.0

## 4.6.2

### Patch Changes

- fixed the collection editor losing its return-to-list page and filters across the preview round-trip (**`@byline/host-tanstack-start`**)
  hardened the admin-preferences migration to reassign table ownership to the app role (**`@byline/db-postgres`**)
- Updated dependencies
  - @byline/core@4.6.2

## 4.6.1

### Patch Changes

- squashed the drizzle migration series into a single baseline migration and synced the `@byline/cli` scaffold template so fresh installs provision the `byline_admin_user_preferences` table
- Updated dependencies
  - @byline/core@4.6.1

## 4.6.0

### Minor Changes

- added per-user list-view preferences (page-size + sort persistence) and return-to-list editor state, backed by a new `byline_admin_user_preferences` table and admin-preferences module

### Patch Changes

- Updated dependencies
  - @byline/core@4.6.0

## 4.5.0

### Minor Changes

- added ComboButton menu icons, MarkdownIcon, and a dropdown anchor prop to `@byline/ui`
  fixed modal overlay-click dismissal and nested-heading anchor id derivation

### Patch Changes

- Updated dependencies
  - @byline/core@4.5.0

## 4.4.1

### Patch Changes

- fixed admin form paths losing their target after a block or array reorder — items are now addressed by stable id, so edits, conditions and deferred uploads follow their own item. **`FieldHookContext.path`** and hook `setFieldValue` paths now use `[id=…]` selectors instead of positional indices

  tightened field path validation in **`@byline/core`** — bracket characters are rejected in field and block names, and a malformed path is reported as malformed rather than as a wrong-dialect index

- Updated dependencies
  - @byline/core@4.4.1

## 4.4.0

### Minor Changes

- fixed upload fields declared inside blocks — **`@byline/admin`** now renders the drop zone and resolves `upload.context` against the addressed block
  added a shared field path grammar in **`@byline/core`**; boot now rejects unresolvable `search` config names and malformed patch paths

### Patch Changes

- Updated dependencies
  - @byline/core@4.4.0

## 4.3.0

### Minor Changes

- arrays inside blocks are now fully editable and drag-sortable, and dotted schema-path keys let field admin overrides reach nested declarations (`faq.answer`);
  fixed patch aliasing that duplicated array items added inside a just-added block, and array items now validate against their child field schemas

### Patch Changes

- Updated dependencies
  - @byline/core@4.3.0

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

## 4.1.0

### Minor Changes

- moved the typed server clients to `@byline/client/server` (Register declaration merge, `HostRequestBridge` seam in core) and app collection types to the new `@byline/generated-types` stub — codegen format 2, app-local `clients.server.ts` shim removed

### Patch Changes

- Updated dependencies
  - @byline/core@4.1.0

## 4.0.0

### Major Changes

- introduced a host-agnostic `ServerConfig.hooks` registry (server-only lifecycle/upload hooks leave portable schemas) and hardened read-authorization, tree, delete, and routing boundaries
  made the mandatory `IDbAdapter` transaction/audit contract, resolved `routes.signIn`, and request-stable `RequestContext` factories the v4 baseline

### Patch Changes

- Updated dependencies
  - @byline/core@4.0.0

## 3.21.0

### Minor Changes

- added **`@byline/client`** collection-type inference and a **`@byline/core`** deterministic type emitter for generating application collection types
  fixed hasMany relation, decimal, and file-size field-data types and canonicalized numeric writes across **`@byline/core`** / **`@byline/db-postgres`**

### Patch Changes

- Updated dependencies
  - @byline/core@3.21.0

## 3.20.4

### Patch Changes

- added `listSearch` schema key, decoupling admin list-view search from `search.body`
- Updated dependencies
  - @byline/core@3.20.4

## 3.20.3

### Patch Changes

- added configurable `defaultSort` for collection list views in **`@byline/admin`** and default padding for combo-button items in **`@byline/ui`**
- Updated dependencies
  - @byline/core@3.20.3

## 3.20.2

### Patch Changes

- added a rounded frame + below-frame help text to **`@byline/admin`** relation fields, and fixed **`@byline/richtext-lexical`** settings forwarding resurrecting a removed InlineImageExtension
- Updated dependencies
  - @byline/core@3.20.2

## 3.20.1

### Patch Changes

- fixed **`@byline/richtext-lexical`** merging field-level `editorConfig` over the registered editor config
- Updated dependencies
  - @byline/core@3.20.1

## 3.20.0

### Minor Changes

- added virtual fields — hooks-visible computed values that are never persisted to storage
  fixed array item removal silently no-opping so removed items reappeared on save

### Patch Changes

- Updated dependencies
  - @byline/core@3.20.0

## 3.19.0

### Minor Changes

- added full hook control over upload storage keys, upload context, and storage move/exists, plus scoped counters and a save-first upload gate

### Patch Changes

- Updated dependencies
  - @byline/core@3.19.0

## 3.18.0

### Patch Changes

- Updated dependencies [43d3d97]
  - @byline/core@3.18.0

## 3.17.1

### Patch Changes

- fixed upload fields nested in group/array/blocks — recursive upload-field discovery, upload transport resolution, and storage cleanup on delete
- Updated dependencies
  - @byline/core@3.17.1

## 3.17.0

### Minor Changes

- added conditional field visibility (`condition` on schema fields) and cross-field writes via the field-hook context's `setFieldValue`

### Patch Changes

- Updated dependencies
  - @byline/core@3.17.0

## 3.16.1

### Patch Changes

- fixed nested file/image uploads not rendering in array and group fields by threading `collectionPath` through
- Updated dependencies
  - @byline/core@3.16.1

## 3.16.0

### Minor Changes

- added cross-collection zone search + hydrate (`client.search({ zone })`) and row-level authorization on search; added `hasMany` multi-select relation picker and `$some` / `$every` / `$none` query quantifiers

### Patch Changes

- Updated dependencies
  - @byline/core@3.16.0

## 3.15.2

### Patch Changes

- fixed **`@byline/core`** `buildSearchDocument` so `search.body` entries that name a container field (`blocks` / `array` / `group`) are walked recursively, indexing nested richtext/text leaves — block-based prose was previously absent from the search index
- Updated dependencies
  - @byline/core@3.15.2

## 3.15.1

### Patch Changes

- fixed `@byline/search-postgres` `migrate()` crashing under a bundled production server (Nitro) by embedding its SQL — it previously read the `.sql` files relative to `import.meta.url`, which a bundle breaks (ENOENT on boot)
- Updated dependencies
  - @byline/core@3.15.1

## 3.15.0

### Minor Changes

- added full-text search: new `@byline/search-postgres` provider, the `SearchProvider` seam in `@byline/core`, `client.collection().search()`, lifecycle indexing + reindex, and the docs search frontend
  added the `lexicalToText` richtext extractor and generalised the relation `picker` config to `admin.itemView`

### Patch Changes

- Updated dependencies
  - @byline/core@3.15.0
