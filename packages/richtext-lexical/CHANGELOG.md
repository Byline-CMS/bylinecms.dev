# @byline/richtext-lexical

## 2.4.1

### Patch Changes

- moved admin UI verticals into **`@byline/admin`** with per-vertical scoped exports, leaving **`@byline/ui`** as kit, form runtime, and shared widgets
  **`@byline/ui`** `DiffModal` now takes `loadHistoricalVersion` as a prop and lives at `widgets/diff-viewer` (decoupled from admin services)
- Updated dependencies
  - @byline/client@2.4.1
  - @byline/core@2.4.1
  - @byline/ui@2.4.1

## 2.4.0

### Minor Changes

- **`@byline/richtext-lexical`** lazy-loaded the editor module graph from `lexicalEditor()` so public-route consumers no longer ship the editor, and rendered a `Shimmer` skeleton in place of the editor while that chunk loads
  **`@byline/cli`** scaffold split the `_byline` pathless layout into `route.tsx` + `route.lazy.tsx` to keep admin chrome off public pages

### Patch Changes

- Updated dependencies
  - @byline/client@2.4.0
  - @byline/core@2.4.0
  - @byline/ui@2.4.0

## 2.3.3

### Patch Changes

- added optional Home link to the admin SignInForm and cleared the preview-mode cookie on admin sign-out
- Updated dependencies
  - @byline/client@2.3.3
  - @byline/core@2.3.3
  - @byline/ui@2.3.3

## 2.3.2

### Patch Changes

- fixed an unconditional session cookie clear in **`@byline/host-tanstack-start`** that emitted `Set-Cookie` on every anonymous request, causing CDN cache bypass on public pages
- Updated dependencies
  - @byline/client@2.3.2
  - @byline/core@2.3.2
  - @byline/ui@2.3.2

## 2.3.1

### Patch Changes

- fixed relation/file removal save crash in **`@byline/db-postgres`** and richtext caret-jump regression in **`@byline/richtext-lexical`**
- Updated dependencies
  - @byline/client@2.3.1
  - @byline/core@2.3.1
  - @byline/ui@2.3.1

## 2.3.0

### Minor Changes

- Upload progress indicators and redesigned image and field fields.

### Patch Changes

- Updated dependencies
  - @byline/ui@2.3.0
  - @byline/client@2.3.0
  - @byline/core@2.3.0

## 2.2.10

### Patch Changes

- storage-s3 ssr external in vite.config.ts
- Updated dependencies
  - @byline/client@2.2.10
  - @byline/core@2.2.10
  - @byline/ui@2.2.10

## 2.2.9

### Patch Changes

- gated markdown import-docs example script and deps behind an opt-in prompt
- Updated dependencies
  - @byline/client@2.2.9
  - @byline/core@2.2.9
  - @byline/ui@2.2.9

## 2.2.8

### Patch Changes

- Opened preview link in the current tab instead of a new tab. Added byline-icon.tsx to ui kit and updated admin bar. Removed year/month nesting from upload paths in s3 storage provider.
- Updated dependencies
  - @byline/ui@2.2.8
  - @byline/client@2.2.8
  - @byline/core@2.2.8

## 2.2.7

### Patch Changes

- feat(host-tanstack-start): collapsed breadcrumb overflow into a dropdown on narrow viewports
- Updated dependencies
  - @byline/client@2.2.7
  - @byline/core@2.2.7
  - @byline/ui@2.2.7

## 2.2.6

### Patch Changes

- Route progress indicator in admin shell. Admin shell mobile fixups.
- Updated dependencies
  - @byline/ui@2.2.6
  - @byline/client@2.2.6
  - @byline/core@2.2.6

## 2.2.5

### Patch Changes

- feat(richtext-lexical): scoped floating text-format popover to nested composers by default.
- Updated dependencies
  - @byline/client@2.2.5
  - @byline/core@2.2.5
  - @byline/ui@2.2.5

## 2.2.4

### Patch Changes

- exposed pg pool tuning via BYLINE_DB_POSTGRES_MAX_POOL / IDLE_TIMEOUT_MILLIS / CONNECTION_TIMEOUT_MILLIS
- Updated dependencies
  - @byline/client@2.2.4
  - @byline/core@2.2.4
  - @byline/ui@2.2.4

## 2.2.3

### Patch Changes

- .env vars and byline postgres connection string refactor.
- Updated dependencies
  - @byline/client@2.2.3
  - @byline/core@2.2.3
  - @byline/ui@2.2.3

## 2.2.2

### Patch Changes

- typed json/object/richText field data as JsonValue / JsonObject
- Updated dependencies
  - @byline/core@2.2.2
  - @byline/client@2.2.2
  - @byline/ui@2.2.2

## 2.2.1

### Patch Changes

- Fixed workflow status error in single status workflows. Updated CLI.
- Updated dependencies
  - @byline/core@2.2.1
  - @byline/client@2.2.1
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
  - @byline/client@2.2.0
  - @byline/core@2.2.0
  - @byline/ui@2.2.0

## 2.1.3

### Patch Changes

- Updated CLI with new dep versions and @byline/ai package. Updated vite.config.ts
- Updated dependencies
  - @byline/client@2.1.3
  - @byline/core@2.1.3
  - @byline/ui@2.1.3

## 2.1.2

### Patch Changes

- fix(ai): clean dist before build to avoid shipping stale .js.map files.
- Updated dependencies
  - @byline/client@2.1.2
  - @byline/core@2.1.2
  - @byline/ui@2.1.2

## 2.1.1

### Patch Changes

- fix(ai): use relative imports inside package to prevent duplicate React context.
- Updated dependencies
  - @byline/client@2.1.1
  - @byline/core@2.1.1
  - @byline/ui@2.1.1

## 2.1.0

### Minor Changes

- AI package import fixes, CLI updates for db setup only.

### Patch Changes

- Updated dependencies
  - @byline/client@2.1.0
  - @byline/core@2.1.0
  - @byline/ui@2.1.0

## 1.12.2

### Patch Changes

- Minor fixes in core (mostly CI / test / lint setup)
- Updated dependencies
  - @byline/client@1.12.2
  - @byline/core@1.12.2
  - @byline/ui@1.12.2

## 1.12.1

### Patch Changes

- Simplified docs schema and admin examples, re-synced CLI templates.
- Updated dependencies
  - @byline/client@1.12.1
  - @byline/core@1.12.1
  - @byline/ui@1.12.1

## 1.12.0

### Minor Changes

- Richtext refactor to Lexical extensions API, extensibility, and updated docs.

### Patch Changes

- Updated dependencies
  - @byline/client@1.12.0
  - @byline/core@1.12.0
  - @byline/ui@1.12.0

## 1.11.2

### Patch Changes

- refactor(orderable): moved orderable flag from defineAdmin to defineCollection.
- Updated dependencies
  - @byline/core@1.11.2
  - @byline/client@1.11.2
  - @byline/ui@1.11.2

## 1.11.1

### Patch Changes

- Re-sync'd CLI deps and templates.
- Updated dependencies
  - @byline/client@1.11.1
  - @byline/core@1.11.1
  - @byline/ui@1.11.1

## 1.11.0

### Minor Changes

- Added orderable collections with drag-to-reorder list view.

### Patch Changes

- Updated dependencies
  - @byline/core@1.11.0
  - @byline/ui@1.11.0
  - @byline/client@1.11.0

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
  - @byline/client@1.10.3
  - @byline/core@1.10.3
  - @byline/ui@1.10.3

## 1.10.2

### Patch Changes

- New terminal state and revert to draft or published in form-renderer.
- Updated dependencies
  - @byline/client@1.10.2
  - @byline/core@1.10.2
  - @byline/ui@1.10.2

## 1.10.1

### Patch Changes

- Styling of Copy to Locale modal actions.
- Updated dependencies
  - @byline/ui@1.10.1
  - @byline/client@1.10.1
  - @byline/core@1.10.1

## 1.10.0

### Minor Changes

- Duplicate and Copy to Locale document lifecycle actions.

### Patch Changes

- Updated dependencies
  - @byline/client@1.10.0
  - @byline/core@1.10.0
  - @byline/ui@1.10.0

## 1.9.1

### Patch Changes

- AI package clean up. Removed Vercel SDK options, cleaned up logging and help modal.
- Updated dependencies
  - @byline/client@1.9.1
  - @byline/core@1.9.1
  - @byline/ui@1.9.1

## 1.9.0

### Minor Changes

- First phase of AI development - AI support in editable fields and richtext.

### Patch Changes

- Updated dependencies
  - @byline/client@1.9.0
  - @byline/core@1.9.0
  - @byline/ui@1.9.0

## 1.8.2

### Patch Changes

- Sweep, clean, refactor and docs.
- Updated dependencies
  - @byline/client@1.8.2
  - @byline/core@1.8.2
  - @byline/ui@1.8.2

## 1.8.1

### Patch Changes

- isolation: isolate - for base UI context stacking
- Updated dependencies
  - @byline/client@1.8.1
  - @byline/core@1.8.1
  - @byline/ui@1.8.1

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

### Patch Changes

- Updated dependencies
  - @byline/client@1.8.0
  - @byline/core@1.8.0
  - @byline/ui@1.8.0

## 1.7.7

### Patch Changes

- Reordered @layer cascade so typography sits below components and utils are highest precedence.
- Updated dependencies
  - @byline/ui@1.7.7
  - @byline/client@1.7.7
  - @byline/core@1.7.7

## 1.7.6

### Patch Changes

- Reordered cascade layers so theme sits below components.
- Updated dependencies
  - @byline/client@1.7.6
  - @byline/core@1.7.6
  - @byline/ui@1.7.6

## 1.7.5

### Patch Changes

- Inlined formatNumber helper in example media list view (webapp and cli template).
- Updated dependencies
  - @byline/client@1.7.5
  - @byline/core@1.7.5
  - @byline/ui@1.7.5

## 1.7.4

### Patch Changes

- Migrated example media list and thumbnail views to CSS modules, updated CLI templates, and fixed up image field label and helptext.
- Updated dependencies
  - @byline/ui@1.7.4
  - @byline/client@1.7.4
  - @byline/core@1.7.4

## 1.7.3

### Patch Changes

- Correct byline-ui scoped container divs in webapp and cli templates.
- Updated dependencies
  - @byline/client@1.7.3
  - @byline/core@1.7.3
  - @byline/ui@1.7.3

## 1.7.2

### Patch Changes

- Scoped byline-ui to .byline-ui boundary and pinned cascade-layer order with tailwind. Updated cli template media list view.
- Updated dependencies
  - @byline/ui@1.7.2
  - @byline/client@1.7.2
  - @byline/core@1.7.2

## 1.7.1

### Patch Changes

- Served uploads at runtime when using the local storage provider so new files appear without a rebuild.
- Updated dependencies
  - @byline/client@1.7.1
  - @byline/core@1.7.1
  - @byline/ui@1.7.1

## 1.7.0

### Minor Changes

- Correct thumbnail rendering from variants and new lightbox widget.

### Patch Changes

- Updated dependencies
  - @byline/ui@1.7.0
  - @byline/client@1.7.0
  - @byline/core@1.7.0

## 1.6.2

### Patch Changes

- Bundle analyzer and updated cli/manifest deps to include sharp.
- Updated dependencies
  - @byline/client@1.6.2
  - @byline/core@1.6.2
  - @byline/ui@1.6.2

## 1.6.1

### Patch Changes

- Updated CLI templates.
- Updated dependencies
  - @byline/client@1.6.1
  - @byline/core@1.6.1
  - @byline/ui@1.6.1

## 1.6.0

### Minor Changes

- - Lenient document reconstruction (@byline/client, @byline/db-postgres, @byline/ui): the admin edit path now does a best-effort reconstruction of
    documents even when stored data is partially inconsistent, rather than failing hard. The form renderer gracefully handles missing or mismatched
    field data.
    - SelectField label fix (@byline/ui): field.label was not being rendered; fixed.
    - Pages preview URLs (webapp): pages collection now supports area-based preview URLs, with new public routes for /about/:slug and /legal/:slug.
      Example collection schemas updated accordingly.

### Patch Changes

- Updated dependencies
  - @byline/client@1.6.0
  - @byline/core@1.6.0
  - @byline/ui@1.6.0

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

### Patch Changes

- Updated dependencies [be3a5ee]
  - @byline/core@1.5.0
  - @byline/client@1.5.0
  - @byline/ui@1.4.0

## 1.3.1

### Patch Changes

- Updated dependencies [1a325ea]
  - @byline/core@1.4.0
  - @byline/client@1.4.0
  - @byline/ui@1.3.1

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

### Patch Changes

- Updated dependencies [3a58877]
  - @byline/client@1.3.0
  - @byline/core@1.3.0
  - @byline/ui@1.3.0

## 1.2.1

### Patch Changes

- 2859790: - @byline/host-tanstack-start — decoupled the host adapter from concrete DB and storage implementations. The host's source code no longer imports
  from @byline/db-postgres or @byline/storage-local; both have been removed from peerDependencies. Concrete adapters now arrive entirely through the BylineCore / ServerConfig DI seam, and the contract lives in TypeScript interfaces (IDbAdapter, IStorageProvider, AdminStore). Consumers can swap in @byline/storage-s3 (or future DB adapters) without the host needing to know.
  - @byline/core — added a new @byline/core/image subpath exporting the storage-agnostic image-processing helpers (extractImageMeta generateImageVariants, isBypassMimeType, plus the ImageMeta / ImageVariantResult / ProcessImageResult types). Adds sharp as a runtime dependency.
  - @byline/storage-local — breaking: removed the image-processor exports (extractImageMeta, generateImageVariants, isBypassMimeType, and their types). They have moved to @byline/core/image. The package now exports only localStorageProvider and its config type. sharp is no longer a dependency. Update imports from @byline/storage-local → @byline/core/image.
- Updated dependencies [2859790]
  - @byline/core@1.2.1
  - @byline/client@1.2.1
  - @byline/ui@1.2.1

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
