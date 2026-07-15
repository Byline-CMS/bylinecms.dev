# @byline/search-postgres

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
