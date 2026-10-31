---
"@byline/core": minor
"@byline/storage-local": minor
"@byline/storage-s3": minor
"@byline/db-postgres": minor
"@byline/db-mysql": minor
---

Record stored-file content identity (#85). Every upload now sets
`StoredFileValue.fileHash` to the SHA-256 (lower-case hex) of the stored bytes,
computed in the same pass that hands them to the storage provider, and
`StoredFileValue.storageValidator` (`{ kind, value }`) to the provider's
validator for the stored version: `local-stat` for `@byline/storage-local`, and
`s3-version` or a strong `s3-etag` for `@byline/storage-s3`. The two are never
compared with each other. Unknown identity is absent, never `null` or `''`, and
the write schema rejects a malformed `fileHash`.

`IStorageProvider` gains optional `download` and `head`. `download` is a bound
read that returns the bytes with the validator of exactly those bytes, and its
fail-closed `expect` precondition rejects with the new `ERR_STORAGE_PRECONDITION`
(`changed`, `unsupported-kind`, `unestablishable`, `missing`). Both built-in
providers implement them. `@byline/storage-local` now writes and moves files
atomically (a new file renamed into place), so an open reader never sees mixed
bytes. `@byline/storage-s3` never treats a `"null"` version id or a weak ETag as
a validator.

The new server-only entry `@byline/core/stored-files` exports `hashStream`,
`uploadWithContentHash` and `backfillStoredFileIdentity`, which fills identity
for existing files (or, with `mode: 'verify'`, re-hashes and reports without
writing), optionally for one collection. Both database adapters add the
`storage_validator_kind` / `storage_validator_value` columns and optional
`storedFiles` maintenance primitives on `IDbAdapter`.

To adopt:

1. **Apply the database upgrade script** before starting the updated
   application. Take it from this release's Git tag:
   `packages/db-postgres/sql/0015_add-stored-file-validator.sql` for PostgreSQL,
   or `packages/db-mysql/sql/0010_add-stored-file-validator.sql` for MySQL.
   Apply any earlier scripts you have not yet applied first, in filename order.
   Both scripts are additive and safe to re-run. New installations created with
   `byline init` use the updated baseline and need no script.
2. **Check any existing hashes.** If your application wrote `fileHash` itself,
   confirm every value is 64 lower-case hexadecimal characters before saving
   documents. Otherwise the stricter schema rejects the save. On PostgreSQL:
   `SELECT count(*) FROM byline_store_file WHERE file_hash IS NOT NULL AND file_hash !~ '^[0-9a-f]{64}$'`
   must return 0.
3. **Backfill existing files** with `backfillStoredFileIdentity`, or copy the
   reference script `apps/webapp/byline/scripts/backfill-file-identity.ts`: run
   it with `--dry-run`, then for real, once per storage provider you have used.
   It hashes the bytes present now and never overwrites a recorded hash.
4. **Custom storage providers** keep working unchanged, and new uploads through
   them still record `fileHash`. Each optional capability adds one thing:
   `download` enables bound reads and the backfill; `head` enables cheap change
   probes; returning `storageValidator` from `upload` and `move` records the
   stored version at those operations. The private `@byline/storage-conformance`
   suite in the repository checks providers that implement `download` and
   `head`.
