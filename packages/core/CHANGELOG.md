# @byline/core

## 1.7.4

### Patch Changes

- Migrated example media list and thumbnail views to CSS modules, updated CLI templates, and fixed up image field label and helptext.
- Updated dependencies
  - @byline/auth@1.7.4

## 1.7.3

### Patch Changes

- Correct byline-ui scoped container divs in webapp and cli templates.
- Updated dependencies
  - @byline/auth@1.7.3

## 1.7.2

### Patch Changes

- Scoped byline-ui to .byline-ui boundary and pinned cascade-layer order with tailwind. Updated cli template media list view.
- Updated dependencies
  - @byline/auth@1.7.2

## 1.7.1

### Patch Changes

- Served uploads at runtime when using the local storage provider so new files appear without a rebuild.
- Updated dependencies
  - @byline/auth@1.7.1

## 1.7.0

### Minor Changes

- Correct thumbnail rendering from variants and new lightbox widget.

### Patch Changes

- Updated dependencies
  - @byline/auth@1.7.0

## 1.6.2

### Patch Changes

- Bundle analyzer and updated cli/manifest deps to include sharp.
- Updated dependencies
  - @byline/auth@1.6.2

## 1.6.1

### Patch Changes

- Updated CLI templates.
- Updated dependencies
  - @byline/auth@1.6.1

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
  - @byline/auth@1.6.0

## 1.5.0

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
  - @byline/auth@1.4.0

## 1.4.0

### Minor Changes

- 1a325ea: - @byline/core — `where`: document-level reserved keys (`status`, `path`) inside a nested relation sub-clause now downshift to `DocumentColumnFilter` entries against the target version's `document_versions` columns — same precedence as the top level, with no field-shadow exception. So `where: { category: { path: 'news' } }` filters by the target's document-level path (slugified from `useAsPath`), matching the consumer-intuitive reading. The Postgres adapter already exposed `td${depth}.status` / `td${depth}.path` via the inner relation scope; lifting the parser restriction is the only change. `query` inside a relation sub-clause is dropped with a `logger.debug` line — text search doesn't compose through a relation hop, mirroring the existing rule for `query` inside a combinator.
  - @byline/client — surfaces the change. Existing nested-where examples like `{ category: { path: 'news' } }` keep working but now resolve against the target's `document_versions.path` column (rather than silently no-op'ing). A target collection that previously declared a `path` or `status` field will see those clauses resolve as the document column, not the field; rename the offending field (e.g. to `slug`) if the field-filter behaviour was intentional.

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
  - @byline/auth@1.3.0

## 1.2.1

### Patch Changes

- 2859790: - @byline/host-tanstack-start — decoupled the host adapter from concrete DB and storage implementations. The host's source code no longer imports
  from @byline/db-postgres or @byline/storage-local; both have been removed from peerDependencies. Concrete adapters now arrive entirely through the BylineCore / ServerConfig DI seam, and the contract lives in TypeScript interfaces (IDbAdapter, IStorageProvider, AdminStore). Consumers can swap in @byline/storage-s3 (or future DB adapters) without the host needing to know.
  - @byline/core — added a new @byline/core/image subpath exporting the storage-agnostic image-processing helpers (extractImageMeta generateImageVariants, isBypassMimeType, plus the ImageMeta / ImageVariantResult / ProcessImageResult types). Adds sharp as a runtime dependency.
  - @byline/storage-local — breaking: removed the image-processor exports (extractImageMeta, generateImageVariants, isBypassMimeType, and their types). They have moved to @byline/core/image. The package now exports only localStorageProvider and its config type. sharp is no longer a dependency. Update imports from @byline/storage-local → @byline/core/image.
- Updated dependencies [2859790]
  - @byline/auth@1.2.1

## 1.2.0

### Minor Changes

- 74a3013: - @byline/ui — consolidated the React entry surface. Standardised every consumer import on @byline/ui/react and removed the bare @byline/ui JS export from the exports map. The bare specifier now raises ERR_PACKAGE_PATH_NOT_EXPORTED; switch any external imports to @byline/ui/react. CSS subpath exports are unchanged.
  - Admin / document history — added a "make current" restore action on the document history view, letting an admin promote any prior version back to the current revision from the history UI.
  - @byline/db-postgres — fixed an EAV insert-boundary regression where datetime field values arriving as ISO strings (rather than Date instances) were rejected. The adapter now tolerates string-shaped date values and coerces them at the insert boundary.

### Patch Changes

- Updated dependencies [74a3013]
  - @byline/auth@1.2.0

## 1.1.0

### Minor Changes

- a5127f5: Removed lodash-es and updated CLI deps. Collapsed @byline/ui exports to single /react entry. Renamed admin Row/Group/Tabs to AdminRow/AdminGroup/AdminTabs.

### Patch Changes

- Updated dependencies [a5127f5]
  - @byline/auth@1.1.0

## 1.0.0

### Major Changes

- 002a29a: First major verison of Byline. Initial version of CLI.

### Patch Changes

- Updated dependencies [002a29a]
  - @byline/auth@1.0.0

## 0.10.6

### Patch Changes

- d58a16f: Updated vite.config.ts configuration in webapp and CLI template.
- Updated dependencies [d58a16f]
  - @byline/auth@0.10.6

## 0.10.5

### Patch Changes

- 7cae939: More work on experimental CLI
- 3185c48: More work on Nitro compatible vite.config.ts template.
- Updated dependencies [7cae939]
- Updated dependencies [3185c48]
  - @byline/auth@0.10.5

## 0.10.4

### Patch Changes

- 74fc714: Fixups for nitro, and new \_byline pathless route.
- Updated dependencies [74fc714]
  - @byline/auth@0.10.4

## 0.10.3

### Patch Changes

- Removed sourcemaps from outputs.
- Updated dependencies
  - @byline/auth@0.10.3

## 0.10.2

### Patch Changes

- Fixups for packages exports.
- Updated dependencies
  - @byline/auth@0.10.2

## 0.10.1

### Patch Changes

- 10bf19a: Re-publish with removed argon2 dependency. Experimental CLI.
- Updated dependencies [10bf19a]
  - @byline/auth@0.10.1

## 0.10.0

### Minor Changes

- 0700fe2: Consolidated all UI components into a single @byline/ui UI kit.

### Patch Changes

- Updated dependencies [0700fe2]
  - @byline/auth@0.10.0

## 0.9.3

### Patch Changes

- 9d546c3: Initial npm release.
- Updated dependencies [9d546c3]
  - @byline/auth@0.9.3

## 0.9.2

### Patch Changes

- Changeset test.
- Updated dependencies
  - @byline/auth@0.9.2
