# @byline/i18n

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
