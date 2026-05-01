# File / Media Upload — Implementation Plan

Companion to [FILE-MEDIA-UPLOAD-ANALYSIS.md](./FILE-MEDIA-UPLOAD-ANALYSIS.md).
Decisions are settled in the analysis; this doc is the execution path.

Greenfield: no production data, no published schemas, no migration
shims. Each phase ends with the repo in a green, dogfood-able state
(`pnpm build` / `typecheck` / `test` clean and the admin UI smoke-tests
through Media create / list / edit / upload).

---

## Status

| Phase | Status |
|---|---|
| 1 — Type surface: move `upload` onto `ImageField` / `FileField` | pending |
| 2 — Persistence: `variants jsonb` on `byline_store_file` | pending |
| 3 — Upload service: read config from field, persist variants | pending |
| 4 — Transport: `field` selector on the upload endpoint | pending |
| 5 — Admin UI: field-level upload, gallery picker, drop zone | pending |
| 6 — Schema migration: rewrite `Media` schema, audit other collections | pending |

---

## Phase 1 — Type surface

Goal: change the type definitions, leaving every caller broken in a
way the typechecker can enumerate. No behaviour changes yet — phases
2–4 wire the new types through.

**Changes**

- `packages/core/src/@types/collection-types.ts`
  - Extend `UploadConfig` with `hooks?: UploadHooks`.
  - Define new `BeforeStoreContext`, `AfterStoreContext`,
    `BeforeStoreResult`, `BeforeStoreHookFn`, `AfterStoreHookFn`,
    `UploadHooks` types.
  - Remove `upload?: UploadConfig` from `CollectionDefinition`.
  - Remove `beforeUpload`, `afterUpload` from `CollectionHooks`; remove
    `BeforeUploadContext`, `AfterUploadContext`, `BeforeUploadHookFn`,
    `BeforeUploadHookSlot`.
- `packages/core/src/@types/field-types.ts`
  - Add `upload?: UploadConfig` to `ImageField` and `FileField`.
  - Drop the existing `TODO: Validation rules` comments — they're now
    expressed in `UploadConfig`.
- `packages/core/src/storage/collection-fingerprint.ts`
  - Drop `canonicalUpload(definition.upload)` from the collection
    fingerprint.
  - Fold the per-field upload config into the field fingerprint so
    schema-version bumps detect upload-config changes. `hooks` is
    excluded from the fingerprint (functions don't canonicalise).
- `packages/core/src/@types/index.ts` — re-export the new hook types,
  drop the removed ones.

**Verification gate**

- `pnpm --filter @byline/core typecheck` — surfaces every site that
  reads `definition.upload`, `CollectionHooks.beforeUpload`,
  `CollectionHooks.afterUpload`, or the removed context types.
  Expected breakage: `document-upload.ts` (the main service),
  `host-tanstack-start/server-fns/collections/upload.ts`, the Media
  schema in `apps/webapp/byline/collections/media/schema.ts`, plus
  re-export sites.
- Catalog the broken sites in the phase 3 / 4 / 6 task lists.
  Don't fix them yet — phases 2–6 each pick up a slice.

---

## Phase 2 — Persistence

Goal: `byline_store_file` round-trips a `variants` array, so an upload
that produced derivatives can be reconstructed on read with all of
their URLs and dimensions intact.

**Changes**

- `packages/db-postgres/src/database/schema/index.ts`
  - Add `variants: jsonb('variants')` to `fileStore`. Nullable —
    non-image uploads and pre-pipeline rows have no variants.
- `packages/db-postgres/src/database/migrations/`
  - Generate a migration via `pnpm drizzle:generate` after the schema
    change. Greenfield project: a single new migration is fine.
- `packages/core/src/@types/store-types.ts`
  - Add `variants?: PersistedVariant[]` to `FileStore`.
  - Define `PersistedVariant`: `{ name, storagePath, storageUrl?, width?, height?, format? }`.
- `packages/core/src/@types/field-data-types.ts`
  - Add `variants?: PersistedVariant[]` to `StoredFileValue`.
- `packages/db-postgres/src/modules/storage/storage-utils.ts`
  - `flattenFieldSetData()` — emit `variants` onto the file store row
    when present on the input.
  - `restoreFieldSetData()` — copy `variants` back onto the file
    envelope when the row carries it.
- `packages/db-postgres/src/modules/storage/storage-store-manifest.ts`
  - Add `variants` to the `store_file` column manifest so the
    selective-field UNION ALL projects it.

**Verification gate**

- `pnpm --filter @byline/db-postgres test` — extend a flatten/restore
  test to round-trip a file value with variants.
- `pnpm --filter @byline/core test` — `field-store-map.test.node.ts`
  contract test stays green (no new field types added; this is a
  column extension on an existing store).
- `pnpm drizzle:migrate` runs cleanly against a freshly-initialised
  Postgres.

---

## Phase 3 — Upload service

Goal: the framework-agnostic upload service in `@byline/core` reads its
constraints off the target field instead of the collection, runs the
new `beforeStore` / `afterStore` hook chains with rich field-and-form
context, persists variants to the new column, and threads the
filename override correctly into `storage.upload(...)` so variant
filenames inherit it.

**Changes**

- `packages/core/src/services/document-upload.ts`
  - `DocumentUploadContext` gains a `fieldName: string` (the target
    image/file field on the collection). The service resolves the
    field in `definition.fields` (recursing into groups/arrays/blocks),
    asserts it's an `ImageField | FileField`, and reads `field.upload`
    from there.
  - All references to `definition.upload` → `field.upload`.
  - **Validation order fix**: mime type and file size checks run
    before any hook fires. Hooks no longer execute for files that are
    about to be rejected.
  - **Filename-override threading bug fix**: the result of the
    `beforeStore` chain (`effectiveFilename`) is passed into
    `storage.upload(buffer, { filename: effectiveFilename, … })`.
    Today's bug — the override is ignored and storage paths use the
    sanitised original — disappears. Variant filenames pick up the
    override automatically because `generateImageVariants` derives
    them from `path.basename(storedFile.storagePath)`.
  - **`beforeStore` chain semantics**: each function in the array sees
    the previous function's filename override (fold). Returning a
    string or `{ filename }` substitutes; returning `void` keeps
    current; returning `{ error }` short-circuits with
    `ERR_VALIDATION` (no storage write, no variants, no document, no
    later hook runs). The chain receives `BeforeStoreContext` with
    `fieldName`, `field`, `filename`, `mimeType`, `fileSize`,
    `fields` (the other form values from the same submission),
    `collectionPath`, `requestContext`.
  - **`afterStore` chain semantics**: each function runs in
    declaration order; failures are logged via `logger.error` but do
    not roll back the storage write (consistent with `afterCreate`
    etc.). Receives `AfterStoreContext` with `fieldName`, `field`,
    `storedFile` (now carrying the persisted `variants` array),
    `fields`, `collectionPath`, `requestContext`.
  - All `imageProcessor.generateVariants({ ..., upload })` calls now
    receive the per-field `UploadConfig`.
  - `UploadVariantResult` widens to
    `{ name, storagePath, storageUrl?, width?, height?, format? }`.
  - The variants array is written into `StoredFileValue.variants` so
    the lifecycle path persists it via the store manifest in phase 2.
  - `UploadDocumentResult` drops the legacy top-level
    `variants: Array<{ name, url }>` field — callers read
    `result.storedFile.variants` instead. Single source of truth.
- `packages/core/src/storage/collection-fingerprint.ts`
  - Move `canonicalUpload` invocation onto the field fingerprint
    helper (already touched in phase 1, finalised here).
- `packages/core/src/@types/site-config.ts` — keep `ServerConfig.storage`
  as the site-wide default, untouched.

**Verification gate**

- `pnpm --filter @byline/core test` — extend / add upload service
  tests covering: (a) field resolution (top-level, inside group),
  (b) `mimeTypes` / `maxFileSize` rejection paths via field config,
  (c) variants written to `StoredFileValue.variants`,
  (d) `beforeStore` filename rewrite threads into `storage.upload`
  AND into variant filenames,
  (e) `beforeStore` chain fold (multiple functions stack),
  (f) `beforeStore` rejection short-circuits — no storage write, no
  variants, no document, no `afterStore`,
  (g) `afterStore` runs after variants are persisted; failure is
  logged but doesn't roll back.
- `pnpm typecheck` clean across the workspace.

---

## Phase 4 — Transport

Goal: the auto-mounted upload route accepts a `field` selector, defaults
sensibly when there's exactly one upload-capable field, and rejects
ambiguity with a 400 listing the candidates.

**Changes**

- `packages/host-tanstack-start/src/server-fns/collections/upload.ts`
  - `parseUploadFormData` — read an optional `field` FormData entry.
  - `uploadCollectionDocument` handler:
    - Look up the collection via `ensureCollection(collectionPath)` as
      today.
    - Resolve the target field: explicit `field` param → matching
      `ImageField | FileField`; else find the unique upload-capable
      field; else throw `ERR_VALIDATION` with `available: [...]`.
    - Pass `fieldName` and the resolved field's `upload.storage` (or
      `serverConfig.storage`) into `DocumentUploadContext`.
- `packages/host-tanstack-start/src/integrations/api-utils.ts`
  - Drop any `definition.upload` references from `ensureCollection`
    surrounding code. The collection no longer carries a top-level
    upload flag.
- Admin webapp call sites:
  - `apps/webapp/src/...` — every uploader UI passes `field: 'image'`
    (or whichever field) explicitly when posting FormData. Phase 5
    finalises the UI; phase 4 leaves a typed string in place.

**Verification gate**

- `pnpm --filter @byline/host-tanstack-start build` — clean.
- Manual smoke: upload to Media via the admin UI lands the file plus
  variants in `byline_store_file.variants`, and a subsequent `GET` of
  the document returns variants on the field envelope.
- `@byline/client` smoke: extend the news scaffold's loader to log
  `meta.media[0].fields.image.variants` and confirm it's populated
  through `populate: { featureImage: '*' }`.

---

## Phase 5 — Admin UI

Goal: the admin treats per-field upload as the only model. The
"this collection is a media library" UX is reconstructed from a
heuristic (`hasUploadField(definition)`), not a schema flag.

**Changes**

- `packages/host-tanstack-start/src/admin-shell/`
  - Replace every `definition.upload != null` check with
    `hasUploadField(definition)` (a small helper in `@byline/core`).
  - The dashboard's media-library card / drop zone keys off the same
    helper.
- Image / file field widgets:
  - The widget reads its own `field.upload` to drive client-side
    validation hints (max size, allowed types, expected variants).
  - The uploader posts `field: <name>` alongside the file.
- `apps/webapp/src/...`
  - Audit any host-side admin code that still reads
    `definition.upload`; route through the helper.
- Admin navigation labelling:
  - Today, the "Media" list uses a gallery-style view because the
    collection has `upload`. Lift this into a per-collection admin
    config flag (e.g. `defineAdmin({ listView: 'gallery' })`) so it's
    explicit rather than implied. Out of scope if it lengthens this
    phase materially — tracked as a follow-up.

**Verification gate**

- `pnpm dev` smoke — Media library still looks and behaves the same;
  upload flow lands variants; image-field widget validates locally
  against the per-field `mimeTypes` / `maxFileSize`.
- `pnpm --filter @byline/webapp test` clean.

---

## Phase 6 — Schema migration

Goal: rewrite the in-repo schemas to use the new model and confirm the
ergonomic story holds.

**Changes**

- `apps/webapp/byline/collections/media/schema.ts`
  - Move the entire `upload` block onto the `image` field.
  - Remove the "first image/file field is the focal upload" comment;
    the field is now self-describing.
- `apps/webapp/byline/collections/news/schema.ts`
  - No change required — `featureImage` stays a relation to `media`.
    Worth a verification that the populated relation envelope
    surfaces `variants`.
- Add a worked example of pattern B (inline upload, no media
  collection) to the analysis or to a sample collection so the
  ergonomics are visible to readers. Suggested: a small `Profiles`
  collection with `avatar: { type: 'image', upload: { ... } }` in
  `byline/collections/`. Optional — gated on whether the docs site
  needs an explicit example.
- Update [FILE-MEDIA-UPLOAD-ANALYSIS.md](./FILE-MEDIA-UPLOAD-ANALYSIS.md)
  status note and `CLAUDE.md` if the upload paragraph drifts.

**Verification gate**

- Full smoke: create a Media item, edit it, confirm variants on
  read; create a News item with a `featureImage`, populate the
  relation, confirm variants flow through; (optional) the inline
  pattern in a sample collection round-trips a file with variants.
- `pnpm build` / `typecheck` / `test` clean across the workspace.

---

## Sequencing notes

- Phases 1–3 are tightly coupled: the type surface change (1) breaks
  the upload service, the persistence layer (2) gives the service
  somewhere to write variants, and (3) wires it through. They could
  be one large commit or three small ones — three small ones make
  the verification gates more useful but force phase 1 to land
  with intentional breakage in phases 2–3 fixed in the next step.
- Phase 4 (transport) is independent of phase 5 (UI) — phase 4 lands
  the new endpoint shape with a typed string at the call site, and
  phase 5 polishes the widget once that's stable.
- Phase 6 (schema rewrite) is the only phase visible to schema
  authors. Land it last so the "before / after" diff in the Media
  schema is the punchline.

## Out of scope

- Stable public HTTP boundary for uploads (per ROUTING-API-ANALYSIS.md
  this is deferred until a non-admin client forces the broader
  transport boundary).
- Aspect-ratio / min-dimension constraints on `ImageField`. Tracked
  in the analysis's open questions; field-level `upload` is the
  right home for them when they land.
- Per-field `afterUpload` hooks. Today's collection-level
  `hooks.afterUpload` continues to fire for any upload on the
  collection.
- A new `byline_store_file_variants` sidecar table. Rejected in the
  analysis in favour of jsonb on `byline_store_file`.
