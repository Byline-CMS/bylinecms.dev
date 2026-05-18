# @infonomic/ai

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
