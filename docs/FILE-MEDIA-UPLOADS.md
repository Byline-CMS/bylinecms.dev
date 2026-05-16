# File / Media Uploads

> Companions:
> - [COLLECTIONS.md](./COLLECTIONS.md) — collection schema and admin (the Media collection is a worked example).
> - [FIELDS.md](./FIELDS.md) — schema/admin split applied to fields, including upload fields.
> - [CORE-DOCUMENT-STORAGE.md](./CORE-DOCUMENT-STORAGE.md) — `store_file` is the row that backs a persisted upload.
> - [RELATIONSHIPS.md](./RELATIONSHIPS.md) — `populate` over a `relation` to a media collection carries the file envelope and its variants in one round-trip.
> - [CLIENT-SDK.md](./CLIENT-SDK.md) — reading uploaded files (and their variants) via `@byline/client`.
> - [ROUTING-API.md](./ROUTING-API.md) — the upload transport is an internal TanStack Start server function today; a stable public HTTP boundary is deferred.

## Overview

Uploads in Byline are a **field-level** concern. An `image` or `file` field declares its own `upload` block, and that block carries everything the upload pipeline needs to validate, store, post-process, and hook into the bytes:

- `mimeTypes` — what the field accepts
- `maxFileSize` — per-file size cap
- `sizes` — Sharp-driven image variants (named, with width / height / fit / format / quality)
- `storage` — optional per-field storage provider, falling through to the site-wide default
- `hooks` — `beforeStore` / `afterStore` server-side hooks with rich field-and-form context

This is unlike the more common "the collection *is* a media library" model. In Byline a collection is just a bag of fields, and any of those fields may happen to be upload-capable. Two consequences fall out of that:

1. A single collection can carry multiple, independently-configured upload fields. A `Profile` collection can have `avatar` (image, square crops, 5 MB) *and* `signaturePdf` (file, application/pdf, 2 MB) without any schema gymnastics.
2. Two image fields on the same collection can route to different storage backends — avatars on the local disk, editorial images on S3 — without inventing a new abstraction.

**Two patterns, one mechanism:**

- **Shared media library.** A dedicated `Media` collection has a single upload-capable `image` field. Other collections relate to it via `relation { targetCollection: 'media' }`. Variants ride along on the populated relation envelope. Right when assets are reused across documents.
- **Inline upload on a non-media collection.** A `Page` schema drops `{ type: 'image', name: 'heroImage', upload: { sizes: [...] } }` straight into its own fields. No `Media` row, no relation hop, no second admin screen. Right when the file is intrinsic to the document.
- **Both, in the same schema.** A `Page` can have `heroImage` inline *and* `gallery: relation(many) → media` side by side.

The "is this a media library?" question is a UI concern, not a schema one — the admin shows gallery affordances for collections it knows about by convention, not by a flag in the schema.

---

## Quick reference

Each entry is the minimal shape for one task. The "Edit" line tells you which file you actually change; the link at the end points at the deeper architecture section.

### 1. Add an upload field

The minimum: `{ type: 'image' | 'file', upload: {} }`. Defaults work — every mime type accepted, no size cap, no variants. Tighten as needed.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
import { defineCollection } from '@byline/core'

export const Profiles = defineCollection({
  path: 'profiles',
  fields: [
    { name: 'name', type: 'text' },
    {
      name: 'avatar',
      type: 'image',
      upload: {
        mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxFileSize: 5 * 1024 * 1024,   // 5 MB
      },
    },
  ],
})
```

→ [`UploadConfig` reference](#uploadconfig-reference)

### 2. Configure named image variants

`upload.sizes[]` lists Sharp-driven variants. Each entry produces one stored file at write time; the envelope returned to the client includes a `variants[]` array with one entry per size.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
{
  name: 'image',
  type: 'image',
  upload: {
    sizes: [
      { name: 'thumbnail', width: 400, height: 400, fit: 'cover',  format: 'avif', quality: 55 },
      { name: 'card',      width: 600,              fit: 'inside', format: 'avif', quality: 55 },
      { name: 'mobile',    width: 768,              fit: 'inside', format: 'avif', quality: 55 },
      { name: 'tablet',    width: 1280,             fit: 'inside', format: 'avif', quality: 55 },
      { name: 'desktop',   width: 2100,             fit: 'inside', format: 'avif', quality: 55 },
    ],
  },
}
```

AVIF is widely supported across modern browsers (Chrome 85+, Firefox 93+, Safari 16.4+) and typically yields ~20–30% smaller files than WebP at comparable quality. Sharp's avif quality scale is lower-numbered than webp/jpeg — `quality: 55` is a sensible AVIF default; bump to ~80 for WebP.

→ [Variant persistence on `store_file`](#variant-persistence-on-store_file)

### 3. Multiple upload fields in one collection

Each upload-capable field is configured independently. The admin shell selects which field receives a given uploaded file via the `field` selector on the upload server fn.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
export const Profiles = defineCollection({
  path: 'profiles',
  fields: [
    {
      name: 'avatar',
      type: 'image',
      upload: {
        mimeTypes: ['image/jpeg', 'image/png'],
        maxFileSize: 5 * 1024 * 1024,
        sizes: [{ name: 'thumbnail', width: 200, height: 200, fit: 'cover', format: 'webp' }],
      },
    },
    {
      name: 'signature',
      type: 'file',
      upload: {
        mimeTypes: ['application/pdf'],
        maxFileSize: 2 * 1024 * 1024,
      },
    },
  ],
})
```

The auto-mounted upload endpoint resolves the field by name. Disambiguation rules live in [The transport endpoint](#the-transport-endpoint).

→ [Files vs images](#files-vs-images)

### 4. Route one field to a different storage provider

`UploadConfig.storage` overrides `ServerConfig.storage` per field. Avatars on local disk, editorial images on S3, signatures on a separate bucket — all without inventing a new abstraction.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
import { s3StorageProvider } from '@byline/storage-s3'
import { localStorageProvider } from '@byline/storage-local'

fields: [
  {
    name: 'avatar',
    type: 'image',
    upload: {
      storage: localStorageProvider({ uploadDir: './uploads/avatars', baseUrl: '/uploads/avatars' }),
    },
  },
  {
    name: 'heroImage',
    type: 'image',
    upload: {
      storage: s3StorageProvider({
        bucket: process.env.S3_EDITORIAL_BUCKET!,
        region: 'eu-west-1',
        // …credentials, publicUrl, etc.
      }),
    },
  },
]
```

A storage provider is identified at write time by `storedFile.storageProvider`; the read path doesn't need to know which provider produced a given file beyond what's already in the envelope.

→ [Storage routing](#storage-routing)

### 5. Rename uploaded files via `beforeStore`

The `beforeStore` hook fires after auth + mime/size validation and before the storage write. Return a string to rewrite the filename; return `{ error }` to reject. Generated variant filenames inherit the new prefix automatically (`<basename>-<variantName>.<ext>`).

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
import type { BeforeStoreContext } from '@byline/core'

fields: [
  {
    name: 'image',
    type: 'image',
    upload: {
      hooks: {
        beforeStore: [
          // tenant-prefix everything
          ({ filename, requestContext }) =>
            `${requestContext.actor?.id ?? 'anon'}-${filename}`,
          // …then prefix with publication ID if present in the form
          ({ filename, fields }) =>
            fields.publicationId ? `${fields.publicationId}-${filename}` : undefined,
          // …then enforce uniqueness within the collection
          async ({ filename, collectionPath }) => {
            if (await isAssetTaken(collectionPath, filename)) {
              return { error: `An asset with name '${filename}' already exists.` }
            }
          },
        ],
      },
    },
  },
]
```

Multi-function chains stack with fold semantics — each function sees the previous function's filename override. Returning `void` keeps the current filename; returning `{ error }` short-circuits with `ERR_VALIDATION` — no file is written, no variants generated, no later hook runs.

→ [`beforeStore` and `afterStore` hooks](#beforestore-and-afterstore-hooks)

### 6. Audit / notify on success via `afterStore`

`afterStore` runs after the storage write and variant generation, with the persisted `StoredFileValue` in hand. Failures are logged via `logger.error` but do **not** roll back the storage write — consistent with `afterCreate` / `afterUpdate`.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
import type { AfterStoreContext } from '@byline/core'

fields: [
  {
    name: 'image',
    type: 'image',
    upload: {
      hooks: {
        afterStore: async ({ storedFile, fieldName, collectionPath, requestContext }) => {
          await auditLog.write({
            actor: requestContext.actor?.id ?? 'anon',
            event: 'upload.complete',
            collection: collectionPath,
            field: fieldName,
            fileId: storedFile.fileId,
            bytes: storedFile.fileSize,
          })
        },
      },
    },
  },
]
```

→ [`beforeStore` and `afterStore` hooks](#beforestore-and-afterstore-hooks)

### 7. Read an uploaded image on the public side

The `StoredFileValue` envelope round-trips intact through `@byline/client`. Variants ride along — no second round-trip — so you can build a `<picture>` / `srcset` directly.

**Edit:** a server fn or component reading the document — for the Media collection, `apps/webapp/src/modules/news/detail.ts` reads `featureImage` via populate.

```ts
import type { StoredFileValue } from '@byline/core'

const doc = await client.collection('media').findById(id)
const image = doc?.fields.image as StoredFileValue | undefined

console.log(image?.storageUrl)              // /uploads/media/abc.jpg
console.log(image?.imageWidth)              // 2048
console.log(image?.variants?.length)        // 5
```

For per-image rendering, `apps/webapp/src/ui/byline/components/responsive-image/index.tsx` is the reference `<picture>` component — AVIF-first source order, srcSet computed from the variants, sensible `sizes` defaults.

→ [Reading uploaded files](#reading-uploaded-files)

### 8. Pick a single named variant

For thumbnails and other fixed-size renders, look up the variant by name. The pattern used by `MediaThumbnail`:

**Edit:** any component reading a media document.

```tsx
import type { StoredFileValue } from '@byline/core'

const img = doc.fields.image as StoredFileValue | undefined
const thumb = img?.variants?.find((v) => v.name === 'thumbnail')
const url = thumb?.storageUrl ?? img?.storageUrl   // fallback to original
```

→ [Variant persistence on `store_file`](#variant-persistence-on-store_file)

### 9. Read an uploaded image through a populated relation

When a non-media collection references the Media library, populate carries the entire `StoredFileValue` (including variants) on the related document's `fields.image`. No extra round-trip.

**Edit:** the server fn for the parent collection — `apps/webapp/src/modules/news/list.ts` is the worked example.

```ts
import type { WithPopulated } from '@byline/client'

type NewsListFields = WithPopulated<NewsFields, 'featureImage', MediaFields>

const result = await client.collection('news').find<NewsListFields>({
  populate: { featureImage: '*' },
  // …
})

// Per-doc access:
const featureImage = result.docs[0]?.fields.featureImage?.document?.fields.image
// featureImage.variants is populated; build a <picture> directly.
```

→ [Reading uploaded files](#reading-uploaded-files)

### 10. Call the upload endpoint directly

For non-form callers (CLI imports, scripted ingest, eventual drag-into-list-view shortcuts), the auto-mounted endpoint accepts FormData. Pass `createDocument: 'true'` to skip the two-round-trip dance — bytes and document write happen in one shot, with storage rollback on failure.

```ts
const form = new FormData()
form.append('file', file)
form.append('collection', 'media')
form.append('field', 'image')          // required when collection has >1 upload field
form.append('createDocument', 'true')  // single-shot path

const response = await fetch('/admin/api/media/upload', {
  method: 'POST',
  body: form,
  credentials: 'include',
})
```

For in-form uploads the admin shell handles this automatically via `executeUploads` and posts with `createDocument: 'false'` so the document save is a separate round-trip carrying the `StoredFileValue` in `data`.

→ [The transport endpoint](#the-transport-endpoint)

### 11. Use SVG safely

SVG bypass is built in. `ResponsiveImage` short-circuits to the raw `<img src>` when `image.mimeType === 'image/svg+xml'` because variants aren't generated for SVG (no rasterisation, no upscaling). If you accept SVG, ensure your image-rendering component honours that bypass — Byline's `ResponsiveImage` already does.

**Edit:** `apps/webapp/byline/collections/media/schema.ts` — include `'image/svg+xml'` in `mimeTypes`.

```ts
mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml']
```

→ [Files vs images](#files-vs-images)

---

## Architecture

### `UploadConfig` reference

```ts
interface UploadConfig {
  mimeTypes?: string[]                // e.g. ['image/jpeg', 'image/png', 'image/*', '*/*']
  maxFileSize?: number                // bytes
  sizes?: ImageSize[]                 // Sharp variants — image fields only
  storage?: IStorageProvider          // overrides ServerConfig.storage for this field
  hooks?: UploadHooks
}

interface ImageSize {
  name: string                        // e.g. 'thumbnail', 'card', 'mobile'
  width?: number
  height?: number
  fit?: 'cover' | 'contain' | 'inside' | 'outside' | 'fill'
  format?: 'webp' | 'jpeg' | 'png' | 'avif'
  quality?: number                    // 1–100
}

interface UploadHooks {
  beforeStore?: BeforeStoreHookFn | BeforeStoreHookFn[]
  afterStore?: AfterStoreHookFn | AfterStoreHookFn[]
}
```

The same shape works on a `FileField` for non-image uploads — `sizes` is simply ignored, and `imageProcessor.generateVariants` is skipped at runtime.

The reference Media schema in `apps/webapp/byline/collections/media/schema.ts` carries every knob set deliberately (avif variants, 20 MB cap, common image mimetypes including SVG) and is the canonical worked example.

### End-to-end flow

The diagram below traces what happens when a user picks an image in the Media admin form and clicks Save. Two server round-trips:

1. **field upload** — the bytes are pushed to storage, the document does not yet exist.
2. **document save** — the resulting `StoredFileValue` (paths + variants) is persisted in `store_file` alongside the rest of the document.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BROWSER                                                                      │
│                                                                              │
│  1. User picks / drops a file in the Image field                             │
│     packages/ui/src/fields/image/image-upload-field.tsx                      │
│       - validates type starts with 'image/'                                  │
│       - URL.createObjectURL(file)  →  blob: preview URL                      │
│       - createPendingStoredFileValue(file, previewUrl, dimensions)           │
│       - addPendingUpload(fieldPath, { file, previewUrl, collectionPath })    │
│           └─ registered in form-context.tsx pendingUploads Map               │
│       - onUploaded(pendingValue) → field shows local preview                 │
│                                                                              │
│  2. User edits title / altText / caption / credit                            │
│                                                                              │
│  3. User clicks Save                                                         │
│     packages/ui/src/forms/form-renderer.tsx → handleSubmit()                 │
│       a. runFieldHooks + validateForm                                        │
│       b. getPendingUploads() — non-empty → executeUploads(...)               │
│            packages/ui/src/forms/upload-executor.ts                          │
│              for each pending upload:                                        │
│                FormData { file, field: 'image' }                             │
│                uploadField(collectionPath, formData, false)                  │
│                                ▼                                             │
└────────────────────────────────┼─────────────────────────────────────────────┘
                                 │  (TanStack server fn — POST)
                                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ SERVER (Node)                                                                │
│                                                                              │
│  packages/host-tanstack-start/src/server-fns/collections/upload.ts           │
│    uploadCollectionField = createServerFn({ method: 'POST' })                │
│      .inputValidator(parseUploadFormData)                                    │
│      .handler(...)                                                           │
│        - ensureCollection(collectionPath)                                    │
│        - resolveUploadFieldName(definition, 'image')   ← per-field selector  │
│        - storage = field.upload.storage ?? serverConfig.storage              │
│        - buffer = await file.arrayBuffer()                                   │
│        - imageProcessor = { extractMeta, isBypassMimeType,                   │
│                             generateVariants } from @byline/storage-local    │
│        - requestContext = await getAdminRequestContext()                     │
│        - calls coreUploadField(ctx, { ..., shouldCreateDocument: false })    │
│                                ▼                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ packages/core/src/services/field-upload.ts                             │  │
│  │   uploadField(ctx, params)                                             │  │
│  │     1. assertActorCanPerform(rc, collectionPath, 'create')             │  │
│  │     2. findUploadField(definition.fields, 'image')                     │  │
│  │     3. read field.upload  (mimeTypes, maxFileSize, sizes, hooks)       │  │
│  │     4. validate mimeType + fileSize against field.upload               │  │
│  │     5. sanitiseFilename + run beforeStore hook chain                   │  │
│  │        (may rename or short-circuit with ERR_VALIDATION)               │  │
│  │     6. storage.upload(buffer, { filename, mimeType, ... })             │  │
│  │     7. imageProcessor.extractMeta(buffer, mimeType)                    │  │
│  │     8. if image + sizes → imageProcessor.generateVariants()            │  │
│  │        → persistedVariants[] (storagePath/url/width/height/format)     │  │
│  │     9. build StoredFileValue (incl. variants[])                        │  │
│  │    10. run afterStore hook chain                                       │  │
│  │    11. shouldCreateDocument===false → return { storedFile }            │  │
│  │        (the createDocument(...) branch is skipped on this round-trip)  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                ▲                                             │
└────────────────────────────────┼─────────────────────────────────────────────┘
                                 │  StoredFileValue
                                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ BROWSER (continues handleSubmit)                                             │
│                                                                              │
│  c. for each successful upload: setFieldValue(fieldPath, storedFile)         │
│       — replaces the PendingStoredFileValue with the real one                │
│  d. clearPendingUploads() (revokes blob URLs)                                │
│  e. onSubmit({ data, patches, systemPath })                                  │
│       → routes to admin "create" or "update" server fn                       │
│         packages/host-tanstack-start/src/server-fns/collections/create.ts    │
│         (or update.ts) — calls document-lifecycle createDocument /           │
│         updateDocument with the now-real StoredFileValue in `data.image`     │
│                                                                              │
│  Net result: TWO server round-trips per save —                               │
│    (1) per-field upload  → field-upload.ts                                   │
│    (2) document write    → document-lifecycle.ts                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

**When `field-upload.ts` is invoked.** In the form flow above the service is called **once per pending file**, on a separate round-trip *before* the document save, with `shouldCreateDocument: false`. The document save is a second, independent server fn (`create.ts` / `update.ts`) that goes through `document-lifecycle.ts`. The `shouldCreateDocument: true` branch — which calls `createDocument` from `document-lifecycle` and rolls back storage on failure — is the alternate, **single-shot** path for callers that aren't going through a form (CLI imports, scripted ingest). It is *not* what the admin form takes.

### Files vs images

Both are handled. The code is symmetric on `'image' | 'file'`:

- `findUploadField` matches `field.type === 'image' || field.type === 'file'`.
- `getUploadFields` / `resolveUploadFieldName` in the host server fn treat them the same.
- Image-only steps (`extractMeta`, `generateVariants`) are gated by `mimeType.startsWith('image/')` and `imageProcessor?.generateVariants` — `file` fields just skip them and persist the raw `StoredFileValue`.
- The UI ships both `ImageUploadField` and `FileField`; both register through the same `addPendingUpload` → `executeUploads` → `uploadField` transport.

**SVG bypass.** The storage-local image processor exports `isBypassMimeType(mimeType)` which returns `true` for `image/svg+xml`. The processor skips meta extraction and variant generation for those; the persisted `StoredFileValue.variants` is absent. `ResponsiveImage` (`apps/webapp/src/ui/byline/components/responsive-image/`) detects the SVG case and falls through to the raw `<img src>` — see QR recipe 11.

### How uploaded files are stored

The upload round-trip writes **bytes only**, not database rows. With `shouldCreateDocument: false`, the only durable state `field-upload.ts` touches is `storage.upload(buffer, ...)` (and, for images, the variant writes inside `imageProcessor.generateVariants`). For the local provider that means:

```
buildStoragePath(collection, filename)  →  'media/<uuidv4>-<sanitised-filename>'
fs.mkdirSync(...) + fs.writeFile(absolutePath, buffer)
```

(see `packages/storage-local/src/local-storage-provider.ts`). S3 is the same shape, different backend. The UUIDv4 prefix is what makes it safe to do this without a DB allocation step — the path is collision-free by construction.

The service then synthesises a `StoredFileValue` in memory:

```ts
{
  fileId: crypto.randomUUID(),
  filename, originalFilename, mimeType, fileSize,
  storageProvider: 'local' | 's3',
  storagePath:    'media/<uuid>-photo.jpg',
  storageUrl:     '/uploads/media/<uuid>-photo.jpg',
  imageWidth, imageHeight, imageFormat,
  processingStatus: 'complete',
  variants: [{ name, storagePath, storageUrl, width, height, format }, ...],
}
```

…and returns it. **No row in `store_file`, `store_meta`, `documents`, or `document_versions` is created on this round-trip.** That is by design: there is no document yet to attach `store_*` rows to (`document_version_id` is the FK target).

**What carries the file across the gap.** The `StoredFileValue` JSON. The browser receives it, `setFieldValue(fieldPath, storedFile)` stores it in form state replacing the `PendingStoredFileValue` placeholder, and `onSubmit({ data, patches })` ships `data.image = StoredFileValue` to `create.ts` / `update.ts`. The lifecycle write goes through `flattenFieldSetData` and lands a `store_file` row whose value column holds the paths the upload step already wrote. **The file row is the first DB record that knows the bytes exist.**

```
Round-trip 1 (field upload):       bytes → storage.   StoredFileValue → browser.
                                   ─────────────────────────────────────────────
                                   gap: no DB knows this file exists.
                                   ─────────────────────────────────────────────
Round-trip 2 (document save):      data.image: StoredFileValue → store_file row
                                                              + store_meta + document_version
```

**Consequences of the gap.** Orphaned files are possible. There is no orphan sweeper today. Failure modes that leak files:

- User closes the tab after upload and before Save.
- User picks a file, fails form validation, picks a different file, saves — first file is orphaned.
- The document-save server fn errors after upload returned 200 (e.g. a unique-constraint violation, a `beforeCreate` rejection).
- Network blip between the two round-trips.
- Hard browser refresh — the `StoredFileValue` only lives in form state, so a reload before save abandons the file in storage.

The single-shot `shouldCreateDocument: true` path does not have this gap. Storage write and document write are in the same handler, and the explicit `storage.delete(...)` rollback runs on document-creation failure inside `field-upload.ts`. Closing the gap on the form path is tracked as a future direction — see [Open questions](#open-questions).

### Variant persistence on `store_file`

`byline_store_file` carries a `variants jsonb` column that round-trips an array of:

```ts
interface PersistedVariant {
  name: string                  // matches the UploadConfig.sizes[].name
  storagePath: string
  storageUrl?: string
  width?: number
  height?: number
  format?: string               // e.g. 'webp', 'avif'
}
```

A jsonb column rather than a sidecar `byline_store_file_variants` table because variants are always read together with the file row, never queried independently; cardinality is small (5–10 entries per file in the worst case); and jsonb keeps the EAV `UNION ALL` reconstruction path simple.

`restoreFieldSetData` populates the file envelope with the persisted `variants` array whenever it's present:

```jsonc
{
  "image": {
    "fileId": "...",
    "storagePath": "media/abc.jpg",
    "storageUrl": "/uploads/media/abc.jpg",
    "imageWidth": 2048,
    "imageHeight": 1363,
    "imageFormat": "jpeg",
    "processingStatus": "complete",
    "variants": [
      { "name": "thumbnail", "storagePath": "media/abc-thumbnail.avif", "storageUrl": "/uploads/media/abc-thumbnail.avif", "width": 400, "height": 400, "format": "avif" },
      { "name": "card",      "storagePath": "media/abc-card.avif",      "storageUrl": "/uploads/media/abc-card.avif",      "width": 600,             "format": "avif" },
      // ...
    ]
  }
}
```

This is the single source of truth — the upload service does not return a separate top-level variants list. Public clients reading via `@byline/client` see `result.fields.image.variants` and can build a `<picture>` / `srcset` without a second round-trip. When the field is reached via a relation, `populateDocuments` carries the same envelope on the populated relation value.

### The transport endpoint

The upload route is auto-mounted as a TanStack Start server function at:

```
POST /admin/api/<collection-path>/upload
```

It accepts FormData with:

| key              | required | meaning                                                             |
|------------------|----------|---------------------------------------------------------------------|
| `file`           | yes      | the `File`                                                          |
| `collection`     | yes      | the collection path (e.g. `'media'`)                                |
| `field`          | sometimes| name of the upload-capable field; required when the collection has more than one upload-capable field |
| `createDocument` | no       | `'false'` skips the document-creation step; defaults to `'true'`    |
| any other key    | no       | string form values forwarded as `fields` to the upload service / hooks |

Field resolution (`resolveUploadFieldName` in `packages/host-tanstack-start/src/server-fns/collections/upload.ts`):

- Explicit `field` wins — the field must exist and be `image | file`, otherwise `ERR_VALIDATION`.
- Absent `field` + exactly one upload-capable field → that field is used.
- Absent `field` + zero upload-capable fields → `ERR_VALIDATION`.
- Absent `field` + multiple upload-capable fields → `ERR_VALIDATION` listing the candidates.

The endpoint always operates on a **single field at a time**. Multi-file forms upload sequentially; the orchestration is the client's problem, not the transport's. `executeUploads` (`packages/ui/src/forms/upload-executor.ts`) is the in-form orchestrator.

> **Stable HTTP boundary.** The current transport is internal to the TanStack Start app. A stable, framework-agnostic HTTP upload boundary is intentionally deferred until the first non-admin client (mobile, desktop, third-party) lands and forces the transport surface to be designed across the full read / write / upload surface, not just uploads. See [ROUTING-API.md](./ROUTING-API.md).

### `beforeStore` and `afterStore` hooks

Server-side hooks live on `field.upload.hooks`. They bracket the storage provider's write step — not the network transmission, since by the time a hook fires the bytes are already on the server (an in-memory `Buffer` today; a `/tmp` file with a future streaming adapter — the contract is agnostic).

**Validation order.** Hooks never see a file that's about to be rejected. The full pipeline:

1. `assertActorCanPerform(rc, collectionPath, 'create')` — auth gate
2. resolve target field, read `field.upload`
3. **mime type check** — rejects via `ERR_VALIDATION`
4. **file size check** — rejects via `ERR_VALIDATION`
5. `beforeStore` chain (may rename, may reject)
6. `storage.upload(buffer, { filename: effectiveFilename, … })`
7. metadata extraction (Sharp)
8. variant generation (Sharp + storage writes)
9. `afterStore` chain
10. (single-shot mode only) document version creation

**`beforeStore` signature:**

```ts
interface BeforeStoreContext {
  fieldName: string                      // which field is being uploaded to
  field: ImageField | FileField          // full field definition
  filename: string                       // sanitised default; hook may override
  mimeType: string
  fileSize: number
  fields: Record<string, string>         // OTHER form values from the same submission
  collectionPath: string
  requestContext: RequestContext         // for actor.id, tenant prefixes, etc.
}

type BeforeStoreResult =
  | string                               // override filename
  | { filename?: string }                // override filename (object form)
  | { error: string }                    // reject the upload — surfaces as ERR_VALIDATION
  | void                                 // keep defaults

type BeforeStoreHookFn = (
  ctx: BeforeStoreContext
) => BeforeStoreResult | Promise<BeforeStoreResult>
```

Multi-function chains stack with **fold semantics** — see Quick Reference recipe 5 for a worked three-step chain. Returning a string (or `{ filename }`) substitutes the new filename for the next function's `ctx.filename`. Returning `void` keeps the current filename. Returning `{ error }` short-circuits with `ERR_VALIDATION` — no file is written, no variants generated, no later hook runs, no document is created. The override threads through to `storage.upload(...)`, so generated variant filenames (`<basename>-<variantName>.<ext>`) automatically inherit the new prefix.

**`afterStore` signature:**

```ts
interface AfterStoreContext {
  fieldName: string
  field: ImageField | FileField
  storedFile: StoredFileValue            // includes the persisted variants array
  fields: Record<string, string>
  collectionPath: string
  requestContext: RequestContext
}

type AfterStoreHookFn = (
  ctx: AfterStoreContext
) => void | Promise<void>
```

`afterStore` runs every function in declaration order. Failures are logged via `logger.error` but do **not** roll back the storage write, consistent with how `afterCreate` / `afterUpdate` behave — hooks run *outside* the storage transaction.

**Why `beforeStore` / `afterStore` and not `beforeUpload` / `afterUpload`.** The names bracket the *storage provider's write step*, not the client→server transmission. By the time the hook fires, the bytes have already crossed the network. `beforeStore` / `afterStore` is unambiguous, leaves /tmp / streaming / buffering mechanics to the framework, and composes cleanly with the storage provider naming (`storage-local`, `storage-s3`). This deliberately diverges from a more common `beforeUpload` / `afterUpload` convention. Hooks for non-upload field types — when they eventually arrive — will live under a separate `field.serverHooks` slot rather than colliding with this contract or with the existing client-side `field.hooks`.

### Reading uploaded files

The `StoredFileValue` envelope is the read shape, identical whether the field is read directly off a document or through a populated relation:

```ts
interface StoredFileValue {
  fileId: string
  filename: string
  originalFilename: string
  mimeType: string
  fileSize: number
  storageProvider: string
  storagePath: string
  storageUrl?: string
  fileHash?: string
  imageWidth?: number
  imageHeight?: number
  imageFormat?: string
  processingStatus: 'pending' | 'complete' | 'error'
  thumbnailGenerated?: boolean
  variants?: PersistedVariant[]
}
```

- **Direct read** — `client.collection('media').findById(id)` returns a document whose `fields.image` is a `StoredFileValue`.
- **Through a relation** — `client.collection('news').find({ populate: { featureImage: '*' } })` returns each news document with `fields.featureImage.document.fields.image` as the same envelope. `populateDocuments` carries the variants along; no second round-trip.

For non-image uploads, `variants` is absent and `imageWidth` / `imageHeight` / `imageFormat` are absent — the rest of the envelope is identical.

**Reference rendering components** (in this repo, not in the package — copy as a starting point for your own host):

| Component | Location | Role |
|---|---|---|
| `ResponsiveImage` | `apps/webapp/src/ui/byline/components/responsive-image/index.tsx` | `<picture>` with AVIF + WebP source order, srcSet from variants, sensible `sizes` defaults, SVG bypass. |
| `MediaThumbnail` | `apps/webapp/byline/collections/media/components/media-thumbnail.tsx` | Single-variant lookup (`variants.find((v) => v.name === 'thumbnail')`) for table cells and list rows. |
| Image-source utils | `apps/webapp/src/ui/utils/image-sources.ts` | `getVariant`, `getVariantSrcSet`, `hasVariantFormat`, `VARIANT_MIME` — building blocks `ResponsiveImage` composes. |

### Storage routing

`UploadConfig.storage` is per-field. It falls through to `ServerConfig.storage` (the site-wide default) when omitted. This means:

- Two image fields on the same collection can route to different backends.
- A collection with no per-field overrides uses the site-wide provider for everything.
- A storage provider is identified at write time by `storedFile.storageProvider`; the read path doesn't need to know which provider produced a given file beyond what's already in the envelope.

---

## Open questions

1. **Variant URL freshness.** `storageUrl` is captured at upload time. If a storage provider's `getUrl()` ever depends on per-request state (signed S3 URLs with short TTLs, CDN rewrites), persisted URLs will go stale. Two reasonable options when that lands: (a) store only `storagePath` and resolve `storageUrl` on read via `storage.getUrl()`, or (b) keep both and let the read path re-resolve when the provider opts in. Deferred — `storage-local` and a vanilla S3 with public-read both have stable URLs.
2. **Orphan reaper.** No sweeper exists today for files written in the gap between the upload round-trip and the document save round-trip. A reaper that walks the storage backend and removes files older than N hours whose `storagePath` doesn't appear in any `store_file` row would close the gap cheaply on the local provider; on S3 a lifecycle rule plus an "uncommitted" object tag would do the same. An alternative is a "pending uploads" table that records the storage path at upload time and clears on document save (or TTL).
3. **Image-field constraints beyond upload.** `aspectRatio`, `minWidth` / `maxWidth`, `requiredAlt` — all field-level concerns that don't exist yet. The natural home is `UploadConfig` (or a sibling block on `ImageField`).
4. **Inline-image uploads in richtext.** The richtext inline-image plugin currently relies on a relation to `media`. Field-level `upload` doesn't change that, but it does open the door to an image-block whose own `upload` config defines the variants for inline uses.
5. **Server-side hooks for non-upload field types.** `beforeStore` / `afterStore` is upload-specific by design. Server-side `beforeChange` / `afterChange` for arbitrary fields (e.g. to derive a slug field server-side) would live under a new `field.serverHooks` slot rather than colliding with this contract or with the existing client-side `field.hooks`.

## Code map

| Concern | Location |
|---|---|
| Field-level upload service | `packages/core/src/services/field-upload.ts` |
| Storage provider interface | `packages/core/src/@types/storage-types.ts` |
| `BeforeStoreContext` / `AfterStoreContext` types | `packages/core/src/@types/field-types.ts` |
| Local storage provider | `packages/storage-local/src/local-storage-provider.ts` |
| S3 storage provider | `packages/storage-s3/src/` |
| Image processor (Sharp) | `packages/storage-local/src/image-processor.ts` (`extractImageMeta`, `generateImageVariants`, `isBypassMimeType`) |
| Persistence (`store_file`) | `packages/db-postgres/src/database/schema/index.ts` + `modules/storage/` |
| TanStack server fn (transport) | `packages/host-tanstack-start/src/server-fns/collections/upload.ts` |
| Host integration adapter | `packages/host-tanstack-start/src/integrations/byline-field-services.ts` |
| In-form upload orchestrator | `packages/ui/src/forms/upload-executor.ts` |
| Image upload widget | `packages/ui/src/fields/image/image-upload-field.tsx` |
| File upload widget | `packages/ui/src/fields/file/file-field.tsx` |
| Reference Media schema | `apps/webapp/byline/collections/media/schema.ts` |
| Reference responsive `<picture>` | `apps/webapp/src/ui/byline/components/responsive-image/index.tsx` |
| Reference single-variant lookup | `apps/webapp/byline/collections/media/components/media-thumbnail.tsx` |
| Reference image-source utils | `apps/webapp/src/ui/utils/image-sources.ts` |
