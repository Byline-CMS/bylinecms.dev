# @byline/cli

## 2.1.2

### Patch Changes

- fix(ai): clean dist before build to avoid shipping stale .js.map files.

## 2.1.1

### Patch Changes

- fix(ai): use relative imports inside package to prevent duplicate React context.

## 2.1.0

### Minor Changes

- AI package import fixes, CLI updates for db setup only.

## 1.12.2

### Patch Changes

- Minor fixes in core (mostly CI / test / lint setup)

## 1.12.1

### Patch Changes

- Simplified docs schema and admin examples, re-synced CLI templates.

## 1.12.0

### Minor Changes

- Richtext refactor to Lexical extensions API, extensibility, and updated docs.

## 1.11.2

### Patch Changes

- refactor(orderable): moved orderable flag from defineAdmin to defineCollection.

## 1.11.1

### Patch Changes

- Re-sync'd CLI deps and templates.

## 1.11.0

### Minor Changes

- Added orderable collections with drag-to-reorder list view.

## 1.10.3

### Patch Changes

- @byline/ui (patch)

  ▎ Fixed inline field error messages not appearing when fields mount after validation has already run (e.g. switching to a tab whose error badge is
  ▎ non-zero after a failed save). Also addressed fixups for the search and calendar widgets.

  @byline/ui (patch)

  ▎ Renamed infonomic-_ class prefixes to byline-_ across the UI kit (button, input, label, alert, toast, dropdown, etc.) so global override handles
  ▎ match the package name. Migration: consumers overriding kit styles via the .infonomic-_ global classes (e.g. .infonomic-button, .infonomic-input)
  ▎ need to update their selectors to the .byline-_ equivalents. Internal CSS-module class names are unchanged.

## 1.10.2

### Patch Changes

- New terminal state and revert to draft or published in form-renderer.

## 1.10.1

### Patch Changes

- Styling of Copy to Locale modal actions.

## 1.10.0

### Minor Changes

- Duplicate and Copy to Locale document lifecycle actions.

## 1.9.1

### Patch Changes

- AI package clean up. Removed Vercel SDK options, cleaned up logging and help modal.

## 1.9.0

### Minor Changes

- First phase of AI development - AI support in editable fields and richtext.

## 1.8.2

### Patch Changes

- Sweep, clean, refactor and docs.

## 1.8.1

### Patch Changes

- isolation: isolate - for base UI context stacking

## 1.8.0

### Minor Changes

- feat — Per-collection path uniqueness, enforced at the database level.

  path has been promoted out of byline_document_versions into a dedicated byline_document_paths table keyed by (document_id, locale) with a unique
  constraint on (collection_id, locale, path). Two documents in the same collection can no longer share a path within the same locale.

  Storage adapter
  - pgAdapter() now requires defaultContentLocale (sourced from ServerConfig.i18n.content.defaultLocale).
  - Reads resolve path through a [requested, default] locale fallback chain via a single subquery — no double round-trips.
  - findByPath, list projections, and the relation-filter compiler all flow through the new path-resolution helpers.
  - current_documents / current_published_documents views no longer project path — locale is request-scoped, not view-scoped.

  Lifecycle
  - New ERR_PATH_CONFLICT error type. Postgres unique-violations on the path index are translated to it (walks the Drizzle / pg cause chain).
  - Translation-locale (locale !== defaultLocale) writes drop params.path silently with a logger.warn — phase 1 keeps paths default-locale territory;
    the existing path row is left untouched. The save proceeds normally.
  - restoreDocumentVersion no longer touches the path row (the existing row is sticky).

  @byline/client
  - Read methods default locale to the client's resolved defaultContentLocale instead of a hardcoded 'en'. Works correctly for non-'en' installations.

  Path widget
  - Renders read-only when editing a non-default content locale, with a help-text line explaining why. Prevents the lifecycle's translation-locale
    warn-and-drop being hit through the admin form.

  Schema reset
  - All prior migrations (0000–0003) collapsed into a single unified 0000_hard_madame_hydra.sql. CLI templates synced. No production installations
    exist; this is a clean reset.

  Tests
  - New integration tests in packages/db-postgres/src/modules/storage/tests/storage-document-paths.test.ts cover collision rejection, self-upsert
    idempotency, in-place path update, locale fallback in reads, and null-on-no-match.
  - New lifecycle tests in packages/core/src/services/document-lifecycle.test.node.ts cover translation-locale warn + drop, idempotent same-path
    no-warn, ERR_PATH_CONFLICT translation, and non-23505 rethrow.

  Docs
  - docs/DOCUMENT-PATHS.md rewritten to reflect the shipped model. Per-locale-paths phase reframed as purely additive (schema is already
    locale-keyed). Stale "Path uniqueness — decision and policy" entry removed from docs/TODO.md.

  Breaking changes
  - pgAdapter({ ... }) requires the new defaultContentLocale: string argument. Installations must add defaultContentLocale: i18n.content.defaultLocale
    to their server.config.ts.
  - byline_document_versions.path column has been dropped; downstream consumers reading it directly will need to query byline_document_paths (or use
    the storage adapter's read methods which transparently project it).

## 1.7.7

### Patch Changes

- Reordered @layer cascade so typography sits below components and utils are highest precedence.

## 1.7.6

### Patch Changes

- Reordered cascade layers so theme sits below components.

## 1.7.5

### Patch Changes

- Inlined formatNumber helper in example media list view (webapp and cli template).

## 1.7.4

### Patch Changes

- Migrated example media list and thumbnail views to CSS modules, updated CLI templates, and fixed up image field label and helptext.

## 1.7.3

### Patch Changes

- Correct byline-ui scoped container divs in webapp and cli templates.

## 1.7.2

### Patch Changes

- Scoped byline-ui to .byline-ui boundary and pinned cascade-layer order with tailwind. Updated cli template media list view.

## 1.7.1

### Patch Changes

- Served uploads at runtime when using the local storage provider so new files appear without a rebuild.

## 1.7.0

### Minor Changes

- Correct thumbnail rendering from variants and new lightbox widget.

## 1.6.2

### Patch Changes

- Bundle analyzer and updated cli/manifest deps to include sharp.

## 1.6.1

### Patch Changes

- Updated CLI templates.

## 1.6.0

### Minor Changes

- - Lenient document reconstruction (@byline/client, @byline/db-postgres, @byline/ui): the admin edit path now does a best-effort reconstruction of
    documents even when stored data is partially inconsistent, rather than failing hard. The form renderer gracefully handles missing or mismatched
    field data.
    - SelectField label fix (@byline/ui): field.label was not being rendered; fixed.
    - Pages preview URLs (webapp): pages collection now supports area-based preview URLs, with new public routes for /about/:slug and /legal/:slug.
      Example collection schemas updated accordingly.

## 1.4.0

### Minor Changes

- be3a5ee: New: defineField helper (feat(core))
  Mirror of defineCollection / defineBlock for single fields. Locks in literal types when a field is authored outside a fields: [...] array — useful
  for fields shared across multiple collections, or for surfacing definition-site type errors without waiting for placement. Replaces the as const
  satisfies Field pattern. Companion publishedOnField factory now lives in apps/webapp/byline/fields/ and replaces three inline copies in the docs,
  news, and pages schemas.

  Internal: shared field-tree walker (refactor(core))
  Extracted walkFieldTree (in packages/core/src/services/) plus tests, and rebuilt both populate (relation traversal) and richtext-populate on top.
  ~120 lines of duplicated traversal logic deleted; behaviour-preserving. Sets up future field-walking surfaces (validation, indexing, beforeRead
  scoping) to share one tree-walk implementation.

  Tightened: CollectionAdminConfig.preview contract (refactor(core))
  Removed the unused populate?: PopulateSpec option from the preview block — it was declared but never consumed by any loader. Documented what is
  actually available on doc inside preview.url(...): top-level columns (including the reserved path), every source-collection field under doc.fields,
  and direct relation targets via the edit view's blanket depth-1 populate (picker projection). The four seeded admin configs (docs, news, pages,
  media) updated to match.

  ▎ ⚠️ Breaking (theoretical): CollectionAdminConfig.preview.populate removed from the public type. Safe in practice — the field had no consumer code,
  ▎ so any external preview.populate: { … } was already a no-op. If you've authored one, drop the property; the rest of the preview shape is
  ▎ unchanged.

## 1.3.0

### Minor Changes

- 3a58877: - @byline/storage-s3 — released as the production-ready S3 storage adapter. Image variants now generate end-to-end through storage.upload() (no
  local-filesystem assumption). Added optional default-credential-chain support (omit accessKeyId / secretAccessKey to let the AWS SDK resolve via IAM
  role / SSO / env / ~/.aws/credentials), plus sessionToken, acl, cacheControl, metadata (static or per-upload supplier), and a clientConfig
  pass-through for advanced S3Client tuning. Exports the new S3MetadataSupplier type.
  - @byline/core — breaking: generateImageVariants in @byline/core/image now takes (buffer, mimeType, storedFile, storage, sizes, logger) and writes
    variants via storage.upload(...). Variant bytes are produced in-memory by Sharp and persisted through the configured provider — no node:fs access.
    Added targetStoragePath?: string to UploadFileOptions so callers can pin the destination key (used by the variant pipeline to place sibling
    objects). Custom IStorageProvider implementations should honour targetStoragePath to participate in variant generation.
  - @byline/storage-local — honours UploadFileOptions.targetStoragePath when present.
  - @byline/host-tanstack-start — dropped the 'uploadDir' in storage runtime branch in the upload server fn. Variant generation now delegates to the
    provider-agnostic generateImageVariants helper, so S3 (and any future provider) gets variants for free.
  - @byline/cli — both byline/server.config.ts and byline-examples/server.config.ts templates carry a commented s3StorageProvider({...}) example wired
    to BYLINE*STORAGE_S3*\* env vars, alongside the active local provider call.
  - Workspace-wide formatting pass — applied accumulated Biome lint output across @byline/client, @byline/host-tanstack-start,
    @byline/richtext-lexical, and @byline/ui (merged duplicate imports, re-wrapped long signatures, and replaced a few ! non-null assertions with ?.
    optional chaining via Biome's noNonNullAssertion unsafe fix). No behavioural change.
  - @byline/webapp — added the same commented S3 example to byline/server.config.ts, plus a BYLINE*STORAGE_S3*\* block to .env.example. Migrated
    byline/scripts/regenerate-media.ts to the new variant helper.

## 1.2.1

### Patch Changes

- 2859790: - @byline/host-tanstack-start — decoupled the host adapter from concrete DB and storage implementations. The host's source code no longer imports
  from @byline/db-postgres or @byline/storage-local; both have been removed from peerDependencies. Concrete adapters now arrive entirely through the BylineCore / ServerConfig DI seam, and the contract lives in TypeScript interfaces (IDbAdapter, IStorageProvider, AdminStore). Consumers can swap in @byline/storage-s3 (or future DB adapters) without the host needing to know.
  - @byline/core — added a new @byline/core/image subpath exporting the storage-agnostic image-processing helpers (extractImageMeta generateImageVariants, isBypassMimeType, plus the ImageMeta / ImageVariantResult / ProcessImageResult types). Adds sharp as a runtime dependency.
  - @byline/storage-local — breaking: removed the image-processor exports (extractImageMeta, generateImageVariants, isBypassMimeType, and their types). They have moved to @byline/core/image. The package now exports only localStorageProvider and its config type. sharp is no longer a dependency. Update imports from @byline/storage-local → @byline/core/image.

## 1.2.0

### Minor Changes

- 74a3013: - @byline/ui — consolidated the React entry surface. Standardised every consumer import on @byline/ui/react and removed the bare @byline/ui JS export from the exports map. The bare specifier now raises ERR_PACKAGE_PATH_NOT_EXPORTED; switch any external imports to @byline/ui/react. CSS subpath exports are unchanged.
  - Admin / document history — added a "make current" restore action on the document history view, letting an admin promote any prior version back to the current revision from the history UI.
  - @byline/db-postgres — fixed an EAV insert-boundary regression where datetime field values arriving as ISO strings (rather than Date instances) were rejected. The adapter now tolerates string-shaped date values and coerces them at the insert boundary.

## 1.1.0

### Minor Changes

- a5127f5: Removed lodash-es and updated CLI deps. Collapsed @byline/ui exports to single /react entry. Renamed admin Row/Group/Tabs to AdminRow/AdminGroup/AdminTabs.

## 1.0.0

### Major Changes

- 002a29a: First major verison of Byline. Initial version of CLI.

## 0.10.6

### Patch Changes

- d58a16f: Updated vite.config.ts configuration in webapp and CLI template.

## 0.10.5

### Patch Changes

- 7cae939: More work on experimental CLI
- 3185c48: More work on Nitro compatible vite.config.ts template.

## 0.1.4

### Patch Changes

- 74fc714: Fixups for nitro, and new \_byline pathless route.

## 0.1.3

### Patch Changes

- Removed sourcemaps from outputs.

## 0.1.2

### Patch Changes

- Fixups for packages exports.

## 0.1.1

### Patch Changes

- 10bf19a: Re-publish with removed argon2 dependency. Experimental CLI.
