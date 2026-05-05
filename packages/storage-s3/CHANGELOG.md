# @byline/storage-s3

## 1.2.1

### Patch Changes

- 2859790: - @byline/host-tanstack-start — decoupled the host adapter from concrete DB and storage implementations. The host's source code no longer imports
  from @byline/db-postgres or @byline/storage-local; both have been removed from peerDependencies. Concrete adapters now arrive entirely through the BylineCore / ServerConfig DI seam, and the contract lives in TypeScript interfaces (IDbAdapter, IStorageProvider, AdminStore). Consumers can swap in @byline/storage-s3 (or future DB adapters) without the host needing to know.
  - @byline/core — added a new @byline/core/image subpath exporting the storage-agnostic image-processing helpers (extractImageMeta generateImageVariants, isBypassMimeType, plus the ImageMeta / ImageVariantResult / ProcessImageResult types). Adds sharp as a runtime dependency.
  - @byline/storage-local — breaking: removed the image-processor exports (extractImageMeta, generateImageVariants, isBypassMimeType, and their types). They have moved to @byline/core/image. The package now exports only localStorageProvider and its config type. sharp is no longer a dependency. Update imports from @byline/storage-local → @byline/core/image.
- Updated dependencies [2859790]
  - @byline/core@1.2.1

## 1.2.0

### Minor Changes

- 74a3013: - @byline/ui — consolidated the React entry surface. Standardised every consumer import on @byline/ui/react and removed the bare @byline/ui JS export from the exports map. The bare specifier now raises ERR_PACKAGE_PATH_NOT_EXPORTED; switch any external imports to @byline/ui/react. CSS subpath exports are unchanged.
  - Admin / document history — added a "make current" restore action on the document history view, letting an admin promote any prior version back to the current revision from the history UI.
  - @byline/db-postgres — fixed an EAV insert-boundary regression where datetime field values arriving as ISO strings (rather than Date instances) were rejected. The adapter now tolerates string-shaped date values and coerces them at the insert boundary.

### Patch Changes

- Updated dependencies [74a3013]
  - @byline/core@1.2.0

## 1.1.0

### Minor Changes

- a5127f5: Removed lodash-es and updated CLI deps. Collapsed @byline/ui exports to single /react entry. Renamed admin Row/Group/Tabs to AdminRow/AdminGroup/AdminTabs.

### Patch Changes

- Updated dependencies [a5127f5]
  - @byline/core@1.1.0

## 1.0.0

### Major Changes

- 002a29a: First major verison of Byline. Initial version of CLI.

### Patch Changes

- Updated dependencies [002a29a]
  - @byline/core@1.0.0

## 0.10.6

### Patch Changes

- d58a16f: Updated vite.config.ts configuration in webapp and CLI template.
- Updated dependencies [d58a16f]
  - @byline/core@0.10.6

## 0.10.5

### Patch Changes

- 7cae939: More work on experimental CLI
- 3185c48: More work on Nitro compatible vite.config.ts template.
- Updated dependencies [7cae939]
- Updated dependencies [3185c48]
  - @byline/core@0.10.5

## 0.10.4

### Patch Changes

- 74fc714: Fixups for nitro, and new \_byline pathless route.
- Updated dependencies [74fc714]
  - @byline/core@0.10.4

## 0.10.3

### Patch Changes

- Removed sourcemaps from outputs.
- Updated dependencies
  - @byline/core@0.10.3

## 0.10.2

### Patch Changes

- Fixups for packages exports.
- Updated dependencies
  - @byline/core@0.10.2

## 0.10.1

### Patch Changes

- 10bf19a: Re-publish with removed argon2 dependency. Experimental CLI.
- Updated dependencies [10bf19a]
  - @byline/core@0.10.1

## 0.10.0

### Minor Changes

- 0700fe2: Consolidated all UI components into a single @byline/ui UI kit.

### Patch Changes

- Updated dependencies [0700fe2]
  - @byline/core@0.10.0

## 0.9.3

### Patch Changes

- 9d546c3: Initial npm release.
- Updated dependencies [9d546c3]
  - @byline/core@0.9.3

## 0.9.2

### Patch Changes

- Changeset test.
- Updated dependencies
  - @byline/core@0.9.2
