# Collection Versioning

> Companions:
> - [CORE-DOCUMENT-STORAGE.md](./CORE-DOCUMENT-STORAGE.md) — document versioning is the sibling pillar; this doc covers the *schema* version that documents are stamped against.
> - [DOCUMENT-PATHS.md](./DOCUMENT-PATHS.md) — `useAsPath` participates in the schema fingerprint described below.

## Overview — what's implemented and what isn't

Byline lists **immutable versioning** as a differentiating pillar. The document half of that story has been in place since the beginning: every save writes a new `documentVersions` row keyed by UUIDv7, a `current_documents` view resolves "the latest" via `ROW_NUMBER() OVER PARTITION`, and status changes are the deliberate exception that mutates a row in place.

The collection half is *partially* in place. **Phase 1 — data model + fingerprinting — is shipped.** It records, on every document save, which schema version the document was written against. It does not yet read by that version.

| Phase | Goal                                                                                              | Status        |
|-------|---------------------------------------------------------------------------------------------------|---------------|
| 1     | Record `version` + `schema_hash` on `collections`; stamp `collection_version` on every `document_versions` row | **Shipped**   |
| 2     | Historical config snapshots in a `collection_versions` table; FK from `document_versions`         | Deferred      |
| 3     | `getCollectionByVersion(collectionId, version)` lookup in core / client API                       | Deferred      |
| 4     | In-memory forward-migration from any historical shape to the current shape                       | Deferred      |
| 5     | Optional strict-CI mode (require manual `version` bumps on any hash change)                       | Deferred      |

The larger goal is unchanged: a developer should be able to fetch any document version, resolve the collection schema *as it was* at that point in time, and migrate it forward in memory. Phase 1 is the recording layer that makes that possible later. Phases 2–5 build the migration machinery itself.

> **What you can rely on today.** Every document version carries an integer `collection_version` you can read and reason about, and every collection row carries a `schema_hash` that bumps when the data-affecting parts of the schema change. **What you cannot rely on yet:** materialising an old document against its original schema. The read path uses the live `CollectionDefinition` regardless of `collection_version`. See [Boundary](#boundary--what-does-not-read-by-version-yet) below.

## What Phase 1 ships

### Data model

Two columns on `collections`, one on `document_versions`:

```sql
collections
  version       integer  NOT NULL DEFAULT 1
  schema_hash   varchar(64)             -- nullable in Phase 1; tightens in Phase 2

document_versions
  collection_version  integer  NOT NULL
```

Both `current_documents` and `current_published_documents` views project `collection_version` so it surfaces on every read. The columns landed in the baseline schema migration `0000_condemned_kronos.sql` (the pre-beta migrations were consolidated; they are not separate as-shipped). Every pre-existing row is implicitly v1.

`schema_hash` stays nullable until Phase 2 introduces the `collection_versions` history table — at that point the post-`ensureCollections()` invariant ("any row written by Byline has a hash") becomes a database constraint.

### Code surface

| File                                                                       | Role                                                                            |
|----------------------------------------------------------------------------|---------------------------------------------------------------------------------|
| `packages/core/src/storage/collection-fingerprint.ts`                      | Data-shape SHA-256 fingerprint of a `CollectionDefinition`                     |
| `packages/core/src/services/collection-bootstrap.ts`                       | `ensureCollections()` — startup reconciliation                                  |
| `packages/core/src/core.ts`                                                | `initBylineCore` is `async`; exposes `collectionRecords` map + `getCollectionRecord(path)` |
| `packages/core/src/@types/collection-types.ts`                             | Optional `version?: number` on `CollectionDefinition`                          |
| `packages/db-postgres/src/database/schema/index.ts`                        | Columns + view projections                                                      |
| `packages/db-postgres/src/modules/storage/storage-commands.ts`             | `collections.create/update`; `document_versions` insert writes `collection_version` |
| `packages/core/src/services/document-lifecycle.ts`                         | `DocumentLifecycleContext.collectionVersion` threaded to the adapter           |

## The fingerprint

`schema_hash` is a SHA-256 over a canonicalised projection of the `CollectionDefinition`. The fingerprint defines what counts as a "schema change" for the purposes of bumping the version. It is deliberately narrow — only properties that affect the storable document shape participate.

### Included (a change bumps the version)

- `path`
- `useAsTitle`, `useAsPath`
- `fields` (recursive). Per field: `name`, `type`, `optional`, `localized`. Compound types recurse into `fields` / `blocks`. Per type: `relation.targetCollection`, `relation.displayField`, `select.options.value`, `datetime.mode`, and `validation` for `text` / `textArea` / `richText` / `float` / `integer`.
- `workflow` — status `name`s and `defaultStatus`. Labels and verbs are stripped.
- Per-field `upload` — `mimeTypes`, `maxFileSize`, and `sizes[].{name, width, height, fit, format, quality}`.

### Excluded (changes do NOT bump)

- `labels.singular`, `labels.plural`
- `hooks` (function values can't be JSON-stable anyway)
- `search`, `showStats` (admin UX)
- Field-level `label`, `helpText`, `placeholder` (admin UX)
- Workflow status `label`, `verb`
- `upload.storage` (provider implementation, not data shape)
- Select option `label`s

The stripping rules are enforced by **whitelist** — known keys are copied; unknown keys are dropped. So adding a new presentational field to `CollectionDefinition` will not silently churn versions. Stability is covered by 19 contract tests in `collection-fingerprint.test.node.ts`: key-order invariance, function exclusion, every "does NOT bump" rule, and every "DOES bump" rule.

### Why SHA-256, why Web Crypto

SHA-256 over a 32-bit hash because this is the tamper-evidence record for the lifetime of the installation — collision resistance matters. 64 hex chars is cheap to store and compare.

The hash is computed via `crypto.subtle.digest` (Web Crypto), not Node's `node:crypto`. Web Crypto is identical in Node 20+ and every modern browser, so the fingerprint module stays free of Node built-ins. An earlier iteration imported `node:crypto.createHash` at the top of the file; Vite's module-graph walker pulled the import into the client bundle (via `core.ts` → `collection-bootstrap.ts` → fingerprint) even though the client never calls `fingerprintCollection`. Externalising `node:crypto` would have thrown at runtime. The Web Crypto switch eliminated the issue without conditional platform code; the side-effect is that `fingerprintCollection` is `async`.

## Version-bump policy

`CollectionDefinition` carries an optional `version?: number`. Behaviour, in `ensureCollections` / `reconcileCollection`:

1. Compute the fingerprint of the in-memory definition.
2. **No row exists** → insert with `version = definition.version ?? 1` and the fingerprint.
3. **Row exists, hash matches** → no-op. Independent of any `definition.version` pin: the hash is the source of truth for "did the shape change?", and a no-op write would just add noise.
4. **Row exists, hash differs**:
   - `definition.version` pinned and `> stored.version` → use the pin.
   - `definition.version` pinned and `< stored.version` → throw. Pinning backwards is always a developer error (it silently desynchronises the version from document history).
   - `definition.version` pinned and `== stored.version` → use it. Effectively a "yes, I know the shape changed but don't bump" pin.
   - `definition.version` omitted → auto-bump to `stored.version + 1`.
5. **First-run-after-Phase-1 special case.** When `stored_hash` is NULL (existing row pre-dating this feature), don't auto-bump. Backfill the hash at whatever version the DB already holds. Without this, every collection would bump from v1 to v2 on the first boot after Phase 1 deployed, for no information reason.

The hybrid — auto-bump as default, explicit pin as escape hatch — was chosen over both alternatives:

- **"Explicit only" is easy to forget and produces silent drift.** A dev adds a field, forgets to bump, and `collection_version = 3` is now stamped on a row authored against a different shape than v3.
- **"Hash-only, no pin"** is the cleanest API but blocks two real workflows: aligning version numbers across environments (so staging catches up to prod), and reserving a round number for a planned major change.
- **The hybrid** keeps the common case zero-effort while allowing either escape. Even under a manual pin the hash is still recorded, so Phase 2 can detect "the config on disk no longer matches the version we have written down." That's why `schema_hash` exists as a separate column rather than being implied by `version`.

A future Phase-5 `strictCollectionVersions: true` flag could invert the default for CI, requiring explicit bumps when the hash changes. The plumbing is already in place — it's only a policy knob.

## Boundary — what does NOT read by version yet

Storage and the document lifecycle **write** `collection_version` but do not read by it. Every read still uses the current `CollectionDefinition` in memory.

A document from `collection_version = 2` loaded against a live v3 definition reconstructs against v3's field set. If v3 added a field, the field is absent on the reconstructed document (no row exists for it). If v3 removed a field, the orphan store rows from v2 are silently ignored by `restoreFieldSetData`. If v3 *renamed* a field, the v2 rows are orphaned the same way and the new name is absent — which is the failure mode that motivates the future migration phases.

This is the deliberate scope of Phase 1: record now so the migration story can land later **without a schema migration**. Until Phase 3+ ships, treat `collection_version` as recorded data without semantics in the read path.

## Startup reconciliation

`initBylineCore()` calls `ensureCollections()` once and caches the result on `BylineCore`. Reconciliation involves:

1. Fingerprinting every in-memory definition (sub-millisecond, no I/O).
2. Reading the stored row for each (one indexed `SELECT` on a ≤ 50-row table).
3. Comparing hashes.
4. Possibly an `UPDATE` (bump path) or `INSERT` (first boot).
5. Possibly throwing (backwards-pin error) **before the process accepts traffic**.

The loop is `Promise.all(...)` across all definitions, so wall-clock cost is one DB round-trip plus the fingerprint cost — not N round-trips. For a local Postgres that's ~5 ms total; for a managed DB across a VPC, ~10–50 ms. It's paid once per process.

### Why startup, not lazy

A previous prototype used a lazy `ensureCollection(path)` that ran on every admin request. That worked when reconciliation was just "does the row exist? if no, insert." Phase 1 made the work *semantic* — decisions with consequences, including "should this throw and block the process?" — and where a semantic decision runs changes its failure surface.

| Concern                                  | Startup                                                        | Lazy (per-request, cached)                                                |
|------------------------------------------|----------------------------------------------------------------|---------------------------------------------------------------------------|
| When a `version` pin error surfaces      | Server refuses to start (loud, ops-visible)                    | First request to the offending route fails (scattered, user-visible)      |
| When version-bump logs appear            | All at boot, easy to grep                                      | Scattered across the day's request logs                                   |
| When an unreachable DB blocks you        | Boot                                                           | First request per collection                                              |
| First-request latency                    | Normal                                                         | Adds 1–2 round-trips on cold collection paths                             |
| State predictability for ops             | "Everything reconciled by the time the server is up"           | "Each collection reconciles when someone first hits it"                   |
| Consistency under parallel cold-starts   | Single synchronous phase, no races                             | Two simultaneous first-requests can both attempt a bump                   |

The last row matters under load. Lazy reconciliation inside a request handler has a lost-update window where two concurrent first-requests both compute the same hash, both see "no match," and both try to bump — yielding either a duplicate-key error or a double-bump. Startup reconciliation runs once, before any request.

### Where lazy (or a hybrid) would actually win

Three configurations would flip the trade. None apply today:

1. **Serverless / edge / short-lived processes.** Every cold start pays startup cost. For 20 collections at ~50 ms total, that's a meaningful slice of a 100 ms invocation budget. Byline's current target is a long-running Node process, so this doesn't bite — but a Cloudflare Workers or AWS Lambda target would need to revisit.
2. **Hundreds or thousands of collections in a multi-tenant installation.** At 500+ collections, even concurrent SELECTs get uncomfortable. Two better options at that scale: lazy DB reconciliation with synchronous in-memory fingerprinting at startup (catches authoring errors fail-fast without hitting the DB for unused schemas), or a "did anything change since last boot?" aggregate-hash check that reconciles individually only on a mismatch.
3. **Reconciliation starts doing expensive work.** If Phase 2's history-table writes get large enough that bumping 20 collections on a redeploy is painful, selective or deferred reconciliation would win. Phase 2 writes are still "one INSERT per changed collection," so this is speculative.

The Phase-1 code is structured so that dropping in a lazy or hybrid strategy later is a localised change — `collectionRecords` stays the contract; only the population strategy moves.

### Fail-fast by default

A concrete benefit worth pulling out: startup reconciliation means a backwards `version` pin, a duplicate collection path, or an adapter mis-configuration fails the process before it accepts traffic. Operators find out during deploy, not during the first affected request. For a CMS where the blast radius of a silent schema desync is "every document written during the window is mis-stamped," that's the correct trade even before considering performance.

## What's next — Phases 2–5

The remaining phases turn `collection_version` from recorded data into a load-bearing read primitive. Each phase produces a useful artefact on its own; they don't have to land together.

### Phase 2 — historical config snapshots

The smallest useful follow-up. Add a `collection_versions` history table:

```sql
collection_versions
  collection_id   uuid          fk → collections.id
  version         integer
  config          jsonb         -- the snapshot of CollectionDefinition at this version
  schema_hash     varchar(64)   NOT NULL
  created_at      timestamptz
  primary key (collection_id, version)
```

`reconcileCollection` writes one row per bump. `schema_hash` on `collections` tightens to NOT NULL. A composite FK from `document_versions.(collection_id, collection_version)` to `collection_versions.(collection_id, version)` becomes available; whether to add it is a Phase-2 decision (it pins the data integrity but breaks soft-delete-and-restore of versions).

### Phase 3 — fetch by version

Add `getCollectionByVersion(collectionId, version)` to `ICollectionQueries`, exposed through `BylineCore` and `@byline/client`. Returns the historical `CollectionDefinition` (deserialised from `collection_versions.config`). Cached per `(collectionId, version)` for the process lifetime — historical rows are immutable, so the cache has no invalidation problem.

This is the smallest read-side piece that unblocks anything interesting. With it, debugging tools and admin previews can render an old document against its original schema even before forward-migration logic exists.

### Phase 4 — in-memory forward-migration

Wire historical-definition lookup through `restoreFieldSetData` and the populate walk. The shape:

1. Read `(documentVersionId, collectionVersion)` from `document_versions`.
2. Fetch the historical `CollectionDefinition` for `(collectionId, collectionVersion)`.
3. Reconstruct the document against the historical schema.
4. Apply a chain of registered migration functions (`migrateV1ToV2`, `migrateV2ToV3`, …) to project the historical document onto the current schema in memory.
5. Hand the migrated document to the rest of the read pipeline.

The migration functions themselves are application code — Byline ships the framework that calls them, not the migrations. The contract is "given a document at version N, return a document at version N+1." Each migration is one function on `CollectionDefinition.migrations`, declared alongside the schema.

Open design question for Phase 4: whether migrations run on read (every read pays the migration cost; storage is never rewritten) or on next-write (the document is rewritten under the latest schema the next time it's edited). Today's leaning is read-time, with an opt-in "write-back" mode that materialises the migration into a new `documentVersion` after reading. Decided when Phase 4 lands.

### Phase 5 — strict-CI mode

A `strictCollectionVersions: true` flag on `BylineCore` config. When enabled, `reconcileCollection` throws if `definition.version` is omitted and the hash differs. Useful for CI pipelines that want every schema change to be an explicit, code-reviewable version bump. Off by default — auto-bump remains the dev-loop ergonomics choice.

## Known limitations today

- **`schema_hash` is nullable.** It tightens to `NOT NULL` when Phase 2 lands. The runtime invariant is that any row written post-`ensureCollections()` has a hash; only rows that exist *before* the first Phase-1 boot can legitimately carry NULL.
- **No composite FK from `document_versions` to a `(collection_id, version)` pair.** No table to anchor against until Phase 2.
- **Bootstrap is fail-fast, not fail-partial.** If one of N collections throws (e.g. a backwards pin), `Promise.all` rejects on the first failure and the server refuses to start. Other in-flight reconciliations may have already written to the DB. Intentional — a partially-reconciled startup is worse than no startup — but worth knowing.
- **`initBylineCore` is async.** The webapp uses top-level `await` in `byline/server.config.ts`, which TanStack Start / Vite support natively. Scripts that import the config for side effects (seeds, one-offs) inherit the wait via ESM module evaluation. A future non-Vite consumer would need to await explicitly.
- **Reads ignore `collection_version`.** Stated above but worth restating: a v2 document loaded against a live v3 schema reconstructs against v3, not v2. Renamed fields, removed fields, and type changes between versions are not handled until Phase 4.

## Code map

| Concern                                 | Location                                                                  |
|-----------------------------------------|---------------------------------------------------------------------------|
| Fingerprint                             | `packages/core/src/storage/collection-fingerprint.ts`                     |
| Fingerprint contract tests              | `packages/core/src/storage/collection-fingerprint.test.node.ts`           |
| Startup reconciliation                  | `packages/core/src/services/collection-bootstrap.ts`                      |
| `BylineCore` accessor                   | `packages/core/src/core.ts` (`getCollectionRecord(path)`)                 |
| Optional `version` pin                  | `packages/core/src/@types/collection-types.ts` (`CollectionDefinition.version`) |
| `collection_version` write              | `packages/core/src/services/document-lifecycle.ts` (`DocumentLifecycleContext.collectionVersion`) |
| Postgres schema (columns + views)       | `packages/db-postgres/src/database/schema/index.ts`                       |
| `collections.create/update` adapter     | `packages/db-postgres/src/modules/storage/storage-commands.ts`            |
| Baseline migration                      | `packages/db-postgres/src/database/migrations/0000_condemned_kronos.sql`  |
