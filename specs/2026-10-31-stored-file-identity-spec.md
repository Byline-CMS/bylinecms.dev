---
title: "Stored-file content identity — specification"
path: "stored-file-identity-spec"
summary: "Define a SHA-256 content hash and a separate storage validator for stored files, an optional storage read primitive that binds returned bytes to their validator, and an idempotent backfill for existing objects."
---

# Stored-file content identity — specification

Companions:

- [Implementation plan](./2026-10-31-stored-file-identity-plan.md) — stages, checkpoints and checks.
- [Track roadmap](./2026-10-31-extraction-retrieval-track-roadmap.md) — Phase 1 of the extraction, retrieval and agent-access track.
- [File and media uploads](../docs/04-collections/06-file-media-uploads.md) — the present-state upload reference this work extends.
- Issue #85 — the tracking issue. Issue #72 (media retention) is related only where it touches hashing.

## 1. Purpose

A stored file in Byline is the original object an upload field writes to a
storage provider, together with the `StoredFileValue` record that a document
version keeps about it. Read this specification when you need to know whether
the bytes behind a stored file have changed, for example to invalidate an
extraction cache, check fixity, or detect a same-path replacement.

Today `StoredFileValue.fileHash` exists and both adapters reserve an indexed
`file_hash` column, but the upload path always writes `fileHash: undefined`.
A downstream research library therefore hashes files host-side through a
bridge. This specification makes the hash a core guarantee so that bridge can
be removed, and adds the storage primitives needed to fill and check it.

## 2. Vocabulary

**Content hash** (`fileHash`). The SHA-256 digest of the exact bytes of the
original object, as 64 lower-case hexadecimal characters. It identifies
content. Two objects with the same content hash have the same bytes.

**Storage validator** (`storageValidator`). An opaque token the storage
provider issues for one stored version of an object, written as
`{ kind: string; value: string }`. Examples are an S3 version id, an S3 ETag,
or a local file's device, inode, modification time and size. It identifies a
*stored version*, not content. Its only use is equality: "is the object at this
path still the version I recorded?"

**Bound read.** A read whose result carries the validator of the exact bytes it
returns, taken from the same request (S3) or the same open file handle (local
filesystem). A separate metadata request cannot provide this guarantee,
because the object may be replaced between the two requests.

The content hash and the storage validator are never compared with each other.
An ETag is not a content digest: a multipart S3 upload has an ETag that is not
the MD5 of the object, and server-side encryption changes ETag semantics.
Byline never derives a content hash from an ETag, a path or a filename.

## 3. Current state (verified against `9eeac5ec`)

- `packages/core/src/services/field-upload.ts` receives the whole upload as a
  `Buffer` (the host adapter reads the multipart file with
  `Buffer.from(await file.arrayBuffer())`), calls `storage.upload(buffer, …)`
  once, and builds `StoredFileValue` with `fileHash: undefined`.
- The original object is stored verbatim. Image variants are separate objects
  generated from the same buffer; no provider transforms the original.
- `IStorageProvider` (`packages/core/src/@types/storage-types.ts`) has
  `upload`, `delete`, `getUrl`, and the optional `move` and `exists`. There is
  no read primitive.
- `storage-local` writes in place with `fs.promises.writeFile`, so a reader can
  observe a partially written file during a same-path replacement.
- `storage-s3` uploads with `@aws-sdk/lib-storage` `Upload` and discards the
  `ETag` and `VersionId` that `upload.done()` returns.
- `byline_store_file.file_hash varchar(64)` with `idx_file_hash` exists in
  both adapters. Flatten writes `v.fileHash`; restore returns `data.file_hash`,
  so a read currently yields `fileHash: null`.
- The Zod schema accepts `fileHash: z.string().nullable().optional()`, so an
  empty string would be accepted and persisted.
- `apps/webapp/byline/scripts/regenerate-media.ts` reads originals through the
  local filesystem directly, because no provider read primitive exists.

## 4. Contract

### 4.1 `fileHash`

- `fileHash` is the SHA-256 digest, lower-case hexadecimal, of the bytes that
  Byline passed to `IStorageProvider.upload()` for the original object.
- `IStorageProvider.upload()` must store those bytes verbatim. A provider that
  compresses, transcodes or otherwise transforms the original violates the
  contract. This makes "the bytes received" and "the bytes stored" the same
  bytes, so the JSDoc can promise both. Image variants are separate objects
  and are not covered by `fileHash`.
- Core computes the hash, not the provider, so every provider gets it without
  extra work. Core hashes in the same pass that hands bytes to the provider:
  - For a `Buffer` (the ordinary upload path), core hashes the in-memory
    buffer. This reads no bytes from storage.
  - For a stream, core pipes the input through a hashing pass-through, so the
    hash is computed as the provider consumes the stream.
  - The same size rule applies to both inputs. A buffer whose length differs
    from `UploadFileOptions.size` fails before the provider is called. A
    stream that ends short, runs long, or is not fully consumed when the
    provider resolves fails the upload, and core destroys the input stream.
    Either way, no `StoredFileValue` is recorded.
  - A stream failure can be detected only after the provider has written the
    object. Core then deletes the object when the provider generated its path
    (a fresh, collision-checked key). When the caller supplied
    `targetStoragePath`, the write may have replaced an existing object, and
    Byline cannot undo that; the error says so.
- `fileHash` is recorded once, at upload or backfill time, and describes the
  bytes observed then. The storage validator recorded beside it is how a
  consumer detects that the object has since changed.

### 4.2 `storageValidator`

- `StoredFileLocation` (the result of `upload` and `move`) gains an optional
  `storageValidator`. `StoredFileValue` gains the same optional field and
  persists it.
- Validators compare by exact equality of both `kind` and `value`. A
  validator of a different `kind` is "unknown", never "changed".
- Built-in kinds:

  | Provider | Kind | Value |
  |---|---|---|
  | `storage-s3` | `s3-version` | A usable `VersionId` (see the selection rule) |
  | `storage-s3` | `s3-etag` | A strong `ETag` with surrounding quotes removed |
  | `storage-local` | `local-stat` | `<dev>:<ino>:<mtimeNs>:<size>` from a `bigint` stat |

- **S3 selection rule.** Every S3 response that yields a validator (upload,
  copy, `GetObject`, `HeadObject`) applies one rule. Use `s3-version` when the
  response carries a `VersionId` that is present and not the literal string
  `"null"`. Otherwise use `s3-etag` when a strong `ETag` is present. Otherwise
  the response has no usable validator. A weak ETag (`W/"…"`) is never used:
  weak tags may stay equal across different bytes (RFC 9110 §8.8.1), so they
  cannot bind an exact-byte read, and an `s3-etag` expectation against a
  weak-only response is `unestablishable`. A bucket that has never been versioned,
  or whose versioning is suspended, returns `"null"` or no version id; in a
  suspended bucket, successive writes to the same key keep the `"null"`
  version id while the bytes change, so it never identifies a version.

- `kind` is at most 32 characters; `value` at most 1024 characters. A custom
  provider may define its own kinds within those limits.

### 4.3 Absence

- An unknown hash or validator is absent: the key is omitted (`undefined`) in
  `StoredFileValue` and `NULL` in storage. Byline never writes an empty string
  for either.
- The write-side Zod schema validates `fileHash` as `/^[0-9a-f]{64}$/` and
  `storageValidator` as a non-empty `kind` and `value` within the limits above.
  An empty string or a malformed digest is a validation error.
- Restore maps `NULL` to an omitted key, replacing today's `fileHash: null`.
- A consumer that requires identity (an extraction cache, a fixity check) must
  treat an absent `fileHash` as an error for that file, never as a match.

### 4.4 Read primitives

Two optional methods are added to `IStorageProvider`. Callers feature-detect
them, as they do `move` and `exists`.

```ts
interface StorageValidator {
  kind: string
  value: string
}

interface StoredObjectRead {
  /** The object's bytes, streamed. */
  body: NodeJS.ReadableStream
  /** Validator of exactly these bytes, from the same request or file handle. */
  validator: StorageValidator
  size?: number
}

interface IStorageProvider {
  // …existing members…

  /**
   * Bound read: stream the object and return the validator of exactly the
   * bytes streamed. The returned validator is the provider's canonical one
   * and may be of a different kind from `expect`.
   *
   * Without `expect`: resolves `null` when no object exists at the path, and
   * fails with `ERR_STORAGE` (`validator-unavailable`) when the object has no
   * usable validator.
   * With `expect`: exposes the body only when a token of `expect.kind` equal
   * to `expect.value` is established; otherwise fails with
   * `ERR_STORAGE_PRECONDITION` (`changed`, `unsupported-kind`,
   * `unestablishable` or `missing`) and exposes nothing.
   */
  download?(
    storagePath: string,
    options?: { expect?: StorageValidator; signal?: AbortSignal }
  ): Promise<StoredObjectRead | null>

  /**
   * Cheap change probe. Resolves `null` when no object exists. Not a
   * provenance source: the object can change after `head` returns.
   */
  head?(storagePath: string): Promise<{ validator: StorageValidator; size?: number } | null>
}
```

The brief proposed `download?(storagePath): Promise<ReadableStream | Buffer>`.
This specification returns an object instead, because a bare stream cannot
tell the caller which version it read. That gap is the head-then-download race
the brief's author asked to close.

Provider behaviour:

- **`storage-local`.** `download` opens the file, takes `fstat` on the open
  handle, and streams from that handle. Byline's own writers never modify an
  existing file in place: uploads and moves create a new file and rename it
  over the path (sections 4.5 and 4.6). The open handle keeps the old inode, so
  the bytes and the validator describe the same file. This guarantee covers
  Byline's writers only. An open descriptor is not an immutable snapshot: an
  external process that writes into the file in place can change the bytes
  under a reader, and that case is outside the guarantee.
- **`storage-s3`.** `download` uses one `GetObject` and takes the validator
  from that response by the selection rule in section 4.2. `head` uses
  `HeadObject` with the same rule.
- **No usable validator.** Without `expect`, if a response yields no usable
  validator, `download` fails with `ERR_STORAGE` (reason
  `validator-unavailable`) and disposes of the body. With `expect`, the same
  situation is `ERR_STORAGE_PRECONDITION` with reason `unestablishable`, because
  the expectation is what could not be checked. A bound read never returns bytes without a validator. `head` returns
  `null` only for a missing object; for a present object without a usable
  validator it fails the same way.

**`expect` semantics.** `expect` is fail-closed: the body is exposed only when
the provider has established that the current object carries a token of
`expect.kind` whose value equals `expect.value`.

- The returned `validator` is always the canonical one by the selection rule,
  and may be of a different kind from `expect`. For example, an `s3-etag`
  expectation can match a bucket that has since enabled versioning; the read
  then returns an `s3-version` validator, which the caller may record.
- `storage-s3` with `s3-etag`: sends `IfMatch` and also checks the response's
  `ETag`. With `s3-version`: compares the response's `VersionId`, which must be
  usable by the selection rule.
- `storage-local` supports `local-stat` only and compares after `fstat`.
- Any other outcome rejects with `ERR_STORAGE_PRECONDITION` before the body is
  exposed, and the error's `reason` distinguishes the cases:

  | `reason` | Meaning |
  |---|---|
  | `changed` | The provider established that the current object's token of that kind differs (S3 `412`, or a different usable value). |
  | `unsupported-kind` | The provider does not issue validators of `expect.kind`. Checked before any request. |
  | `unestablishable` | The kind is supported, but the response lacks a usable token of that kind — for example an `s3-version` expectation against a bucket whose versioning is now suspended. |
  | `missing` | No object exists at the path. (Without `expect`, a missing object resolves `null`.) |

- On every rejection after a response or file handle exists, the provider
  destroys the response body or closes the handle before throwing, and honours
  `signal` aborts the same way.

`ERR_STORAGE_PRECONDITION` is a new error code, so callers can tell a proven
change, or an unverifiable expectation, from a transport failure.

### 4.5 Atomic replacement in `storage-local`

`storage-local` `upload` writes to a temporary file in the destination
directory, takes `fstat` on that file's handle for the validator, and renames
it over the destination. This removes the partial-read window and gives every
stored version a new inode, so `local-stat` validators change even when a
replacement lands within the filesystem's timestamp granularity. `move`
follows the same rule (section 4.6).

### 4.6 `move`

`move` returns the validator of the object at its new path. Content is
unchanged, so `fileHash` carries over. No core code calls `move` today; this
rule is for hooks and scripts that do.

- **`storage-local`, claim first.** The provider first renames the source to
  a private name in the source directory. That rename is atomic, so the move
  takes exactly the file at the source path at that moment, even if a Byline
  upload replaces the source path a moment later. The validator is read from
  the private name, and every later step works on it, so the returned
  validator always describes the file that reaches the destination, and a
  source written after the claim is never removed. If any step after the
  claim fails before the destination is committed — including reading the
  claimed file's metadata and removing a temporary copy — the provider puts
  the claimed file back with `link`, which refuses to overwrite a source
  written meanwhile. When everything is put back cleanly it rethrows the
  original error. Otherwise it throws `ERR_STORAGE` that keeps the original
  error as its cause and names every path still holding content: reason
  `source-not-restored` (with `claimedPath`) when the source could not be put
  back, or `move-failed` (with `sourceRestored: true` and the retained
  `claimedPath` or `temporaryPath`) when it was put back but a private copy
  remains. Both carry `destinationCommitted: false`.
- **`storage-local`, same filesystem.** The claimed file is renamed onto the
  destination; the inode and the `local-stat` validator are preserved.
- **`storage-local`, across filesystems (`EXDEV`).** Copying directly onto the
  destination path could change an inode that a download already has open.
  Instead, the provider copies the claimed file into a temporary file in the
  destination directory, takes its validator, renames it over the
  destination, then removes the claimed file. The result has a new inode and
  therefore a new validator. If removing the claimed file fails, the move has
  already succeeded at the destination; the provider throws `ERR_STORAGE`
  (reason `source-not-removed`) with `details.destinationCommitted: true`, the
  claimed path and the new location, so the caller can record the move and
  retry the cleanup. If the copy or rename fails, the temporary file is
  removed, the destination is untouched, and the claimed file is put back.
- **`storage-s3`.** A copy produces a new validator by the selection rule; the
  source is deleted afterwards, as today.

### 4.7 Persistence

- New nullable columns on `byline_store_file` in both adapters:
  `storage_validator_kind varchar(32)` and `storage_validator_value
  varchar(1024)`. They are written and read as a pair; restore emits
  `storageValidator` only when both are non-null. No index is added.
- The store column manifest (`packages/core/src/storage/store-manifest.ts`),
  flatten, restore, both adapters' insert and query mappings, and the Postgres
  hand-written version-copy statements in `storage-commands.ts` all carry the
  new columns. MySQL copies through a column-generic helper and needs no
  statement change, which the db-conformance suite confirms.
- Migrations follow the repository workflow: Drizzle development migrations
  in both adapters, a new numbered upgrade script in `packages/db-postgres/sql/`
  and `packages/db-mysql/sql/`, and the CLI baseline squash at release by a
  human.

### 4.8 Backfill and the legacy-null policy

Existing rows have `file_hash IS NULL`. Backfill fills them where the bytes are
reachable and leaves them absent where they are not.

- **Service.** `backfillStoredFileIdentity({ db, storage, mode, collectionPath,
  batchSize, limit, dryRun, signal, logger })` in `@byline/core`, server-only.
  `mode` is `'fill'` (default) or `'verify'`. It returns a summary: paths
  scanned, hashed, missing and failed, rows updated (fill), and, in verify
  mode, matched and mismatched **hash groups** (one group is one recorded hash on one path,
  with its row count). `batchSize` and `limit` count distinct paths in both
  modes, and each path is read at most once per run.
- **Collection scope.** `collectionPath` is optional. The service resolves it
  to the collection id once and fails with `ERR_VALIDATION` for an unknown
  path. When set, both selection and updates are restricted to that
  collection's `byline_store_file` rows. Rows of the same object in other
  collections are left for their own run, so a filtered run never writes
  outside the named collection. Verify mode honours the same scope.
- **Selection (fill).** Distinct `storage_path` values with `file_hash IS
  NULL` and `storage_provider = storage.providerName` (and the collection, when
  set), in keyset order by path. Rows written by another provider are not
  selected; an installation that has used several providers runs the backfill
  once with each provider configured.
- **One read per object.** Many version rows share one object. Backfill reads
  each path once with a bound `download`, hashes the stream, and updates every
  row for that provider and path whose `file_hash` is still null, setting the
  hash and the bound validator together. It never overwrites a non-null hash,
  so re-running is idempotent and an interrupted run resumes cleanly.
- **Paging by whole paths.** Every page is a bounded set of distinct paths
  after `afterPath`. In verify mode the page then carries *all* recorded-hash
  groups for each of those paths, so a path's groups are never split across
  pages. The service advances `afterPath` only past the last complete path.
- **Verify mode.** Selects paths that have at least one non-null hash under the
  same provider and collection scope, with every distinct recorded hash for
  each path. It reads each
  path once with a bound `download`, re-hashes it, and reports each recorded
  hash as matched or mismatched, with its row count. It writes nothing. A path
  can carry more than one recorded hash when an older version recorded bytes
  that were later replaced; verify reports each one. A mismatch means the
  object changed after the hash was recorded, or the saved value did not come
  from this object (section 4.10).
- **New adapter methods.** `db.queries.storedFiles.listStoredFilePaths({
  storageProvider, collectionId?, identity: 'missing' | 'present', afterPath?,
  limit })`, where `limit` counts distinct paths. For `'missing'` it returns
  paths; for `'present'` it returns, for each of up to `limit` paths, the path
  with all of its `{ fileHash, rowCount }` groups. And
  `db.commands.storedFiles.setIdentityForPath({ storageProvider, storagePath,
  collectionId?, fileHash, storageValidator })`, which updates only rows whose
  `file_hash` is null and returns the count. Both are direct storage primitives
  (the documented escape hatch for maintenance), covered by a new
  db-conformance suite.
- **Legacy-null policy.**
  - Object missing: leave the rows absent and report the path as missing.
  - Provider has no `download`: the service refuses to start and says why.
    Every legacy row stays absent; new uploads still get a hash, because core
    computes it.
  - Read or hash failure: leave the rows absent, report the path as failed, and
    continue.
- **Historical versions.** If an object was replaced at the same path after an
  older version recorded it, backfill hashes the bytes present now. The
  recorded validator states which version was hashed. Bytes that were
  overwritten in an unversioned store cannot be recovered, and the
  specification does not claim otherwise.
- **Runner.** An example script, `apps/webapp/byline/scripts/backfill-file-identity.ts`,
  follows the existing `backfill-*.ts` pattern with `--verify`,
  `--collection <path>`, `--dry-run`, `--limit` and `--batch-size`. A `byline`
  CLI command is deferred (decision 4).

### 4.9 Providers without `head` or `download`

| Missing | Effect |
|---|---|
| `head` | A consumer cannot probe cheaply for change. It uses `download` with `expect` (which streams only on a match) or re-hashes. Uploads, backfill and bound reads are unaffected. |
| `download` | Backfill refuses to run; legacy rows stay absent. Consumers cannot verify fixity. New uploads still record `fileHash`. |
| validator from `upload` | `storageValidator` is absent on new uploads; `fileHash` is still recorded. Change detection then requires a re-hash. |

### 4.10 Trust boundary

Byline's admin user interface uploads a file, receives the `StoredFileValue`,
and sends it back inside the document data on save. The server persists what
the client sends, as it already does for `storagePath`. A content hash or
validator in a saved document is therefore as trustworthy as the editor's write
permission on that collection. This specification does not change that model.
Consumers that need assurance re-hash through a bound `download`. Server-issued
upload receipts are a possible later change and are listed as an open question.

## 5. Conformance

A new private package, `@byline/storage-conformance`, mirrors
`@byline/search-conformance`. It exports a suite that any `IStorageProvider`
runs against a fresh store. Covered behaviour:

1. Upload returns a validator when the provider declares one.
2. Same-path replacement with changed bytes produces a new validator, and core
   records a new content hash.
3. Same-path replacement with unchanged bytes produces the same content hash.
   The validator may or may not change; the suite asserts hash equality only.
4. `download` returns the exact bytes, with a validator equal to `head`'s for
   an unchanged object.
5. `download` with a stale `expect` fails with `ERR_STORAGE_PRECONDITION` and
   streams nothing.
6. `download` and `head` on a missing path resolve `null`.
7. A provider wrapped to remove `head`, and one wrapped to remove `download`,
   behave as section 4.9 states.
8. `expect` with an unsupported kind rejects with `unsupported-kind` before
   any read; a missing object with `expect` rejects with `missing`.
9. A reader that opened the object before a same-path replacement — by
   upload, by move, and for `storage-local` by the cross-filesystem move
   fallback — receives the old bytes with the old validator, never mixed
   bytes or a mismatched validator.

Where each runs:

- `storage-local` runs the suite in a temporary directory on every `pnpm test`.
- `storage-s3` runs it against an S3-compatible endpoint when
  `BYLINE_S3_TEST_ENDPOINT` and its credentials are set, and skips with a
  logged reason otherwise. Against a versioned test bucket it also runs a
  suspended-versioning case: after suspension, two writes of different bytes to
  one key must yield different validators and an `s3-version` expectation must
  reject with `unestablishable`. Unit tests with a mocked client cover the
  selection rule (quotes removed, `"null"` and absent version ids falling back
  to the ETag, no usable token), `IfMatch` `412` mapping to `changed`, kind
  transitions in both directions, and body disposal on every rejection.
- `storage-local` unit tests force the `EXDEV` path and cover the
  destination-committed, source-unlink failure.
- Core unit tests cover hashing for buffer and stream input, including the
  short-stream failure, and the Zod rules in section 4.3.
- A db-conformance suite covers the new columns, version copy, restore, and the
  two backfill primitives on both adapters.

## 6. Non-goals

- Hashing image variants. Variants are derived and regenerable.
- Using S3 additional checksums (`ChecksumAlgorithm: 'SHA256'`) as `fileHash`.
  A multipart upload yields a composite checksum, not a whole-object SHA-256.
- Deduplicating uploads by hash. The existing index allows it later.
- Media retention and regeneration (#72), beyond noting that regeneration
  scripts should read through `download`.
- Making the upload path stream end-to-end. The host adapter buffers today; the
  stream branch in section 4.1 is for callers that already stream.

## 7. Decisions

Tony accepted every recommendation below on 2026-10-31 and added decision 7.
The plan's decisions table records the same answers.

1. **Strict validation of existing values.** The stricter `fileHash` rule would
   reject a malformed value on the next save. Byline never wrote one, but a
   downstream bridge may have. *Recommendation:* adopt the strict rule and ship
   a check query in the adoption note.
2. **Verify mode.** Add `mode: 'verify'` to the backfill service, which
   re-hashes rows that already have a hash and reports mismatches without
   writing. *Recommendation:* include it; it reuses the same read loop and
   makes the trust boundary in section 4.10 checkable.
3. **S3 conformance in CI.** Run a MinIO service container in CI so the S3
   suite runs on every pull request, or keep it opt-in. *Recommendation:* add
   MinIO to CI in this phase.
4. **CLI command.** Ship the backfill as a `byline` CLI subcommand now, or as
   the example script only. *Recommendation:* the script only; a CLI command
   can follow once a second maintenance task wants the same shape.
5. **Upload receipts.** Open a separate issue for server-issued upload receipts
   that bind a saved `StoredFileValue` to an upload the server performed.
   *Recommendation:* open the issue; do not build it in this phase.
6. **Adjacent bug (section 8).** Fix the Postgres `variants` omission in the
   same statements this phase edits, or as a separate fix. *Recommendation:* a
   separate `fix(db-postgres)` commit inside this phase, with its own test,
   because the lines change anyway.
7. **Collection scope (added by Tony).** Backfill fill and verify accept an
   optional collection, so an installation can process one collection at a
   time. Specified in section 4.8.

## 8. Adjacent finding

The Postgres adapter's hand-written version-copy statements in
`packages/db-postgres/src/modules/storage/storage-commands.ts` list the file
columns explicitly and omit `variants`. Upload fields are not localizable, so
file rows are stored at locale `all`; the copy-forward on a locale-scoped save
copies only other locales and never reaches them. The full copy in
`copyAllVersionStoreRows` does copy `all` rows, so **deleting a content locale
(`deleteDocumentLocale`) or re-anchoring a document (`reAnchorDocument`) on
PostgreSQL mints a version whose image fields have lost their variants.**
MySQL copies through column-generic helpers (`copyForwardStoreRows`,
`copyVersionStoreRows`) and is unaffected. Decision 6 fixes it in this phase;
the stored-file-identity db-conformance suite covers the locale-deletion copy
on both adapters.

## 9. Issue #85 acceptance criteria (proposed)

- [ ] `fileHash` is SHA-256, lower-case hex, of the original bytes as passed to
      and stored verbatim by the provider; the JSDoc says so.
- [ ] Every ordinary upload records `fileHash` with no extra storage read.
- [ ] `storageValidator` is recorded where the provider supplies one, persisted
      in both adapters, and documented as never compared with the hash.
- [ ] Unknown values are absent; empty strings and malformed digests are
      rejected at validation.
- [ ] `IStorageProvider.download?` returns bytes bound to their validator, with
      a fail-closed `expect` precondition whose errors distinguish a proven
      change from an unverifiable expectation; `head?` exists; both are
      implemented in `storage-local` and `storage-s3`.
- [ ] S3 never treats a `"null"` or absent version id as a validator.
- [ ] `storage-local` replaces files atomically on upload and on move,
      including the cross-filesystem fallback.
- [ ] An idempotent backfill fills reachable objects and leaves unreachable ones
      absent under the stated legacy-null policy; a report-only verify mode
      re-hashes recorded values; both accept an optional collection scope.
- [ ] Storage conformance covers changed bytes, unchanged bytes, bound reads,
      stale preconditions, missing objects, and providers lacking `head` or
      `download`.

## 10. Downstream adoption (as shipped)

1. Upgrade the `@byline/*` packages and apply the new upgrade script for your
   adapter (`packages/db-postgres/sql/0015_add-stored-file-validator.sql` or
   `packages/db-mysql/sql/0010_add-stored-file-validator.sql`). Both are
   additive and safe to re-run.
2. Check existing hashes before saving any document:
   `SELECT count(*) FROM byline_store_file WHERE file_hash IS NOT NULL AND file_hash !~ '^[0-9a-f]{64}$'`
   (PostgreSQL) must return 0; fix or null any rows it finds.
3. Run `backfill-file-identity` (or call `backfillStoredFileIdentity` from
   `@byline/core/stored-files`) with `--dry-run`, then for real, once per
   storage provider. Add `--collection <path>` to process one collection at a
   time, for example a small collection first. Backfill hashes the bytes
   present now: where an older version's object was later replaced at the same
   path, the recorded hash describes the current bytes, not the historical
   ones, which an unversioned store cannot recover. Run with `--verify`
   afterwards, and periodically, to check recorded hashes against the stored
   bytes.
4. Remove the host-side hashing bridge. Read `fileHash` and `storageValidator`
   from the stored-file value; treat an absent hash as an error where identity
   is required.
5. For change detection, compare a `head` or bound `download` validator with the
   recorded one using `isSameStorageValidator`, and re-hash when the kinds
   differ or the validator is absent. When bytes and identity must belong
   together, read with `download(path, { expect: recordedValidator })`.
6. A host-side storage provider keeps working unchanged — new uploads still
   record `fileHash`. Each optional capability adds one thing independently:
   `download` (with a usable validator) enables bound reads and the backfill
   (which also needs the adapter's `storedFiles` support, built into both
   first-party adapters); `head` enables cheap change probes; returning
   `storageValidator` from `upload` and `move` records the stored version at
   those operations. The `@byline/storage-conformance` suite checks providers
   that implement `download` and `head`.
