# @infonomic/ai

## 2.2.6

### Patch Changes

- Route progress indicator in admin shell. Admin shell mobile fixups.
- Updated dependencies
  - @byline/ui@2.2.6
  - @byline/core@2.2.6
  - @byline/richtext-lexical@2.2.6

## 2.2.5

### Patch Changes

- feat(richtext-lexical): scoped floating text-format popover to nested composers by default.
- Updated dependencies
  - @byline/richtext-lexical@2.2.5
  - @byline/core@2.2.5
  - @byline/ui@2.2.5

## 2.2.4

### Patch Changes

- exposed pg pool tuning via BYLINE_DB_POSTGRES_MAX_POOL / IDLE_TIMEOUT_MILLIS / CONNECTION_TIMEOUT_MILLIS
- Updated dependencies
  - @byline/core@2.2.4
  - @byline/richtext-lexical@2.2.4
  - @byline/ui@2.2.4

## 2.2.3

### Patch Changes

- .env vars and byline postgres connection string refactor.
- Updated dependencies
  - @byline/core@2.2.3
  - @byline/richtext-lexical@2.2.3
  - @byline/ui@2.2.3

## 2.2.2

### Patch Changes

- typed json/object/richText field data as JsonValue / JsonObject
- Updated dependencies
  - @byline/core@2.2.2
  - @byline/richtext-lexical@2.2.2
  - @byline/ui@2.2.2

## 2.2.1

### Patch Changes

- Fixed workflow status error in single status workflows. Updated CLI.
- Updated dependencies
  - @byline/core@2.2.1
  - @byline/richtext-lexical@2.2.1
  - @byline/ui@2.2.1

## 2.2.0

### Minor Changes

- Highlights
  - Counter field type — new allocator-assigned counter field that draws values from a shared group pool, perfect for cross-collection facet IDs (e.g.
    /library?t=1&t=4&t=9). Backed by Postgres sequences, registered automatically at boot, immutable after assignment, with structural validation
    banning counters inside array/blocks.
  - readOnly attribute on BaseField — render-time-only flag any field can declare to mount its widget in a non-editable state. Useful for computed
    values, externally-assigned IDs (DOIs, ISBNs), and workflow-locked fields. Honoured by NumericalField; other widgets will pick it up incrementally.
  - Unified audit timestamps — every created_at / updated_at column across the schema is now uniformly TIMESTAMPTZ(6) NOT NULL DEFAULT now(). Closes
    two pre-existing risks: locale-dependent reads on TIMESTAMP WITHOUT TIME ZONE, and ordering breaks from timestamp(0) second-truncation on fast
    writes. Single fresh migration (0000_cold_red_wolf.sql) collapses the previous two.
  - $in / $nin filter fix — field-level filters like where: { id: { $in: [...] } } now generate IN (...) SQL correctly. The previous shape emitted a
    row-constructor that Postgres rejected. Empty arrays short-circuit safely.

  CLI updates
  - Bundled migration template updated to the new single migration.
  - AI example wiring (@byline/ai) now ships out of the box on the news collection (title / summary / content). Six new AI files + the
    LexicalRichTextAi editor pattern + ai-plugin-text plugin demo. Five markdown-ingestion dev-deps added so byline/scripts/import-docs.ts runs cleanly
    in fresh installs.
  - Closed remaining example-tree drift against apps/webapp/byline (pages admin, media list view CSS, import-docs script + lib).
  - Interface locales now demo en + es to match where translations actually exist.

  Behaviour preserved

  All 169 integration tests, 591 unit tests, and the full typecheck stay green. No public-API breaks. The schema regen is non-destructive at the
  column-value level for any fresh install — but existing dev databases will need a pnpm db:init reset since the migration history changed.

### Patch Changes

- Updated dependencies
  - @byline/core@2.2.0
  - @byline/ui@2.2.0
  - @byline/richtext-lexical@2.2.0

## 2.1.3

### Patch Changes

- Updated CLI with new dep versions and @byline/ai package. Updated vite.config.ts
- Updated dependencies
  - @byline/core@2.1.3
  - @byline/richtext-lexical@2.1.3
  - @byline/ui@2.1.3

## 2.1.2

### Patch Changes

- fix(ai): clean dist before build to avoid shipping stale .js.map files.
- Updated dependencies
  - @byline/core@2.1.2
  - @byline/richtext-lexical@2.1.2
  - @byline/ui@2.1.2

## 2.1.1

### Patch Changes

- fix(ai): use relative imports inside package to prevent duplicate React context.
- Updated dependencies
  - @byline/core@2.1.1
  - @byline/richtext-lexical@2.1.1
  - @byline/ui@2.1.1

## 2.1.0

### Minor Changes

- AI package import fixes, CLI updates for db setup only.

### Patch Changes

- Updated dependencies
  - @byline/core@2.1.0
  - @byline/richtext-lexical@2.1.0
  - @byline/ui@2.1.0

## 2.0.2

### Patch Changes

- Minor fixes in core (mostly CI / test / lint setup)
- Updated dependencies
  - @byline/core@1.12.2
  - @byline/richtext-lexical@1.12.2
  - @byline/ui@1.12.2

## 2.0.1

### Patch Changes

- Simplified docs schema and admin examples, re-synced CLI templates.
- Updated dependencies
  - @byline/core@1.12.1
  - @byline/richtext-lexical@1.12.1
  - @byline/ui@1.12.1

## 2.0.0

### Minor Changes

- Richtext refactor to Lexical extensions API, extensibility, and updated docs.

### Patch Changes

- Updated dependencies
  - @byline/core@1.12.0
  - @byline/richtext-lexical@1.12.0
  - @byline/ui@1.12.0

## 1.11.2

### Patch Changes

- refactor(orderable): moved orderable flag from defineAdmin to defineCollection.
- Updated dependencies
  - @byline/core@1.11.2
  - @byline/ui@1.11.2

## 1.11.1

### Patch Changes

- Re-sync'd CLI deps and templates.
- Updated dependencies
  - @byline/core@1.11.1
  - @byline/ui@1.11.1

## 1.11.0

### Minor Changes

- Added orderable collections with drag-to-reorder list view.

### Patch Changes

- Updated dependencies
  - @byline/core@1.11.0
  - @byline/ui@1.11.0

## 1.10.3

### Patch Changes

- @byline/ui (patch)

  ▎ Fixed inline field error messages not appearing when fields mount after validation has already run (e.g. switching to a tab whose error badge is
  ▎ non-zero after a failed save). Also addressed fixups for the search and calendar widgets.

  @byline/ui (patch)

  ▎ Renamed infonomic-_ class prefixes to byline-_ across the UI kit (button, input, label, alert, toast, dropdown, etc.) so global override handles
  ▎ match the package name. Migration: consumers overriding kit styles via the .infonomic-_ global classes (e.g. .infonomic-button, .infonomic-input)
  ▎ need to update their selectors to the .byline-_ equivalents. Internal CSS-module class names are unchanged.

- Updated dependencies
  - @byline/core@1.10.3
  - @byline/ui@1.10.3

## 1.10.2

### Patch Changes

- New terminal state and revert to draft or published in form-renderer.
- Updated dependencies
  - @byline/core@1.10.2
  - @byline/ui@1.10.2

## 1.10.1

### Patch Changes

- Styling of Copy to Locale modal actions.
- Updated dependencies
  - @byline/ui@1.10.1
  - @byline/core@1.10.1

## 1.10.0

### Minor Changes

- Duplicate and Copy to Locale document lifecycle actions.

### Patch Changes

- Updated dependencies
  - @byline/core@1.10.0
  - @byline/ui@1.10.0

## 1.9.1

### Patch Changes

- AI package clean up. Removed Vercel SDK options, cleaned up logging and help modal.
- Updated dependencies
  - @byline/core@1.9.1
  - @byline/ui@1.9.1

## 1.9.0

### Minor Changes

- First phase of AI development - AI support in editable fields and richtext.

### Patch Changes

- Updated dependencies
  - @byline/ui@1.9.0

## 2.4.1

### Patch Changes

- f75938b: Updated deps.

## 2.4.0

### Minor Changes

- Select updates, model updates, and configuration updates.
