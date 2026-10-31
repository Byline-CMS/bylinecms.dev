---
title: "File / Media Uploads"
path: "file-media-uploads"
summary: "The full upload pipeline: field-level validation, storage providers, image variant generation via Sharp, stored-file content identity, and how the Media collection plus a relation forms a shared library."
---

# File / Media Uploads

Companions:
- [Collections](./index.md) — collection schema and admin (the Media collection is a worked example).
- [Fields](./01-fields.md) — schema/admin split applied to fields, including upload fields.
- [Document Storage](../03-architecture/01-document-storage.md) — `store_file` is the row that backs a persisted upload.
- [Relationships](./03-relationships.md) — `populate` over a `relation` to a media collection carries the file envelope and its variants in one round-trip.
- [Client SDK](../05-reading-and-delivery/01-client-sdk.md) — reading uploaded files (and their variants) via `@byline/client`.
- [Routing & API](../05-reading-and-delivery/02-routing-and-api.md) — the upload transport is an internal TanStack Start server function today; a stable public HTTP boundary is deferred.
- [Fields API](../10-api-reference/03-fields.md#file-and-image-fields) — the `file` and `image` field declarations that opt into this upload contract.
- [Configuration API](../10-api-reference/01-configuration.md#serverconfig) — installation-wide storage and filename-slugifier registration.

## Overview

Uploads in Byline are a **field-level** concern. You add an `image` or `file` field, give it an `upload` block, and that block carries everything the pipeline needs to validate, store, post-process, and hook into the bytes:

- `mimeTypes` — what the field accepts
- `maxFileSize` — per-file size cap
- `location` — declarative storage-key scope replacing the `<collectionPath>/` default
- `sizes` — Sharp-driven image variants (named, with width / height / fit / format / quality)
- `storage` — optional per-field storage provider, falling through to the site-wide default
- `hooks` — `beforeStore` / `afterStore` server-side hooks with rich field-and-form context

This is unlike the more common "the collection *is* a media library" model. In Byline a collection is just a bag of fields, and any of those fields may happen to be upload-capable. Two consequences fall out of that:

1. A single collection can carry multiple, independently-configured upload fields. A `Profile` collection can have `avatar` (image, square crops, 5 MB) *and* `signaturePdf` (file, application/pdf, 2 MB) without any schema gymnastics.
2. Two image fields on the same collection can route to different storage backends (avatars on the local disk, editorial images on S3) without inventing a new abstraction.

**Two patterns, one mechanism:**

- **Shared media library.** A dedicated `Media` collection has a single upload-capable `image` field. Other collections relate to it via `relation { targetCollection: 'media' }`. Variants ride along on the populated relation envelope. Right when assets are reused across documents.
- **Inline upload on a non-media collection.** A `Page` schema drops `{ type: 'image', name: 'heroImage', upload: { sizes: [...] } }` straight into its own fields. No `Media` row, no relation hop, no second admin screen. Right when the file is intrinsic to the document.
- **Both, in the same schema.** A `Page` can have `heroImage` inline *and* `gallery: relation(many) → media` side by side.

The "is this a media library?" question is a UI concern, not a schema one: the admin shows gallery affordances for collections it knows about by convention, not by a flag in the schema.

Every upload also records the file's **content identity**: a SHA-256 `fileHash` of the stored bytes and, when the provider issues one, a `storageValidator` that identifies the stored version. Together they let you detect that the bytes behind a stored file have changed — see [Content identity](#content-identity).

Read this document when you are adding an upload field, configuring image variants, routing a field to a specific storage backend, hooking into the store step to rename files or trigger side effects, or checking whether a stored file has changed.

---

## Quick reference

Each entry is the minimal shape for one task. The "Edit" line tells you which file you actually change; the link at the end points at the deeper architecture section.

### 1. Add an upload field

The minimum: `{ type: 'image' | 'file', upload: {} }`. Defaults work: every mime type accepted, no size cap, no variants. Tighten as needed.

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

AVIF is widely supported across modern browsers (Chrome 85+, Firefox 93+, Safari 16.4+) and typically yields ~20–30% smaller files than WebP at comparable quality. Sharp's avif quality scale is lower-numbered than webp/jpeg: `quality: 55` is a sensible AVIF default; bump to ~80 for WebP.

→ [Variant persistence on `store_file`](#variant-persistence-on-store-file)

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

The upload server function resolves the field by name. Disambiguation rules live in [The transport server function](#the-transport-server-function).

→ [Files vs images](#files-vs-images)

### 4. Route one field to a different storage provider

`UploadConfig.storage` overrides `ServerConfig.storage` per field. Avatars on local disk, editorial images on S3, signatures on a separate bucket, all without inventing a new abstraction.

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

:::warning[upload.storage is server-only]
**Setting it inline leaks into the client bundle.** A collection schema is **isomorphic** (bundled into the browser admin as well as the server). The `import { s3StorageProvider } from '@byline/storage-s3'` above is a *static* import at the top of the schema, so the provider's entire server-only graph (the AWS SDK, `node:*` built-ins) gets dragged into the client bundle. This is the same hazard as a hook statically importing server-only code (see [Collections → Server-only hook registry](./index.md#server-only-hook-registry)), but for a provider *instance*. `ServerConfig.hooks` solves hook attachment; it does not attach per-field storage providers.

Until a first-class per-field storage registry lands, prefer the **site-wide
`ServerConfig.storage` default** (configured server-side in `server.config.ts`)
over inline per-field providers. No collection ships an inline
`upload.storage` today, so this is a latent affordance rather than an active
bug.
:::

→ [Storage routing](#storage-routing)

### 5. Scope a field's storage location (`upload.location`)

Every upload field defaults to a `<collectionPath>/` storage-key scope, so a
collection with several upload fields mixes their objects in one directory.
`upload.location` declares the scope per field (nested segments allowed)
while the provider keeps its own entropy and filename sanitisation beneath it
(`<location>/<filename>-<suffix>.<ext>`). It is plain data (isomorphic-safe, unlike
`upload.storage`) and folds into the collection fingerprint.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
fields: [
  {
    name: 'cover',
    type: 'image',
    upload: { mimeTypes: ['image/*'], location: 'publications/covers' },
  },
  {
    name: 'attachment',
    type: 'file',
    upload: { mimeTypes: ['application/pdf'], location: 'publications/files' },
  },
]
```

Precedence: a `beforeStore` hook returning `{ storagePath }` (verbatim key)
wins over `location`, which wins over the collection default; a `{ filename }`
hook override keeps composing with `location`. Use `location` for static
scoping and hooks for *dynamic* keys (per-document serials, tenant prefixes).
Boot-validated (POSIX segments, no `..`, no stray slashes). Changing it later
does **not** move previously stored objects: existing documents keep their
recorded `storagePath`.

→ [How uploaded files are stored](#how-uploaded-files-are-stored)

### 6. Rename uploaded files via `beforeStore`

The `beforeStore` hook fires after auth + mime/size validation and before the storage write. Return a string to rewrite the filename; return `{ error }` to reject. Generated variant filenames inherit the new prefix automatically (`<basename>-<variantName>.<ext>`).

**Edit:** `apps/webapp/byline/collections/<name>/hooks.ts`, then register the
loader in `apps/webapp/byline/collections/server-hooks.ts`.

```ts
// collections/media/hooks.ts — server-only
import type { UploadHooks } from '@byline/core'

export default {
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
} satisfies UploadHooks

// collections/server-hooks.ts
export const serverHooks = {
  uploads: { 'media.image': () => import('./media/hooks.js') },
} satisfies ServerHooksConfig
```

Multi-function chains stack with fold semantics: each function sees the previous function's filename override. Returning `void` keeps the current filename; returning `{ error }` short-circuits with `ERR_VALIDATION`: no file is written, no variants generated, no later hook runs.

→ [`beforeStore` and `afterStore` hooks](#beforestore-and-afterstore-hooks)

### 7. Audit / notify on success via `afterStore`

`afterStore` runs after the storage write and variant generation, with the persisted `StoredFileValue` in hand. It is specifically best-effort: failures are logged via `logger.error`, do not roll back the storage write, and do not reject the upload.

**Edit:** the server-only upload hook module registered in
`apps/webapp/byline/collections/server-hooks.ts`.

```ts
import type { UploadHooks } from '@byline/core'

export default {
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
} satisfies UploadHooks
```

→ [`beforeStore` and `afterStore` hooks](#beforestore-and-afterstore-hooks)

### 8. Read an uploaded image on the public side

The `StoredFileValue` envelope round-trips intact through `@byline/client`. Variants ride along (no second round-trip) so you can build a `<picture>` / `srcset` directly.

**Edit:** a server fn or component reading the document. For the Media collection, `apps/webapp/src/modules/news/details.ts` reads `featureImage` via populate.

```ts
import type { StoredFileValue } from '@byline/core'

const doc = await client.collection('media').findById(id)
const image = doc?.fields.image as StoredFileValue | undefined

console.log(image?.storageUrl)              // /uploads/media/abc.jpg
console.log(image?.imageWidth)              // 2048
console.log(image?.variants?.length)        // 5
```

For per-image rendering, `apps/webapp/src/ui/byline/components/responsive-image/index.tsx` is the reference `<picture>` component: AVIF-first source order, srcSet computed from the variants, sensible `sizes` defaults.

→ [Reading uploaded files](#reading-uploaded-files)

### 9. Pick a single named variant

For thumbnails and other fixed-size renders, look up the variant by name. The pattern used by `MediaThumbnail`:

**Edit:** any component reading a media document.

```tsx
import type { StoredFileValue } from '@byline/core'

const img = doc.fields.image as StoredFileValue | undefined
const thumb = img?.variants?.find((v) => v.name === 'thumbnail')
const url = thumb?.storageUrl ?? img?.storageUrl   // fallback to original
```

→ [Variant persistence on `store_file`](#variant-persistence-on-store-file)

### 10. Read an uploaded image through a populated relation

When a non-media collection references the Media library, populate carries the entire `StoredFileValue` (including variants) on the related document's `fields.image`. No extra round-trip.

**Edit:** the server fn for the parent collection: `apps/webapp/src/modules/news/list.ts` is the worked example.

```ts
import type { WithPopulated } from '@byline/client'
import type { MediaFields, NewsFields } from '@byline/generated-types'

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

### 11. Call the upload server function directly

For non-form callers (scripted ingest or eventual drag-into-list-view shortcuts),
call the TanStack host's server-function wrapper. Passing `true` stores the bytes
and creates the document in one operation, with storage rollback on failure.

```ts
import { uploadField } from '@byline/host-tanstack-start/server-fns/collections'

const form = new FormData()
form.append('file', file)
form.append('field', 'image') // required when the collection has >1 upload field

const result = await uploadField('media', form, true)
```

The wrapper adds `collection` and `createDocument` to the payload and returns an
`UploadFieldResult`, not an HTTP `Response`. For in-form uploads the admin shell
handles this automatically via `executeUploads` and calls the same transport with
`createDocument: false`, so document save is a separate round-trip carrying the
`StoredFileValue` in `data`.

→ [The transport server function](#the-transport-server-function)

### 12. Use SVG safely

SVG bypass is built in. `ResponsiveImage` short-circuits to the raw `<img src>` when `image.mimeType === 'image/svg+xml'` because variants aren't generated for SVG (no rasterisation, no upscaling). If you accept SVG, ensure your image-rendering component honours that bypass: Byline's `ResponsiveImage` already does.

**Edit:** `apps/webapp/byline/collections/media/schema.ts`: include `'image/svg+xml'` in `mimeTypes`.

```ts
mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml']
```

→ [Files vs images](#files-vs-images)

### 13. Replace the filename slugifier

Stored keys default to `<location|collection>/<slugified-base>-<suffix>.<ext>`
(e.g. `events/meeting-agenda-4fa35g.pdf`). The slugified half comes from the
installation's filename slugifier: the upload parallel of the path
`slugifier`, and replaceable the same way. It receives the **base name only**
(the framework splits, lowercases, and reattaches the extension) plus a
context (`collectionPath`, `fieldName`, `mimeType`) for per-collection
policies. Server-only: filenames are derived exclusively at write time.

**Edit:** `apps/webapp/byline/server.config.ts`

```ts
import type { FilenameSlugifierFn } from '@byline/core'

const filenameSlugifier: FilenameSlugifierFn = (base, { collectionPath }) =>
  `${collectionPath}-${base.toLowerCase().replace(/[^a-z0-9._-]/g, '-')}`

defineServerConfig({
  // ...
  uploads: { filenameSlugifier },
})
```

Falls back to the default `slugifyFilename` from `@byline/core` when not set.
The storage provider re-sanitises as a safety net, and its short random
suffix (verified free via `exists()`, retried on collision) is appended after
whatever this function returns.

→ [How uploaded files are stored](#how-uploaded-files-are-stored)

### 14. Check whether a stored file has changed

Compare the validator recorded on the file with the provider's current one. Read
the bytes with `download`, which returns them together with their own validator,
when you need content you can trust.

**Edit:** your server-side code (an extraction cache, a fixity job).

```ts
import { isSameStorageValidator } from '@byline/core'

const file = doc.fields.attachment // StoredFileValue
if (!file.fileHash || !file.storageValidator) throw new Error('No content identity recorded')

const current = await storage.head?.(file.storagePath)
const unchanged =
  current != null && isSameStorageValidator(current.validator, file.storageValidator)

// Read only the recorded version; fails with ERR_STORAGE_PRECONDITION otherwise.
const read = await storage.download?.(file.storagePath, { expect: file.storageValidator })
```

→ [Content identity](#content-identity)

### 15. Record identity for files uploaded before it existed

Uploads made before content identity shipped have no `fileHash`. Run the
backfill script once per storage provider; it is idempotent and safe to re-run.

**Edit:** nothing — run `apps/webapp/byline/scripts/backfill-file-identity.ts`.

```sh
cd apps/webapp
pnpm tsx byline/scripts/backfill-file-identity.ts --dry-run
pnpm tsx byline/scripts/backfill-file-identity.ts --collection media   # one collection first
pnpm tsx byline/scripts/backfill-file-identity.ts                      # everything
pnpm tsx byline/scripts/backfill-file-identity.ts --verify             # report-only re-hash
```

→ [Backfill and verification](#backfill-and-verification)

---

## Architecture

### `UploadConfig` reference

```ts
interface UploadConfig {
  mimeTypes?: string[]                // e.g. ['image/jpeg', 'image/png', 'image/*', '*/*']
  location?: string                   // storage-key scope, e.g. 'publications/covers'
  maxFileSize?: number                // bytes
  sizes?: ImageSize[]                 // Sharp variants for image MIME uploads
  storage?: IStorageProvider          // overrides ServerConfig.storage for this field
  hooks?: UploadHooks | UploadHooksLoader
  context?: string[]                  // form-value paths posted to upload hooks
  requireSavedDocument?: boolean      // admin UX gate until edit mode
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

Image processing is gated by the uploaded MIME type, configured `sizes`, bypass
status, and processor availability, not by whether the schema field is named
`image` or `file`. A `FileField` that accepts an image MIME can therefore generate
variants; non-image files and bypass types such as SVG skip them.

`context` tells the admin executor which sibling, ancestor, or root form values
to serialize into the hooks' string-valued `ctx.fields`. It always also posts the
full `fieldPath` and, in edit mode, `documentId`; hooks must treat these as
client-supplied claims. `requireSavedDocument` hides the admin upload affordance
until a document id exists, but API callers must still be rejected in
`beforeStore` when that invariant matters. Register server-only upload hook
loaders through `ServerConfig.hooks.uploads`; a loader attached to the
isomorphic schema is still reachable from the browser build.

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
│     packages/admin/src/fields/image/image-upload-field.tsx                   │
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
│     packages/admin/src/forms/form-renderer.tsx → handleSubmit()              │
│       a. runFieldHooks + validateForm                                        │
│       b. getPendingUploads() — non-empty → executeUploads(...)               │
│            packages/admin/src/forms/upload-executor.ts                       │
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
│      .validator(parseUploadFormData)                                    │
│      .handler(...)                                                           │
│        - ensureCollection(collectionPath)                                    │
│        - resolveUploadField(definition, collectionPath, 'image')             │
│        - storage = field.upload.storage ?? serverConfig.storage              │
│        - buffer = await file.arrayBuffer()                                   │
│        - imageProcessor = { extractMeta: extractImageMeta,                   │
│                             isBypassMimeType, generateVariants: wrapper }     │
│          from @byline/core/image                                             │
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
│  │     5. resolveUploadFilename (slugify) + beforeStore hook chain        │  │
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
│    (2) document write    → document-lifecycle/ services                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

**When `field-upload.ts` is invoked.** In the form flow above the service is called **once per pending file**, on a separate round-trip *before* the document save, with `shouldCreateDocument: false`. The document save is a second, independent server fn (`create.ts` / `update.ts`) that goes through the `document-lifecycle/` services. The `shouldCreateDocument: true` branch (which calls `createDocument` from `document-lifecycle` and rolls back storage on failure) is the alternate, **single-shot** path for callers that aren't going through a form (CLI imports, scripted ingest). It is *not* what the admin form takes.

### Files vs images

Both are handled. The code is symmetric on `'image' | 'file'`:

- `findUploadField` matches `field.type === 'image' || field.type === 'file'`.
- `getUploadFields` / `resolveUploadField` in the host server fn treat them the same.
- Metadata extraction is attempted for every upload; the built-in helper returns no image metadata for ordinary files and uses a lightweight parser for SVG. Variant generation alone is gated by image MIME, bypass status, configured sizes, and processor availability. Image MIME uploads through either field type can receive variants.
- The UI ships both `ImageUploadField` and `FileField`; both register through the same `addPendingUpload` → `executeUploads` → `uploadField` transport.

**SVG bypass.** `@byline/core/image` exports `isBypassMimeType(mimeType)`, which returns `true` for `image/svg+xml`. SVG skips Sharp variant generation but retains dimensions/format when its lightweight metadata parser can resolve them; `StoredFileValue.variants` is absent. `ResponsiveImage` (`apps/webapp/src/ui/byline/components/responsive-image/`) detects the SVG case and falls through to the raw `<img src>` (see QR recipe 11).

### How uploaded files are stored

The upload round-trip writes **bytes only**, not database rows. With `shouldCreateDocument: false`, the only durable state `field-upload.ts` touches is `storage.upload(buffer, ...)` (and, for images, the variant writes inside `imageProcessor.generateVariants`). For the local provider that means:

```
availableStoragePath(options)  →  'media/meeting-agenda-4fa35g.pdf'
fs.mkdirSync(...)
fs.writeFile('<path>.<random>.tmp', buffer, { flag: 'wx' })   // a new file beside the target
fs.stat(temporary)  →  storageValidator                        // local-stat: dev:ino:mtimeNs:size
fs.rename(temporary, absolutePath)                             // atomic replace
```

(see `packages/storage-local/src/local-storage-provider.ts`). Writing a new file and renaming it into place means a reader never sees a partly written file, and a reader that already has the old file open keeps reading the old one. S3 is the same shape, different backend. The key is `<location|collection>/<slugified-base>-<suffix>.<ext>`: the filename leads (slugified by the installation's `ServerConfig.uploads.filenameSlugifier`, else the default `slugifyFilename`), and a short 6-char base36 suffix rides before the extension. The provider verifies the candidate key is free (`exists()`) and retries with a fresh suffix on collision (after three straight collisions it falls back to a full-entropy UUID suffix), so the path is collision-safe without a DB allocation step, and downloads arrive with human-readable names.

The service then synthesises a `StoredFileValue` in memory:

```ts
{
  fileId: crypto.randomUUID(),
  filename, originalFilename, mimeType, fileSize,
  storageProvider: 'local' | 's3',
  storagePath:    'media/photo-4fa35g.jpg',
  storageUrl:     '/uploads/media/photo-4fa35g.jpg',
  fileHash:       '9f86d081…',                               // SHA-256 of the stored bytes
  storageValidator: { kind: 'local-stat', value: '…' },      // the stored version
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
- User picks a file, fails form validation, picks a different file, saves: first file is orphaned.
- The document-save server fn errors after upload returned 200 (e.g. a unique-constraint violation, a `beforeCreate` rejection).
- Network blip between the two round-trips.
- Hard browser refresh: the `StoredFileValue` only lives in form state, so a reload before save abandons the file in storage.

The single-shot `shouldCreateDocument: true` path does not have this gap. Storage write and document write are in the same handler, and the explicit `storage.delete(...)` rollback runs on document-creation failure inside `field-upload.ts`. Closing the gap on the form path is tracked as a future direction (see [Current limitations](#current-limitations)).

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

This is the single source of truth: the upload service does not return a separate top-level variants list. Public clients reading via `@byline/client` see `result.fields.image.variants` and can build a `<picture>` / `srcset` without a second round-trip. When the field is reached via a relation, `populateDocuments` carries the same envelope on the populated relation value.

### Content identity

A stored file carries two identity values. They answer different questions and are never compared with each other.

| Value | What it identifies | Shape |
|---|---|---|
| `fileHash` | The **content**: SHA-256 of the original object's bytes. Two files with the same hash have the same bytes. | 64 lower-case hexadecimal characters |
| `storageValidator` | One **stored version** of the object, as the provider names it. Its only use is equality: "is the object at this path still the version I recorded?" | `{ kind: string; value: string }` |

Byline computes `fileHash` itself, in the same pass that hands the bytes to the provider, so every provider gets it without an extra read. Providers must store the original bytes verbatim, so the hash of the received bytes is also the hash of the stored object. Image variants are separate objects and have no hash. When a value is unknown it is **absent** — never `null` or an empty string — and code that needs identity must treat absence as an error, not as a match. The write-side Zod schema rejects an empty or malformed `fileHash`.

The built-in providers issue these validator kinds:

| Provider | Kind | Value |
|---|---|---|
| `@byline/storage-local` | `local-stat` | `<dev>:<ino>:<mtimeNs>:<size>` of the stored file |
| `@byline/storage-s3` | `s3-version` | The object's `VersionId`, when the bucket is versioned |
| `@byline/storage-s3` | `s3-etag` | A strong `ETag` without its quotes, when there is no usable version id |

An S3 `VersionId` of `"null"` — what a never-versioned or versioning-suspended bucket reports — is never used, because successive writes to one key keep that id while the bytes change. A weak ETag (`W/"…"`) is never used either. An ETag is not a content digest: multipart uploads and server-side encryption give ETags that are not the MD5 of the object.

#### Reading the bytes: `download` and `head`

`IStorageProvider` has two optional read methods. Both built-in providers implement them; a custom provider may not, so feature-detect them as you do `move` and `exists`.

```ts
download?(storagePath: string, options?: { expect?: StorageValidator; signal?: AbortSignal })
  : Promise<{ body: NodeJS.ReadableStream; validator: StorageValidator; size?: number } | null>

head?(storagePath: string): Promise<{ validator: StorageValidator; size?: number } | null>
```

- **`download` is a bound read.** The validator it returns comes from the same request (S3) or the same open file handle (local), so it describes exactly the bytes in `body` — even if the object is replaced while you read. It never returns bytes without a validator. Without `expect`, it resolves `null` when no object exists and fails with `ERR_STORAGE` (`details.reason: 'validator-unavailable'`) when the object has no usable validator. With `expect`, those two cases fail with `ERR_STORAGE_PRECONDITION` instead (`missing` and `unestablishable`), as the table below shows.
- **`head` is a change probe, not a provenance source.** The object can change after `head` returns; use `download` when bytes and validator must belong together.
- **`expect` is fail-closed.** With `expect`, the provider exposes the body only when it has established that the current object carries a token of `expect.kind` equal to `expect.value`. The returned `validator` is always the provider's canonical one and may be of a different kind — an `s3-etag` expectation can match a bucket that has since enabled versioning and return an `s3-version` validator. Otherwise the call fails with `ERR_STORAGE_PRECONDITION` and exposes nothing:

| `details.reason` | Meaning |
|---|---|
| `changed` | The object's token of that kind is now different. |
| `unsupported-kind` | The provider does not issue that kind. Checked before any request. |
| `unestablishable` | The kind is supported, but the object has no usable token of it — for example an `s3-version` expectation after versioning was suspended. |
| `missing` | No object exists at the path. |

When a provider lacks one of these capabilities:

| Missing | Effect |
|---|---|
| `head` | No cheap change probe. Use `download` with `expect` (it streams only on a match) or re-hash. Uploads, bound reads and the backfill are unaffected. |
| `download` | No bound reads; backfill and verification refuse to run, so legacy rows stay without identity. New uploads still record `fileHash`. |
| A validator from `upload` or `move` | Those operations record `fileHash` but no `storageValidator`; detecting a change then needs a re-hash. The backfill does not depend on it — it records the validator `download` returns. |

Each capability stands alone: a provider with only `upload`, `delete` and `getUrl` still gets a `fileHash` on every new upload.

#### Writes, moves and what the guarantee covers

`@byline/storage-local` never modifies a stored file in place: uploads write a new file beside the target and rename it over the path. `move` first renames the source to a private name — which takes exactly the file that is there at that moment — reads its validator, and then renames it onto the destination. Across filesystems (`EXDEV`) it copies to a temporary file beside the destination, renames that into place, and removes only the private copy, so a file uploaded to the source path meanwhile is never deleted. If a move fails before the destination is written, the provider puts the source back, or throws `ERR_STORAGE` naming the path that still holds the content. The local guarantee covers Byline's own writers: a process outside Byline that writes into a stored file in place can change bytes under an open reader.

#### Trust boundary

Byline's admin user interface uploads a file, receives the `StoredFileValue`, and sends it back inside the document on save; the server persists what the client sends, as it already does for `storagePath`. A saved `fileHash` or `storageValidator` is therefore as trustworthy as the editor's write permission on that collection. When you need assurance, re-hash through `download` — the backfill's verify mode does exactly that.

#### Backfill and verification

Files uploaded before content identity shipped have no `fileHash`. `backfillStoredFileIdentity` from the server-only entry `@byline/core/stored-files` fills them, and the reference script `apps/webapp/byline/scripts/backfill-file-identity.ts` wraps it (flags `--verify`, `--collection <path>`, `--dry-run`, `--limit <n>`, `--batch-size <n>`).

- **Fill** (default) selects storage paths with no hash, written by the configured provider (and one collection, with `--collection`). It reads each path once with `download`, hashes it, and records the hash and the bound validator on every row for that path that still has no hash. It never overwrites a recorded hash, so it is idempotent and an interrupted run resumes cleanly. Rows written by another provider are not selected; an installation that has used several providers runs it once with each configured.
- **Verify** (`--verify`) re-hashes paths that already have a hash and reports each recorded hash as matched or mismatched. It writes nothing.
- **Legacy-null policy.** A missing object or a read failure leaves the rows without identity and is reported. A provider without `download` makes the run refuse to start.
- **Historical versions.** Backfill hashes the bytes present now. Where an older version's object was later replaced at the same path, the recorded hash describes the current bytes — which the recorded validator identifies — not the historical ones, which an unversioned store cannot recover.

Storage paths, provider names and recorded digests compare **exactly** (bytes, not collation): `a.pdf` and `a.pdf ` are different paths, and `LOCAL` is not `local`.

#### Persistence

`byline_store_file` stores the hash in `file_hash` and the validator in the pair `storage_validator_kind` (`varchar(32)`) / `storage_validator_value` (`varchar(1024)`), both `NULL` when unknown. Existing installations add the validator columns with the upgrade script `packages/db-postgres/sql/0015_add-stored-file-validator.sql` or `packages/db-mysql/sql/0010_add-stored-file-validator.sql`.

### Immutable media retention

Byline treats each stored source path and each persisted variant path as part of an immutable
document version. Replacing media writes a new file envelope for the new version; it does not
rewrite the envelope held by an older version. Duplicating a document can also carry the same
stored paths into another logical document. A source or variant path can therefore have several
retained database references.

:::warning[Soft delete does not reclaim storage]
Soft delete tombstones every version and releases the document's live path, but it deletes no
source files or generated variants. The document's field rows and stored path values remain
available for trusted history and a future whole-document restoration workflow.

Byline has no supported purge or reference-safe storage reclamation operation. Do not infer that
an object is unreferenced from one deleted document or one current version, and do not delete it
from an `afterDelete` hook unless your application maintains a separate, authoritative ownership
model.
:::

This retention rule is separate from **upload compensation**. When an operation has just written a
new source and variants but fails to create their owning document, the upload/import path attempts
to delete those newly written objects. That rollback knows which objects the failed operation
created; soft delete has no equivalent proof of exclusive ownership.

Persisted `variants` metadata is enough to read the generated objects, but it is not a complete
regeneration recipe. It records names, paths, dimensions, and formats, not every requested bound,
fit, quality, or processor/version that produced the bytes. Changing `UploadConfig.sizes` does not
rewrite historical media. [Issue #72](https://github.com/Byline-CMS/bylinecms.dev/issues/72) owns
the design for recipe persistence, shared-reference analysis,
regeneration compatibility, retry/idempotency, and eventual cleanup. Until that design is approved,
sources and persisted variants have the same indefinite retention behavior.

### The transport server function

Uploads currently travel through a TanStack Start server function. Its generated
wire URL is a TanStack implementation detail, not a Byline-owned HTTP endpoint,
and it is not mounted beneath `routes.admin` or `routes.api`. Call the exported
`uploadField(collection, formData, createDocument)` wrapper or use the injected
`UploadFieldFn` rather than constructing a URL.

The underlying handler accepts FormData with:

| key              | required | meaning                                                             |
|------------------|----------|---------------------------------------------------------------------|
| `file`           | yes      | the `File`                                                          |
| `collection`     | yes      | the collection path (e.g. `'media'`)                                |
| `field`          | sometimes| name of the upload-capable field; required when the collection has more than one upload-capable field |
| `createDocument` | no       | `'false'` skips the document-creation step; defaults to `'true'`    |
| any other key    | no       | string form values forwarded as `fields` to the upload service / hooks |

Field resolution (`resolveUploadField` in `packages/host-tanstack-start/src/server-fns/collections/upload.ts`):

- Explicit `field` wins: the field must exist and be `image | file`, otherwise `ERR_VALIDATION`.
- Absent `field` + exactly one upload-capable field → that field is used.
- Absent `field` + zero upload-capable fields → `ERR_VALIDATION`.
- Absent `field` + multiple upload-capable fields → `ERR_VALIDATION` listing the candidates.

The server function always operates on a **single field at a time**. Multi-file
forms upload sequentially; the orchestration is the client's problem, not the
transport's. `executeUploads`
(`packages/admin/src/forms/upload-executor.ts`) is the in-form orchestrator.

:::note[Stable HTTP boundary]
The current transport is internal to the TanStack Start app. A stable, framework-agnostic HTTP upload boundary is intentionally deferred until the first non-admin client (mobile, desktop, third-party) lands and forces the transport surface to be designed across the full read / write / upload surface, not just uploads. See [Routing & API](../05-reading-and-delivery/02-routing-and-api.md).
:::

### `beforeStore` and `afterStore` hooks

Server-side hooks are attached to `field.upload.hooks` during server
initialization, normally from `ServerConfig.hooks.uploads`. They bracket the
storage provider's write step, not the network transmission, since by the time
a hook fires the bytes are already on the server (an in-memory `Buffer` today;
a `/tmp` file with a future streaming adapter: the contract is agnostic).

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
  filename: string                       // slugified default; hook may override
  storagePath?: string                   // override from an earlier hook
  mimeType: string
  fileSize: number
  fields: Record<string, string>         // OTHER form values from the same submission
  collectionPath: string
  requestContext: RequestContext         // for actor.id, tenant prefixes, etc.
  storage: IStorageProvider              // resolved provider for this upload
}

type BeforeStoreResult =
  | string                               // override filename
  | { filename?: string; storagePath?: string } // override name and/or full key
  | { error: string }                    // reject the upload — surfaces as ERR_VALIDATION
  | void                                 // keep defaults

type BeforeStoreHookFn = (
  ctx: BeforeStoreContext
) => BeforeStoreResult | Promise<BeforeStoreResult>
```

Multi-function chains stack with **fold semantics**: see Quick Reference recipe 5 for a worked three-step chain. Returning a string (or `{ filename }`) substitutes the new filename for the next function's `ctx.filename`. Returning `{ storagePath }` takes full control of the POSIX storage key: core trims it and removes leading slashes, then passes it as `targetStoragePath` without the normal UUID or collection prefix; later hooks receive the normalized value on `ctx.storagePath`. The hook is responsible for sanitization beyond that normalization and for collision avoidance (it can inspect optional provider capabilities through `ctx.storage`). Returning `void` keeps the current values. Returning `{ error }` short-circuits with `ERR_VALIDATION`: no file is written, no variants generated, no later hook runs, no document is created. Filename and path overrides thread through to generated variant sibling paths.

**`afterStore` signature:**

```ts
interface AfterStoreContext {
  fieldName: string
  field: ImageField | FileField
  storedFile: StoredFileValue            // includes the persisted variants array
  fields: Record<string, string>
  collectionPath: string
  requestContext: RequestContext
  storage: IStorageProvider
}

type AfterStoreHookFn = (
  ctx: AfterStoreContext
) => void | Promise<void>
```

`afterStore` runs every function in declaration order. Failures are logged via
`logger.error` and do **not** roll back the storage write or reject the upload.

**Why `beforeStore` / `afterStore` and not `beforeUpload` / `afterUpload`.** The names bracket the *storage provider's write step*, not the client→server transmission. By the time the hook fires, the bytes have already crossed the network. `beforeStore` / `afterStore` is unambiguous, leaves /tmp / streaming / buffering mechanics to the framework, and composes cleanly with the storage provider naming (`storage-local`, `storage-s3`). This deliberately diverges from a more common `beforeUpload` / `afterUpload` convention. Hooks for non-upload field types (when they eventually arrive) will live under a separate `field.serverHooks` slot rather than colliding with this contract or with the existing client-side `field.hooks`.

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
  fileHash?: string                     // SHA-256 of the stored bytes; absent when unknown
  storageValidator?: StorageValidator   // { kind, value } of the stored version; absent when unknown
  imageWidth?: number
  imageHeight?: number
  imageFormat?: string
  processingStatus: 'pending' | 'processing' | 'complete' | 'failed'
  thumbnailGenerated?: boolean
  variants?: PersistedVariant[]
}
```

- **Direct read** — `client.collection('media').findById(id)` returns a document whose `fields.image` is a `StoredFileValue`.
- **Through a relation** — `client.collection('news').find({ populate: { featureImage: '*' } })` returns each news document with `fields.featureImage.document.fields.image` as the same envelope. `populateDocuments` carries the variants along; no second round-trip.

For non-image uploads, `variants` is absent and `imageWidth` / `imageHeight` / `imageFormat` are absent: the rest of the envelope is identical.

**Reference rendering components** (in this repo, not in the package; copy as a starting point for your own host):

| Component | Location | Role |
|---|---|---|
| `ResponsiveImage` | `apps/webapp/src/ui/byline/components/responsive-image/index.tsx` | `<picture>` with AVIF + WebP source order, srcSet from variants, sensible `sizes` defaults, SVG bypass. |
| `MediaThumbnail` | `apps/webapp/byline/collections/media/components/media-thumbnail.tsx` | Single-variant lookup (`variants.find((v) => v.name === 'thumbnail')`) for table cells and list rows. |
| Image-source utils | `apps/webapp/src/ui/utils/image-sources.ts` | `getVariant`, `getVariantSrcSet`, `hasVariantFormat`, `VARIANT_MIME`: building blocks `ResponsiveImage` composes. |

### Storage routing

`UploadConfig.storage` is per-field. It falls through to `ServerConfig.storage` (the site-wide default) when omitted. This means:

- Two image fields on the same collection can route to different backends.
- A collection with no per-field overrides uses the site-wide provider for everything.
- A storage provider is identified at write time by `storedFile.storageProvider`; the read path doesn't need to know which provider produced a given file beyond what's already in the envelope.

---

## Current limitations

- **Variant URLs are captured at upload time.** `storageUrl` is persisted when the
  file is stored, so a provider whose URLs depend on per-request state (short-TTL
  signed S3 URLs, CDN rewrites) can serve stale URLs. The local provider and a
  public-read S3 bucket both have stable URLs, so this does not bite today.
- **No orphan reaper.** A file written in the gap between the upload round-trip and
  the document save is not swept up if the save never happens. On S3 a lifecycle
  rule covers it; the local provider has no equivalent yet.
- **No reference-safe purge or general regeneration contract.** Soft-deleted sources and variants
  remain stored because immutable versions and duplicated documents can share their paths, and
  legacy variant rows do not retain a complete generation recipe. [Issue #72](https://github.com/Byline-CMS/bylinecms.dev/issues/72)
  tracks the required design.
- **Variants have no content identity.** `fileHash` and `storageValidator` cover the original
  object only; generated variants are not hashed.
- **Content identity is client-supplied on save.** See [Trust boundary](#trust-boundary).
- **Image constraints are upload-only.** Aspect-ratio, min/max dimensions, and
  required-alt validation are not yet expressible on an image field.

## Code map

| Concern | Location |
|---|---|
| Field-level upload service | `packages/core/src/services/field-upload.ts` |
| Storage provider interface (incl. `download` / `head`, `StorageValidator`) | `packages/core/src/@types/storage-types.ts` |
| Content hashing (browser-safe) | `packages/core/src/storage/content-hash.ts` |
| Stream hashing and backfill (`@byline/core/stored-files`) | `packages/core/src/storage/stored-files-server.ts` |
| Storage provider conformance suite | `packages/storage-conformance/src/index.ts` |
| Backfill adapter primitives | `packages/db-postgres/src/modules/storage/stored-files.ts`, `packages/db-mysql/src/modules/storage/stored-files.ts` |
| Backfill script (reference) | `apps/webapp/byline/scripts/backfill-file-identity.ts` |
| `BeforeStoreContext` / `AfterStoreContext` types | `packages/core/src/@types/collection-types.ts` |
| Local storage provider | `packages/storage-local/src/local-storage-provider.ts` |
| S3 storage provider | `packages/storage-s3/src/` |
| Image processor (Sharp) | `packages/core/src/image/image-processor.ts` (`extractImageMeta`, `generateImageVariants`, `isBypassMimeType`) |
| Persistence (`store_file`) | `packages/db-postgres/src/database/schema/index.ts` + `modules/storage/` |
| TanStack server fn (transport) | `packages/host-tanstack-start/src/server-fns/collections/upload.ts` |
| Host integration adapter | `packages/host-tanstack-start/src/integrations/byline-field-services.ts` |
| In-form upload orchestrator | `packages/admin/src/forms/upload-executor.ts` |
| Image upload widget | `packages/admin/src/fields/image/image-upload-field.tsx` |
| File upload widget | `packages/admin/src/fields/file/file-field.tsx` |
| Reference Media schema | `apps/webapp/byline/collections/media/schema.ts` |
| Reference responsive `<picture>` | `apps/webapp/src/ui/byline/components/responsive-image/index.tsx` |
| Reference single-variant lookup | `apps/webapp/byline/collections/media/components/media-thumbnail.tsx` |
| Reference image-source utils | `apps/webapp/src/ui/utils/image-sources.ts` |
