# @byline/analytics-postgres

## 5.1.3

### Patch Changes

- **`@byline/host-tanstack-start`** renewed expired admin sessions in place on admin navigation and recovered the public admin bar and preview mode after access expiry
  replaced the sign-in session check text with a spinner and styled its error states
- Updated dependencies
  - @byline/analytics@5.1.3

## 5.1.2

### Patch Changes

- Fixed **`@byline/db-postgres`**, **`@byline/analytics-postgres`** and **`@byline/search-postgres`** publishing `pg` types in their public declarations while `@types/pg` was only a devDependency, which left consumers with an untyped `pool` and implicit-any errors in their own code.
- Updated dependencies
  - @byline/analytics@5.1.2

## 5.1.1

### Patch Changes

- Styled and translated the account-mismatch session interstitial in **`@byline/host-tanstack-start`** — it now renders a centred card using the admin's own typography and colour tokens, with UI Kit buttons, across all eight admin locales.
- Updated dependencies
  - @byline/analytics@5.1.1

## 5.1.0

### Patch Changes

- @byline/analytics@5.1.0

## 5.0.0

### Patch Changes

- @byline/analytics@5.0.0

## 4.19.0

### Patch Changes

- @byline/analytics@4.19.0

## 4.18.0

### Minor Changes

- Added provider-neutral field-scoped full-text search queries with client pass-through
  
  Fixed the admin list pager so page changes scroll back to the top

### Patch Changes

- Updated dependencies
  - @byline/analytics@4.18.0

## 4.17.0

### Minor Changes

- added singleton document resources — a single named document slot with its own schema, lifecycle, typed client handle, and admin editor
  fixed dirty-state loss on failed form saves and corrected restore confirmation copy for single-status workflows

### Patch Changes

- Updated dependencies
  - @byline/analytics@4.17.0

## 4.16.0

### Minor Changes

- Analytics
- 4b94573: Add the portable privacy-focused analytics contract, browser agent, PostgreSQL and MySQL stores with independent numbered migrations, and the TanStack Start admin integration.

### Patch Changes

- Updated dependencies
- Updated dependencies [4b94573]
  - @byline/analytics@4.16.0

## 4.15.0

### Minor Changes

- added PostgreSQL storage, aggregation, query, retention, and driver-owned migrations for Byline analytics
