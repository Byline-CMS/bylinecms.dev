# @byline/search-postgres

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
