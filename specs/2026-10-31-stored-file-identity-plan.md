---
title: "Stored-file content identity — implementation plan"
path: "stored-file-identity-plan"
summary: "Implement stored-file content hashes, storage validators, bound storage reads and an idempotent backfill in four reviewable stages with conformance on both databases."
---

# Stored-file content identity — implementation plan

Companions:

- [Specification](./2026-10-31-stored-file-identity-spec.md) — the contract this plan implements. Section numbers below refer to it.
- [Track roadmap](./2026-10-31-extraction-retrieval-track-roadmap.md) — Phase 1 tasks 1.2–1.7 map onto the stages here.

## Start here

1. Tony accepted the specification and answered its questions on 2026-10-31
   (decisions table below). Checkpoint 1 was approved at snapshot `61a9a60`.
2. The run is coordinated (`/coordinate`, run `2026-10-31-stored-file-identity`).
   Claude Code implements; the reviewer approves each checkpoint against a
   named snapshot. Implementation pauses at every handoff.
3. Before the first implementation stage, the implementer publishes a
   handshake amendment that adds checkpoints 2–4 with the scopes listed here.
4. Integration and conformance suites use only `_test` databases, run
   serially, and are announced in the mailbox so the two sessions never run
   them at the same time.
5. Commit only when Tony asks, with conventional messages and `git commit -s`.

## Decisions

| # | Question (spec §7) | Answer | Date |
|---|---|---|---|
| 1 | Strict `fileHash` validation | Yes, with a check query in the adoption note | 2026-10-31 |
| 2 | Backfill verify mode | Yes, report-only | 2026-10-31 |
| 3 | S3-compatible server in CI | Yes, in this phase. MinIO no longer publishes public images, so Tony chose RustFS (`rustfs/rustfs:1.0.4`, pinned) | 2026-10-31 |
| 4 | CLI command or script only | Script only | 2026-10-31 |
| 5 | Upload-receipts issue | Open the issue; do not build | 2026-10-31 |
| 6 | Postgres `variants` copy fix in this phase | Yes, separate `fix(db-postgres)` change with a regression test | 2026-10-31 |
| 7 | Collection scope for backfill (added by Tony) | Yes, for fill and verify | 2026-10-31 |

## Stage 1 — Core contract and upload hashing

Roadmap task 1.2. Spec §4.1–4.4, §4.9.

- [x] Add `StorageValidator`, `StoredObjectRead`, optional `download?` and
      `head?` to `IStorageProvider`, and optional `storageValidator` to
      `StoredFileLocation` and `StoredFileValue`, in
      `packages/core/src/@types/storage-types.ts` and `field-data-types.ts`.
      Write the JSDoc the spec requires: what `fileHash` covers, the verbatim
      storage rule, absence semantics, and that validators are never compared
      with the hash.
- [x] Add `ERR_STORAGE_PRECONDITION` to `packages/core/src/lib/errors.ts`.
- [x] Add a hashing helper under `packages/core/src/storage/` that hashes a
      `Buffer` directly and wraps a stream in a hashing pass-through, failing on
      a short or over-long stream against the declared size.
- [x] Use it in `services/field-upload.ts`: record `fileHash` and the provider's
      `storageValidator` on the new `StoredFileValue`.
- [x] Tighten the Zod rules in `schemas/zod/builder.ts` to
      `/^[0-9a-f]{64}$/` and the validator limits (decision 1).
- [x] Unit tests (node mode): buffer and stream hashing against known digests,
      short-stream failure, `uploadField` populating both values with a stub
      provider, a stub without a validator, and Zod rejection of `''` and of
      upper-case or short digests.

## Stage 2 — Provider read primitives and storage conformance

Roadmap tasks 1.3–1.4. Spec §4.4–4.6, §5.

- [x] Create private `packages/storage-conformance` in the shape of
      `packages/search-conformance`: manifest, exports, build and typecheck
      scripts, and the nine cases in spec §5, including the wrappers that
      remove `head` and `download` and the overlapping-reader case.
- [x] `storage-local`: temp-file-and-rename upload with `fstat` validator;
      `download` from an open handle with fail-closed `expect`; `head`; `move`
      returning the validator, with the `EXDEV` fallback rewritten to
      temp-copy-and-rename and the destination-committed error when the source
      unlink fails. Add node-mode Vitest wiring to the package, run the suite in
      a temporary directory, and force the `EXDEV` path in unit tests.
- [x] `storage-s3`: one shared validator-selection function (usable
      `VersionId`, never `"null"`, else `ETag`, else none) used by upload,
      copy, `GetObject` and `HeadObject`; `download` through one `GetObject`
      with `IfMatch` or version comparison; `head`; `move` returning the copy's
      validator. Mocked-client unit tests for the selection rule, `412`
      mapping, kind transitions, `validator-unavailable`, and body disposal on
      every rejection; the conformance suite, including the
      suspended-versioning case, gated on `BYLINE_S3_TEST_ENDPOINT`.
- [x] An S3-compatible service container (RustFS, see decision 3), versioned
      and suspended test buckets created by the suite, and the S3 environment
      variables in `.github/workflows/ci.yml`.
- [x] Wire the new package into knip, `knip.exports.baseline.json` if needed,
      and the turbo pipeline.

**Checkpoint 2** — scope: `packages/core/src/@types`, `packages/core/src/lib/errors.ts`,
`packages/core/src/storage`, `packages/core/src/services/field-upload.ts`,
`packages/core/src/schemas`, `packages/storage-conformance`,
`packages/storage-local`, `packages/storage-s3`, `.github/workflows/ci.yml`,
`knip.json`, `knip.exports.baseline.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `turbo.json`.
Review: the contract matches spec §4; bound reads cannot pair bytes with
another version's validator (inspect the local handle, the local `EXDEV`
fallback, and the S3 single-request paths); no `"null"` version id becomes a
validator; every `expect` rejection disposes of the body and carries the right
`reason`; stream hashing cannot record a partial hash and cleans up as spec
§4.1 states; conformance cases match spec §5. Checks: Biome read-only, typecheck, unit tests, storage conformance
(local always, S3 when an endpoint is available — say which), knip.

## Stage 3 — Persistence and backfill

Roadmap tasks 1.5–1.6. Spec §4.7–4.8.

- [x] Add `storage_validator_kind` and `storage_validator_value` to
      `byline_store_file` in both adapters' Drizzle schemas; generate
      development migrations with `pnpm drizzle:generate` for each adapter.
- [x] Add the new upgrade scripts: `packages/db-postgres/sql/0015_add-stored-file-validator.sql`
      and `packages/db-mysql/sql/0010_add-stored-file-validator.sql`, plus
      their README entries. Do not touch the CLI baselines; the human squash at
      release covers them.
- [x] Extend `storeColumnManifest`, `storage-flatten.ts`, `storage-restore.ts`
      (null to omitted for both values), and both adapters' insert and query
      mappings.
- [x] Add the new columns to the two Postgres version-copy statements in
      `storage-commands.ts`. Add `variants` there as a separate
      `fix(db-postgres)` change with its own regression test (decision 6).
- [x] Add `db.queries.storedFiles.listStoredFilePaths` (`identity: 'missing' |
      'present'`, optional `collectionId`) and
      `db.commands.storedFiles.setIdentityForPath` (optional `collectionId`)
      to the `IDbAdapter` types and both adapters, and a `stored-file-identity`
      db-conformance suite: round trip of both values, version copy preserving
      them, restore omitting nulls, keyset listing filtered by provider and by
      collection, `'present'` returning every hash group for each path with
      `limit` counting paths (a path's groups never split across pages),
      update-only-where-null idempotence, and a collection-scoped update never
      writing another collection's rows.
- [x] Add `backfillStoredFileIdentity` to core (server-only export) with
      `mode: 'fill' | 'verify'` and optional `collectionPath`, following the
      selection, scope, one-read-per-object, legacy-null and summary rules in
      spec §4.8 (decisions 2 and 7). Unit tests with an in-memory adapter fake
      and stub providers: missing objects, a provider without `download`, read
      failures, an interrupted run resuming, a re-run making no changes, an
      unknown collection path, verify reporting matched and mismatched hash
      groups and writing nothing. Paging regression (service and
      db-conformance): `batchSize: 1`, the first path carrying two different
      hashes and another path after it, within a collection scope — every hash
      group is reported, each path is read once, nothing is written, and rows
      outside the collection are untouched.
- [x] Add `apps/webapp/byline/scripts/backfill-file-identity.ts` following the
      existing `backfill-*.ts` scripts, with `--verify`, `--collection`,
      `--dry-run`, `--limit` and `--batch-size`.
- [x] Run `pnpm test:integration` for `@byline/db-postgres`, `@byline/db-mysql`
      and `@byline/client` serially against the `_test` databases.

**Checkpoint 3** — scope: `packages/core`, `packages/db-postgres`,
`packages/db-mysql`, `packages/db-conformance`, `packages/client` (only if the
client surfaces the new field type), `apps/webapp/byline/scripts`.
Review: migrations and upgrade scripts agree; the copy statements carry the
new columns; restore never yields `null` or `''`; backfill never overwrites a
non-null hash and reads each object once; the legacy-null policy matches spec
§4.8. Checks: everything from checkpoint 2 plus `pnpm byline:generate:check`
and both integration suites, with database names stated.

## Stage 4 — Documentation and release preparation

Roadmap task 1.7.

- [x] Update `docs/04-collections/06-file-media-uploads.md` with content
      identity, validators, bound reads, provider capabilities and the backfill;
      update `docs/10-api-reference/01-configuration.md` where it lists
      `IStorageProvider`. Run `pnpm docs:check`.
- [x] Add a changeset (minor for the lockstep set) and the downstream adoption
      note from spec §10, revised to match what shipped.
- [ ] Reconcile issue #85: replace its checklist with spec §9 as delivered,
      linking the spec. Open the upload-receipts issue (decision 5).
- [x] Tick roadmap tasks 1.2–1.7 and add the session log row.

**Checkpoint 4** — scope: `docs`, `.changeset`, `specs`. Review: docs accuracy
against the code, house style, no downstream names. Checks: `pnpm docs:check`,
`git diff --check`, Biome read-only.

## Risks

- **Atomic replace on unusual filesystems.** Rename-over-existing is atomic on
  POSIX filesystems; network mounts may differ. The temp file lives in the
  destination directory to avoid `EXDEV`.
- **S3-compatible stores.** Some do not return `VersionId` or honour `IfMatch`
  on `GetObject`. The provider also checks the response `ETag` after
  `IfMatch`, so a store that ignores `IfMatch` still fails closed. The
  conformance suite against MinIO covers the common case; other stores are
  documented as unverified.
- **External in-place writers (local).** A process outside Byline that writes
  into a stored file in place can change bytes under an open reader. This is
  outside the bound-read guarantee and is documented, not prevented.
- **Memory.** Uploads are still buffered by the host adapter. Backfill streams,
  so large legacy objects do not load into memory.
- **Client-supplied identity.** Spec §4.10 accepts the current trust model; the
  verify mode, if adopted, is the mitigation.
