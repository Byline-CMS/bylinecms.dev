# File / Media Upload — Analysis & Plan

> Last updated: 2026-05-01
> Companions:
> - [STORAGE-ANALYSIS.md](./STORAGE-ANALYSIS.md) — `store_file` is the
>   row this analysis proposes to extend.
> - [RELATIONSHIPS-ANALYSIS.md](./RELATIONSHIPS-ANALYSIS.md) — populate
>   over a `relation` to a media collection is one of the two patterns
>   this analysis preserves.
> - [ROUTING-API-ANALYSIS.md](./ROUTING-API-ANALYSIS.md) — the auto-mounted
>   upload endpoint changes shape (gains a `field` selector); the broader
>   stable-HTTP boundary is still deferred.

## Context

Today an upload-capable collection is declared by hanging an `upload`
block off the `CollectionDefinition` itself:

```ts
export const Media: CollectionDefinition = {
  path: 'media',
  upload: {
    mimeTypes: ['image/jpeg', ...],
    maxFileSize: 20 * 1024 * 1024,
    sizes: [
      { name: 'thumbnail', width: 400, height: 400, fit: 'cover', format: 'webp' },
      { name: 'card',      width: 600, fit: 'inside', format: 'webp' },
      // ...
    ],
    storage: s3StorageProvider({ ... }), // optional, falls back to ServerConfig.storage
  },
  fields: [
    { name: 'image', label: 'Image', type: 'image' },
    { name: 'title', label: 'Title', type: 'text' },
    // ...
  ],
}
```

The presence of `upload` on the collection is the discriminator that
auto-mounts `POST /admin/api/<collection-path>/upload` and turns the
collection into a "media library." The upload service reads
`upload.mimeTypes` / `upload.maxFileSize` / `upload.sizes` /
`upload.storage` directly off the collection, and the first
`image | file` field is treated implicitly as the focal upload target.

This document captures the limitations of that model, proposes
moving `UploadConfig` onto `ImageField` and `FileField` themselves,
and lays out the implementation plan. Because Byline has no
production deployments yet, the migration is greenfield — there is
no compatibility shim to preserve.

## What's wrong with collection-level `upload`

Three issues, in increasing order of severity:

1. **One focal file per collection.** A schema can only declare a
   single upload field — every `image | file` after the first has no
   constraints, no storage routing, and no variants. A `Profile`
   collection that wants `avatar` (image, square crop, 5 MB, two
   thumbnail sizes) plus `signaturePdf` (file, application/pdf, 2 MB)
   inline can't be expressed.
2. **Implicit focal-field convention.** "First image/file field is
   the upload target" is a comment in the Media schema, not a typed
   contract. There's no way to address a specific field on the upload
   endpoint.
3. **Variants aren't persisted.** `imageProcessor.generateVariants`
   produces a `[{ name, storagePath }]` list at upload time and the
   service computes URLs from it (`document-upload.ts:280`), but the
   list is **only** returned to the caller of the upload endpoint —
   there is no `variants` column on `byline_store_file`. As a
   result, a subsequent `GET` of the document returns the focal
   file's metadata (`storageUrl`, `imageWidth`, etc.) but not the
   variant URLs needed to build a `<picture>` / `srcset`. This is the
   bug that surfaced the design question.

(2) and (3) are independently fixable inside the current model — you
could add a `?field=<name>` param to the upload endpoint without moving
config, and you could persist variants without touching field shapes.
But the underlying assumption ("one focal file, sized identically")
locks the schema into the Payload-shaped media-library pattern. Lifting
config onto the field unblocks both of those, and a third pattern below
that the current model can't express at all.

## Proposed model: `upload?: UploadConfig` on `ImageField` and `FileField`

The change is mechanical:

```ts
// packages/core/src/@types/field-types.ts
export interface ImageField extends NonlocalizableField {
  type: 'image'
  upload?: UploadConfig
}

export interface FileField extends NonlocalizableField {
  type: 'file'
  upload?: UploadConfig
}

// packages/core/src/@types/collection-types.ts
export interface CollectionDefinition {
  // ... `upload?: UploadConfig` removed
}
```

`UploadConfig` itself doesn't change — the same `mimeTypes`,
`maxFileSize`, `sizes`, `storage` shape, just hosted on the field.
Constraints, variants, and storage routing all become properties of
the file rather than properties of the collection.

### Two patterns, one mechanism

The existing dedicated-media-collection pattern stays intact, and a
second pattern unlocks alongside it:

**A. Shared media library** — `Media` keeps an `image` field that
declares its own `upload` block. Other collections relate to it via
`relation { targetCollection: 'media' }` exactly as `News.featureImage`
does today. Variants ride along on the populated relation envelope
because populate already returns the full target document's `fields` —
no new projection ceremony.

**B. Inline upload on a non-media collection** — a `Page` schema drops
`{ type: 'image', name: 'heroImage', upload: { sizes: [...] } }`
straight into its own fields. No `Media` row, no relation hop, no
second admin screen.

**C. Both, in the same schema** — `Page` has `heroImage` inline
*and* `gallery: [{ type: 'relation', targetCollection: 'media' }]` for
the editorial library. Today's collection-level model can't express
this case at all; the field-level model handles it without ceremony.

When to pick which falls out of the data, not the schema:

- *Reuse / library semantics* (one hero image used across 20 posts,
  shared brand assets, editor-browseable gallery) → dedicated `Media`
  collection + relation.
- *Document-intrinsic files* (a user's avatar, a page's OG image
  used nowhere else, a contract's PDF attachment) → inline image/file
  field.
- *Mixed* — both, side by side.

The "is this a media library?" question stops being a schema concern
and becomes a UI concern: the admin shows a gallery picker and a drop
zone on the dashboard for collections it knows about by convention
(navigation labelling, list-view affordances) rather than by a flag in
the schema. That's a better separation — the schema describes what
fields exist and what they accept; the admin config decides how to
present them.

### Variant persistence

To make variants survive a round-trip, `byline_store_file` grows one
column:

```ts
variants: jsonb('variants'), // [{ name, storagePath, storageUrl, width, height, format }]
```

A jsonb column rather than a sidecar `byline_store_file_variants` table
because:

- Variants are always read together with the file row, never queried
  independently. There is no useful "find me all rows that have a
  thumbnail" query on the horizon.
- The cardinality is small (5–10 entries per file in the worst case).
- jsonb keeps the EAV `UNION ALL` reconstruction path simple — one row
  per file, no second join.

Reconstruction (`restoreFieldSetData`) populates the file envelope
with the persisted `variants` array whenever it's present:

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
      { "name": "thumbnail", "storagePath": "media/abc-thumbnail.webp", "storageUrl": "/uploads/media/abc-thumbnail.webp", "width": 400, "height": 400, "format": "webp" },
      { "name": "card",      "storagePath": "media/abc-card.webp",      "storageUrl": "/uploads/media/abc-card.webp",      "width": 600,           "format": "webp" },
      // ...
    ]
  }
}
```

`UploadVariantResult` (today: `{ name, storagePath }`) widens to carry
the dimensions/format the processor already knows from the Sharp
pipeline; persisting them with the row removes the need for the read
side to recompute or look them up.

### Endpoint addressing

The auto-mounted upload route stays at
`POST /admin/api/<collection-path>/upload` but accepts a `field`
parameter (FormData entry) naming the target image/file field on the
collection. Resolution:

- If `field` is supplied, look it up in `definition.fields` (recursing
  into groups/arrays/blocks if present) and read its `upload` config.
- If `field` is absent and the collection has exactly one image/file
  field with an `upload` block, default to that field. This keeps the
  Media-style "one focal file" call sites terse.
- Otherwise, return a 400 explaining which fields are upload-capable.

The endpoint always operates on a single field at a time. Multi-file
forms upload sequentially; the orchestration is the client's
problem, not the transport's.

### Storage routing

`UploadConfig.storage` migrates with the rest of the block — per-field
storage providers fall through to `ServerConfig.storage` exactly as
they do today. The only difference is that two image fields on the
same collection can now route to different backends (avatars on local
disk, editorial images on S3) without inventing a new abstraction.

### Server-side upload hooks (`beforeStore` / `afterStore`)

Today's `CollectionHooks.beforeUpload` / `afterUpload` are server-side
hooks fired by `document-upload.ts`. They predate the move to per-field
upload config and have three problems beyond the lifting question:

1. **No field awareness.** A collection with multiple image/file fields
   couldn't run a different naming strategy per field, because the
   hook's context only carries the collection path.
2. **Impoverished context.** `BeforeUploadContext` exposes
   `{ filename, mimeType, fileSize, collectionPath }` — no access to
   the other form values posted alongside the file, no `RequestContext`,
   no field reference. Yet the most common rename use case ("name this
   asset by its publication ID") needs exactly those form values.
3. **Filename override is silently broken.** `resolveUploadFilename`
   computes an `effectiveFilename` from the hook's return value, but
   `storage.upload(buffer, { filename, … })` uses the *original*
   sanitised filename. The override only ends up in
   `StoredFileValue.filename` metadata — actual storage paths and
   variant filenames don't pick it up. Cleanup item, fixed alongside
   the lift.

#### Naming: `beforeStore` / `afterStore`

The current names imply the file hasn't reached the server yet, when
in fact by the time the hook fires the bytes have already crossed the
network and are sitting on the server (an in-memory `Buffer` in our
current setup, or a /tmp file with a future streaming adapter — the
hook contract is agnostic). The hook brackets the *storage provider's
write step*, not the client→server transmission.

Names locked in:

- `beforeStore` — fires after validation, before `storage.upload()`.
  Can rename, can reject.
- `afterStore` — fires after the original file and all image variants
  have been written to the storage provider, before the document
  version is created.

This breaks with `beforeUpload` / `afterUpload` convention deliberately:
it's unambiguous, it leaves /tmp / streaming / buffering mechanics to
the framework, and it composes cleanly with the storage provider naming
(`storage-local`, `storage-s3`).

#### Where they live

On `UploadConfig.hooks`, alongside the rest of the upload-related config:

```ts
interface UploadConfig {
  mimeTypes?: string[]
  maxFileSize?: number
  sizes?: ImageSize[]
  storage?: IStorageProvider
  hooks?: UploadHooks
}

interface UploadHooks {
  beforeStore?: BeforeStoreHookFn | BeforeStoreHookFn[]
  afterStore?: AfterStoreHookFn | AfterStoreHookFn[]
}
```

Field-level only. The collection-level `beforeUpload` / `afterUpload`
on `CollectionHooks` is removed: field-level is strictly more
expressive (it knows which field), and "fire on any upload to this
collection" is recoverable by hanging the same function reference off
every field's `upload.hooks`.

Putting hooks under `field.upload.hooks` rather than extending the
existing `field.hooks` (which is the *client-side* form-editing hook
slot — `beforeValidate` / `beforeChange`) preserves the client/server
split. When other field types eventually want server-side hooks, they
go somewhere else — probably a dedicated `serverHooks` slot — without
colliding with this contract.

#### Hook contracts

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

`AfterStoreContext` drops the legacy `variantPaths: string[]` —
`storedFile.variants` (per the persistence section above) carries the
same information in a richer envelope.

#### Composition: array of functions

Both hooks accept either a single function or an ordered array.
Multiple functions stack with **fold** semantics on `beforeStore`:

```ts
upload: {
  hooks: {
    beforeStore: [
      // 1. tenant-prefix everything
      ({ filename, requestContext }) => `${requestContext.actor?.id ?? 'anon'}-${filename}`,
      // 2. then prefix with the publication ID if present
      ({ filename, fields }) =>
        fields.publicationId ? `${fields.publicationId}-${filename}` : undefined,
      // 3. then enforce uniqueness within the collection
      async ({ filename, collectionPath, fields }) => {
        if (await isAssetTaken(collectionPath, filename)) {
          return { error: `An asset with name '${filename}' already exists.` }
        }
      },
    ],
  },
}
```

Each function in the chain sees the previous function's result —
returning a string (or `{ filename }`) substitutes the new filename for
the next function's `ctx.filename`. Returning `void` keeps the current
filename. Returning `{ error }` short-circuits the chain and surfaces
as `ERR_VALIDATION` with the supplied message; no file is written, no
later hook runs, no document is created.

`afterStore` runs every function in declaration order; failures are
logged but do not roll back the storage write (consistent with how
`afterCreate` etc. are documented today — hooks run *outside* the
storage transaction).

#### Variant rename comes free

`generateImageVariants` derives variant filenames from
`path.basename(storedFile.storagePath)` as
`<basename>-<variantName>.<ext>`. Once `beforeStore`'s filename
override is correctly threaded into `storage.upload(...)` (the bug fix
above), variants automatically inherit the new prefix. There is no
second hook needed — "rename file *and* its variants by publication
ID" reduces to "let `beforeStore` see the form fields and rewrite the
filename."

#### Validation order fix

Today `beforeUpload` fires before mime/size validation, so a hook can
do work for a file that's about to be rejected. The new ordering:

1. mime type check (rejects via `ERR_VALIDATION`)
2. file size check (rejects via `ERR_VALIDATION`)
3. `beforeStore` chain (may rename, may reject)
4. `storage.upload(buffer, { filename: effectiveFilename, … })`
5. metadata extraction (Sharp)
6. variant generation (Sharp + storage writes)
7. `afterStore` chain
8. document version creation

Validation is now a hard gate before any user-defined code runs.

### What goes away

- `CollectionDefinition.upload` (the property, the type, the
  fingerprint canonicalisation in `collection-fingerprint.ts`).
- The `if (definition.upload)` discriminator in `document-upload.ts`,
  `host-tanstack-start/server-fns/collections/upload.ts`, the admin
  navigation, and any dashboard widgets that key off it. The
  replacement check is "the collection has at least one image/file
  field with an `upload` block" — wrappable in a `hasUploadField()`
  helper if it's used in more than two places.
- `CollectionHooks.beforeUpload` / `afterUpload` and the matching
  `BeforeUploadContext` / `AfterUploadContext`. Replaced by
  `field.upload.hooks.beforeStore` / `afterStore` with richer context
  (form fields, request context, field reference).
- `BeforeUploadHookSlot` / `BeforeUploadHookFn` types. Replaced by
  `BeforeStoreHookFn` / `AfterStoreHookFn`.
- The implicit "first image/file field is the focal upload" comment
  in `apps/webapp/byline/collections/media/schema.ts`. The `image`
  field carries its own config now.

### What stays

- `ServerConfig.storage` as the site-wide default.
- The Sharp-based `imageProcessor` adapter contract; it just receives
  the per-field `upload` config instead of the collection-level one.
- `StoredFileValue` shape for the field-level envelope, plus the new
  `variants` array.
- The `Media` collection itself — same fields, same relation targets,
  same admin treatment. The `upload` block just moves down 30 lines
  onto the `image` field.

## Open questions

1. **Variant URL freshness.** `storageUrl` is captured at upload time.
   If the storage provider's `getUrl()` ever depends on per-request
   state (signed S3 URLs with short TTLs, CDN rewrites), persisted URLs
   go stale. Two options when that lands: (a) store only `storagePath`
   and resolve `storageUrl` on read via `storage.getUrl()`, or (b) keep
   both and let the read path re-resolve when the provider opts in.
   Defer until the first signed-URL provider arrives — `storage-local`
   and a vanilla S3 with public-read both have stable URLs.
2. **Image-field constraints beyond upload.** `aspectRatio`,
   `minWidth` / `maxWidth`, `requiredAlt` — all field-level concerns
   that the current model can't express. Out of scope for this slice
   but worth noting that field-level `upload` is the natural home for
   them when they land.
3. **Inline-image uploads in richtext.** The richtext inline-image
   plugin currently relies on a relation to `media`. Field-level
   `upload` doesn't change that, but it does open the door to an
   image-block whose own `upload` config defines the variants for
   inline uses. Out of scope here.
4. **Server-side hooks for non-upload field types.** `beforeStore` /
   `afterStore` is upload-specific by design. When the need arises
   for server-side `beforeChange` / `afterChange` on every field type
   (e.g. to derive a slug field server-side), it should live under a
   new `field.serverHooks` slot rather than colliding with this
   contract or with the existing client-side `field.hooks`.

## Why now

The triggering observation was the missing `variants` array in the
`@byline/client` API response — a public news client building a
responsive `<picture>` element has no way to discover that a
`thumbnail` / `card` / `mobile` / `tablet` / `desktop` variant
exists, even though the upload pipeline produced all five. Fixing
that requires persisting variants on `store_file`. Once we're already
in the file/upload path, moving config to where it belongs costs
roughly the same as bolting variants onto a model that's about to be
wrong anyway.

The greenfield window is also the cheapest moment to do this: no
existing data to migrate, no published schemas, no host code outside
this repo to update.

## Implementation plan

See [FILE-MEDIA-UPLOAD-IMPLEMENTATION-PLAN.md](./FILE-MEDIA-UPLOAD-IMPLEMENTATION-PLAN.md).
