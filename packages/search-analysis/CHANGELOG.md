# @byline/search-analysis

## 6.1.0

### Minor Changes

- added `CollectionAdminConfig.lockPath` — a collection can declare its document paths managed, rendering the admin path widget read-only in both create and edit mode

### Patch Changes

- Updated dependencies
  - @byline/core@6.1.0

## 6.0.3

### Patch Changes

- fixed admin list sort direction in **`@byline/host-tanstack-start`** when the host router preserves URL search values as strings — `desc=false` now reads as ascending in collection, admin-user, and version-history lists
- Updated dependencies
  - @byline/core@6.0.3

## 6.0.2

### Patch Changes

- fixed field-level list sort direction on tied and empty values in **`@byline/db-postgres`** and **`@byline/db-mysql`**
  added an analytics timeseries hover card and a sticky per-user dashboard period
- Updated dependencies
  - @byline/core@6.0.2

## 6.0.1

### Patch Changes

- **`@byline/ui`** stopped publishing the `development` export condition, which pointed consumers at TypeScript source inside `node_modules`
- Updated dependencies
  - @byline/core@6.0.1

## 6.0.0

### Major Changes

- **`@byline/richtext-lexical`** made a field's resolved editor decide which structures it accepts, adapting stored content on load
  **`@byline/search-postgres`** repaired installations left without the search index metadata table

### Patch Changes

- Updated dependencies
  - @byline/core@6.0.0

## 5.2.0

### Minor Changes

- refreshed **`@byline/ai`**'s curated provider model lists to the current text-handling generations — each provider now offers a flagship, balanced, and low-cost option, with new defaults
  
  fixed the release publish script so a failed `npm publish` propagates out instead of reporting success

### Patch Changes

- Updated dependencies
  - @byline/core@5.2.0

## 5.1.4

### Patch Changes

- **`@byline/admin`** capped analytics dashboard cards at ten rows with a paged view-all dialog and localised country names
- Updated dependencies
  - @byline/core@5.1.4

## 5.1.3

### Patch Changes

- **`@byline/host-tanstack-start`** renewed expired admin sessions in place on admin navigation and recovered the public admin bar and preview mode after access expiry
  replaced the sign-in session check text with a spinner and styled its error states
- Updated dependencies
  - @byline/core@5.1.3

## 5.1.2

### Patch Changes

- Fixed **`@byline/db-postgres`**, **`@byline/analytics-postgres`** and **`@byline/search-postgres`** publishing `pg` types in their public declarations while `@types/pg` was only a devDependency, which left consumers with an untyped `pool` and implicit-any errors in their own code.
- Updated dependencies
  - @byline/core@5.1.2

## 5.1.1

### Patch Changes

- Styled and translated the account-mismatch session interstitial in **`@byline/host-tanstack-start`** — it now renders a centred card using the admin's own typography and colour tokens, with UI Kit buttons, across all eight admin locales.
- Updated dependencies
  - @byline/core@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [4d02070]
  - @byline/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [f8ece18]
  - @byline/core@5.0.0

## 4.19.0

### Patch Changes

- Updated dependencies [ff1c416]
- Updated dependencies [ff1c416]
  - @byline/core@4.19.0

## 4.18.0

### Minor Changes

- Added provider-neutral field-scoped full-text search queries with client pass-through
  
  Fixed the admin list pager so page changes scroll back to the top

### Patch Changes

- Updated dependencies
  - @byline/core@4.18.0

## 4.17.0

### Minor Changes

- added singleton document resources — a single named document slot with its own schema, lifecycle, typed client handle, and admin editor
  fixed dirty-state loss on failed form saves and corrected restore confirmation copy for single-status workflows

### Patch Changes

- Updated dependencies
  - @byline/core@4.17.0

## 4.16.0

### Minor Changes

- Analytics

### Patch Changes

- Updated dependencies
  - @byline/core@4.16.0

## 4.15.0

### Minor Changes

- added scheduled publication — arm, suspend on edit, re-confirm, and an operational admin queue — driven by a new in-process recurring-task scheduler
  added the MySQL scheduler adapter so both canonical adapters pass the shared conformance suite unchanged

### Patch Changes

- Updated dependencies
  - @byline/core@4.15.0

## 4.14.1

### Patch Changes

- fixed the admin dashboard showing a zero total for collections with stats turned off, and pinned the admin menu drawer so it stays in view while the admin area scrolls
- Updated dependencies
  - @byline/core@4.14.1

## 4.14.0

### Minor Changes

- added admin dashboard collection groups — an ordered `AdminConfig.collectionGroups` registry that collections join by key via `CollectionAdminConfig.group`, boot-validated and additive (omit it and the dashboard is unchanged)
  fixed the dashboard showing collections the administrator cannot read, which previously rendered every status tile as zero and was indistinguishable from an empty collection

### Patch Changes

- Updated dependencies
  - @byline/core@4.14.0

## 4.13.1

### Patch Changes

- fixed **`@byline/richtext-lexical`** inline-image previews serving a stale URL in the editor after an upload was re-keyed or regenerated
- Updated dependencies
  - @byline/core@4.13.1

## 4.13.0

### Minor Changes

- added a bundled Thai (`th`) admin interface locale to **`@byline/i18n`**
  fixed the admin route progress bar against TanStack Router's removal of `isTransitioning`

### Patch Changes

- Updated dependencies
  - @byline/core@4.13.0

## 4.12.0

### Patch Changes

- Updated dependencies [ae500fb]
- Updated dependencies [1a1c2d0]
- Updated dependencies [7df2278]
- Updated dependencies [c6ee4b5]
  - @byline/core@4.12.0

## 4.11.2

### Patch Changes

- fixed **`@byline/richtext-lexical`** and **`@byline/ai`** command payload types for lexical 0.49, including an inline-image enter handler that could throw on IME input

  **`@byline/cli`** wire prompt now names the vite.config.ts backup file

- Updated dependencies
  - @byline/core@4.11.2

## 4.11.1

### Patch Changes

- replaced classnames with clsx across all packages, fixing a cold-start vite optimizer error that broke admin modules in cli-installed apps
- Updated dependencies
  - @byline/core@4.11.1

## 4.11.0

### Minor Changes

- released document paths on soft delete so a new document can claim a deleted document's path, enforced live-only in **`@byline/db-postgres`** and **`@byline/db-mysql`**
  soft delete now retains uploaded sources and generated variants; existing installations must apply the numbered native `sql/` upgrade script for their provider

### Patch Changes

- Updated dependencies
- Updated dependencies [540b06f]
  - @byline/core@4.11.0

## 4.10.2

### Patch Changes

- fixed a fresh install failing to hydrate: use-sync-external-store is now installed as a host dependency, and `@byline/i18n/react` is pre-bundled so one <I18nProvider> instance serves the whole admin
  fixed `byline init` reporting an already-merged `vite.config.ts` as complete instead of bringing Byline-owned settings up to date
- Updated dependencies
  - @byline/core@4.10.2

## 4.10.1

### Patch Changes

- fixed `byline init` leaving a fresh TanStack Start app unable to boot, by merging Byline's required Vite settings into an existing `vite.config.ts`
  fixed scaffolded seed and import scripts hanging instead of exiting once their work committed
- Updated dependencies
  - @byline/core@4.10.1

## 4.10.0

### Minor Changes

- added MySQL as a first-class `byline init` / `byline setup` database choice, with per-adapter squashed baselines refused on any occupied database
  pinned `@byline/db-*` exactly to the CLI release carrying its baseline

### Patch Changes

- Updated dependencies
  - @byline/core@4.10.0

## 4.9.0

### Minor Changes

- added portable multilingual search analysis with built-in PostgreSQL and MySQL full-text providers, shared provider conformance, and original-text highlighted snippets
  hardened query analysis against quadratic identifier scanning and preserved SKU/version constituent recall
- 635c16a: Added provider-neutral full-text matching contracts and
  `@byline/search-analysis`, a portable multilingual analysis and query-planning
  package. The analyzer preserves exact terms, validates locale declarations,
  uses ICU word boundaries, protects domain identifiers, emits optional
  language-specific variants and Han bigrams, and records a stable fingerprint
  for reindex decisions. It also builds bounded, original-text highlighted
  snippets from the same portable token offsets. Collection and zone search now
  pass explicit all/any, minimum-should-match, and phrase intent to search
  providers. Search providers must declare their full-text capabilities and
  implement index clearing so every derived projection remains explicitly
  rebuildable. Query analysis rejects inputs above the shared 1,024-code-unit
  limit, identifier extraction remains linear on long unbroken text, and
  SKU/version constituents augment their complete identifier at one logical
  position instead of being removed from recall.

### Patch Changes

- Updated dependencies
- Updated dependencies [635c16a]
- Updated dependencies [78726f3]
  - @byline/core@4.9.0
