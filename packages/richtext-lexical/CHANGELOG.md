# @byline/richtext-lexical

## 1.2.0

### Minor Changes

- 74a3013: - @byline/ui — consolidated the React entry surface. Standardised every consumer import on @byline/ui/react and removed the bare @byline/ui JS export from the exports map. The bare specifier now raises ERR_PACKAGE_PATH_NOT_EXPORTED; switch any external imports to @byline/ui/react. CSS subpath exports are unchanged.
  - Admin / document history — added a "make current" restore action on the document history view, letting an admin promote any prior version back to the current revision from the history UI.
  - @byline/db-postgres — fixed an EAV insert-boundary regression where datetime field values arriving as ISO strings (rather than Date instances) were rejected. The adapter now tolerates string-shaped date values and coerces them at the insert boundary.

### Patch Changes

- Updated dependencies [74a3013]
  - @byline/client@1.2.0
  - @byline/core@1.2.0
  - @byline/ui@1.2.0

## 1.1.0

### Minor Changes

- a5127f5: Removed lodash-es and updated CLI deps. Collapsed @byline/ui exports to single /react entry. Renamed admin Row/Group/Tabs to AdminRow/AdminGroup/AdminTabs.

### Patch Changes

- Updated dependencies [a5127f5]
  - @byline/ui@1.1.0
  - @byline/client@1.1.0
  - @byline/core@1.1.0

## 1.0.0

### Major Changes

- 002a29a: First major verison of Byline. Initial version of CLI.

### Patch Changes

- Updated dependencies [002a29a]
  - @byline/client@1.0.0
  - @byline/core@1.0.0
  - @byline/ui@1.0.0

## 0.10.6

### Patch Changes

- d58a16f: Updated vite.config.ts configuration in webapp and CLI template.
- Updated dependencies [d58a16f]
  - @byline/client@0.10.6
  - @byline/core@0.10.6
  - @byline/ui@0.10.6

## 0.10.5

### Patch Changes

- 7cae939: More work on experimental CLI
- 3185c48: More work on Nitro compatible vite.config.ts template.
- Updated dependencies [7cae939]
- Updated dependencies [3185c48]
  - @byline/client@0.10.5
  - @byline/core@0.10.5
  - @byline/ui@0.10.5

## 0.10.4

### Patch Changes

- 74fc714: Fixups for nitro, and new \_byline pathless route.
- Updated dependencies [74fc714]
  - @byline/client@0.10.4
  - @byline/core@0.10.4
  - @byline/ui@0.10.4

## 0.10.3

### Patch Changes

- Removed sourcemaps from outputs.
- Updated dependencies
  - @byline/client@0.10.3
  - @byline/core@0.10.3
  - @byline/ui@0.10.3

## 0.10.2

### Patch Changes

- Fixups for packages exports.
- Updated dependencies
  - @byline/client@0.10.2
  - @byline/core@0.10.2
  - @byline/ui@0.10.2

## 0.10.1

### Patch Changes

- 10bf19a: Re-publish with removed argon2 dependency. Experimental CLI.
- Updated dependencies [10bf19a]
  - @byline/client@0.10.1
  - @byline/core@0.10.1
  - @byline/ui@0.10.1

## 0.10.0

### Minor Changes

- 0700fe2: Consolidated all UI components into a single @byline/ui UI kit.

### Patch Changes

- Updated dependencies [0700fe2]
  - @byline/client@0.10.0
  - @byline/core@0.10.0
  - @byline/ui@0.10.0

## 0.9.3

### Patch Changes

- 9d546c3: Initial npm release.
- Updated dependencies [9d546c3]
  - @byline/client@0.9.3
  - @byline/core@0.9.3
  - @byline/ui@0.9.3
