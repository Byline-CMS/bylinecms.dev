---
"@byline/host-tanstack-start": minor
"@byline/richtext-lexical": minor
"@byline/storage-local": minor
"@byline/storage-s3": minor
"@byline/client": minor
"@byline/core": minor
"@byline/cli": minor
"@byline/ui": minor
"@byline/admin": minor
"@byline/auth": minor
"@byline/db-postgres": minor
---

- @byline/storage-s3 — released as the production-ready S3 storage adapter. Image variants now generate end-to-end through storage.upload() (no
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
