---
title: "Collection Versioning"
path: "collection-versioning"
summary: "Byline records which schema version each document was written against. How the collection fingerprint (schema_hash) decides when a version bumps, the auto-bump-with-pin policy, startup reconciliation, and the boundary: what is recorded today versus what is not yet read by version."
---

# Collection Versioning

Companions:
- [Document Storage](../03-architecture/01-document-storage.md) — the *document* versioning this is the schema-side companion to (the sibling pillar).
- [Collections](./index.md) — the `version?` pin and the `useAsPath` / `useAsTitle` fields that participate in the fingerprint.
- [Architecture — document level vs version level](../03-architecture/index.md#3-document-level-vs-version-level) — where schema versioning sits among Byline's versioning stories.

Immutable versioning is one of Byline's differentiating pillars. The *document* half of that story is fundamental: every save writes a new `documentVersions` row keyed by UUIDv7, a `current_documents` view resolves "the latest" via `ROW_NUMBER() OVER PARTITION`, and a status change is the deliberate exception that mutates a row in place. **Collection versioning** is the schema-side companion: on every document save, Byline records which version of the collection's *schema* the document was written against.

Read this document when you need to reason about which schema a stored document was written against, understand when a schema edit bumps the recorded version, or pin a version explicitly across environments.

> **What you can rely on.** Every document version carries an integer `collection_version` you can read and reason about, and every collection row carries a `schema_hash` that bumps when the data-affecting parts of the schema change. The aim is that a document version can later be resolved against the collection schema *as it was* when the version was written, and migrated forward in memory. Today Byline records the version; it does not yet read documents by it: the read path uses the live `CollectionDefinition` regardless of `collection_version`. See [the boundary](#boundary-what-does-not-read-by-version-yet) below for exactly where that line sits.

## What is recorded

Two columns on `collections`, one on `document_versions`:

```sql
collections
  version       integer  NOT NULL DEFAULT 1
  schema_hash   varchar(64)             -- nullable; see below

document_versions
  collection_version  integer  NOT NULL
```

Both `current_documents` and `current_published_documents` views project `collection_version` so it surfaces on every read. Every pre-existing row is implicitly v1. `schema_hash` is nullable to accommodate rows that predate the feature; any row written after `ensureCollections()` runs carries a hash.

### Fingerprint

`schema_hash` is a SHA-256 over a canonicalised projection of the `CollectionDefinition`. The fingerprint defines what counts as a "schema change" for the purposes of bumping the version. It is deliberately narrow: only properties that affect the storable document shape participate.

**Included (a change bumps the version):**

- `path`
- `useAsTitle`, `useAsPath`
- `fields` (recursive). Per field: `name`, `type`, `optional`, `localized`. Compound types recurse into `fields` / `blocks`. Per type: `relation.targetCollection`, `relation.displayField`, `select.options.value`, `datetime.mode`, and `validation` for `text` / `textArea` / `richText` / `float` / `integer`.
- `workflow` — status `name`s and `defaultStatus`. Labels and verbs are stripped.
- Per-field `upload` — `mimeTypes`, `maxFileSize`, and `sizes[].{name, width, height, fit, format, quality}`.

**Excluded (changes do NOT bump):**

- `labels.singular`, `labels.plural`
- `hooks` (function values can't be JSON-stable anyway)
- `search`, `showStats` (admin UX)
- Field-level `label`, `helpText`, `placeholder` (admin UX)
- Workflow status `label`, `verb`
- `upload.storage` (provider implementation, not data shape)
- Select option `label`s

The stripping rules are enforced by **whitelist**: known keys are copied; unknown keys are dropped. So adding a new presentational field to `CollectionDefinition` will not silently churn versions. Stability is covered by the contract tests in `collection-fingerprint.test.node.ts`: key-order invariance, function exclusion, every "does NOT bump" rule, and every "DOES bump" rule.

**Why SHA-256, why Web Crypto.** SHA-256 over a 32-bit hash because this is the tamper-evidence record for the lifetime of the installation: collision resistance matters. 64 hex chars is cheap to store and compare. The hash is computed via `crypto.subtle.digest` (Web Crypto), not Node's `node:crypto`. An earlier iteration imported `node:crypto.createHash`; Vite's module-graph walker pulled the import into the client bundle (via `core.ts` → `collection-bootstrap.ts` → fingerprint) even though the client never calls `fingerprintCollection`. Externalising `node:crypto` would have thrown at runtime. The Web Crypto switch eliminated the issue without conditional platform code; the side-effect is that `fingerprintCollection` is `async`.

### Version-bump policy

`CollectionDefinition` carries an optional `version?: number`. Behaviour, in `ensureCollections` / `reconcileCollection`:

1. Compute the fingerprint of the in-memory definition.
2. **No row exists** → insert with `version = definition.version ?? 1` and the fingerprint.
3. **Row exists, hash matches** → no-op. Independent of any `definition.version` pin: the hash is the source of truth for "did the shape change?", and a no-op write would just add noise.
4. **Row exists, hash differs:**
   - `definition.version` pinned and `> stored.version` → use the pin.
   - `definition.version` pinned and `< stored.version` → throw. Pinning backwards is always a developer error (it silently desynchronises the version from document history).
   - `definition.version` pinned and `== stored.version` → use it. Effectively a "yes, I know the shape changed but don't bump" pin.
   - `definition.version` omitted → auto-bump to `stored.version + 1`.
5. **First-run-after-Phase-1 special case.** When `stored_hash` is NULL (existing row pre-dating this feature), don't auto-bump. Backfill the hash at whatever version the DB already holds. Without this, every collection would bump from v1 to v2 on the first boot after Phase 1 deployed, for no information reason.

The hybrid (auto-bump as default, explicit pin as escape hatch) was chosen over both alternatives:

- **"Explicit only" is easy to forget and produces silent drift.** A dev adds a field, forgets to bump, and `collection_version = 3` is now stamped on a row authored against a different shape than v3.
- **"Hash-only, no pin"** is the cleanest API but blocks two real workflows: aligning version numbers across environments (so staging catches up to prod), and reserving a round number for a planned major change.
- **The hybrid** keeps the common case zero-effort while allowing either escape. Even under a manual pin the hash is still recorded, so Phase 2 can detect "the config on disk no longer matches the version we have written down." That's why `schema_hash` exists as a separate column rather than being implied by `version`.

A future Phase-5 `strictCollectionVersions: true` flag could invert the default for CI, requiring explicit bumps when the hash changes. The plumbing is already in place: it's only a policy knob.

### Boundary — what does NOT read by version yet

Storage and the document lifecycle **write** `collection_version` but do not read by it. Every read still uses the current `CollectionDefinition` in memory.

A document from `collection_version = 2` loaded against a live v3 definition reconstructs against v3's field set. If v3 added a field, the field is absent on the reconstructed document (no row exists for it). If v3 removed a field, the orphan store rows from v2 are silently ignored by `restoreFieldSetData`. If v3 *renamed* a field, the v2 rows are orphaned the same way and the new name is absent, which is the failure mode that motivates the future migration phases.

This is the deliberate scope of Phase 1: record now so the migration story can land later **without a schema migration**. Until Phase 3+ ships, treat `collection_version` as recorded data without semantics in the read path.

#### Removed block types

Removing a block definition does not remove its stored rows, but it can remove the block from the reconstructed document without a warning. `restoreBlocksFieldData` in `packages/core/src/storage/storage-restore.ts` skips rows whose block type is absent from the current definition. Surviving blocks retain their stored array indices. This affects ordinary reads and reads of historical versions because both use the current schema.

The outcome depends on the removed block's position. In the examples below, `retired` denotes a block type removed from the collection and `live` denotes a type still declared:

| Stored block order | Reconstructed content | Consequence |
| --- | --- | --- |
| `[retired, live]` | An empty array slot at index 0, followed by `live` at index 1 | JSON serialization represents the empty slot as `null`; validating that payload reports `content[0]: Item must be an object`. |
| `[live, retired]` | Only `live` at index 0 | Field validation can pass even though the retired block is missing. Flattening this payload emits no rows for the retired block in the new version. |
| `[retired]` | An empty array for a required blocks field; `undefined` for an optional one | Field validation can pass — an empty array does not fail a required blocks field — and flattening emits no rows for the retired block. |

The sparse array in the first case has another failure mode. `validateDocumentFields` currently visits items with `Array.prototype.forEach`, which skips empty slots. Validating that array directly can therefore report no issues, while `flattenFieldSetData` subsequently throws when it tries to destructure the missing item. A successful field-validation audit alone does not establish that reconstruction retained all stored content or that the payload can be flattened.

The original version's rows remain stored. Their presence does not make the omitted block readable through the current schema, and a collection-version bump does not select the old definition. Restoring a historical version alone does not restore its schema either.

Before removing a block type used by stored content, keep its definition available while you identify affected documents and migrate their blocks to supported types through revision-guarded writes. Verify block identities, order, and values as well as validation results. Historical versions can still need the old definition after current documents have been migrated. Do not treat filtering empty entries from reconstructed arrays as a content-preserving repair: that removes the visible symptom while accepting the omission.

Explicit diagnostics for unknown stored block types, preservation of their identity and position during recovery, and rejection of sparse arrays at validation are unresolved work. These limitations require a compatibility policy; the current implementation does not provide automatic block migration.

Byline's admin user interface already supports a document-level reconstruction warning banner, but removed block types do not currently produce those warnings. Its blocks field also renders no item when the value is malformed or its type is undeclared. An error placeholder at the original block position is a proposed recovery behavior, not a feature available today. Such a placeholder also needs a server-side save safeguard so editing a supported block cannot accidentally omit the unavailable content from a new version.

### Startup reconciliation

`initBylineCore()` calls `ensureCollections()` once and caches the result on `BylineCore`. Reconciliation involves:

1. Fingerprinting every in-memory definition (sub-millisecond, no I/O).
2. Reading the stored row for each (one indexed `SELECT` on a ≤ 50-row table).
3. Comparing hashes.
4. Possibly an `UPDATE` (bump path) or `INSERT` (first boot).
5. Possibly throwing (backwards-pin error) **before the process accepts traffic**.

The loop is `Promise.all(...)` across all definitions, so wall-clock cost is one DB round-trip plus the fingerprint cost, not N round-trips. For a local Postgres that's ~5 ms total; for a managed DB across a VPC, ~10–50 ms. It's paid once per process.

**Why startup, not lazy.** A previous prototype used a lazy `ensureCollection(path)` that ran on every admin request. That worked when reconciliation was just "does the row exist? if no, insert." Phase 1 made the work *semantic* (decisions with consequences, including "should this throw and block the process?"), and where a semantic decision runs changes its failure surface.

| Concern | Startup | Lazy (per-request, cached) |
|---|---|---|
| When a `version` pin error surfaces | Server refuses to start (loud, ops-visible) | First request to the offending route fails (scattered, user-visible) |
| When version-bump logs appear | All at boot, easy to grep | Scattered across the day's request logs |
| When an unreachable DB blocks you | Boot | First request per collection |
| First-request latency | Normal | Adds 1–2 round-trips on cold collection paths |
| State predictability for ops | "Everything reconciled by the time the server is up" | "Each collection reconciles when someone first hits it" |
| Consistency under parallel cold-starts | Single synchronous phase, no races | Two simultaneous first-requests can both attempt a bump |

The last row matters under load. Lazy reconciliation inside a request handler has a lost-update window where two concurrent first-requests both compute the same hash, both see "no match," and both try to bump, yielding either a duplicate-key error or a double-bump. Startup reconciliation runs once, before any request.

**Where lazy (or a hybrid) would actually win.** Three configurations would flip the trade, none of which apply today:

1. **Serverless / edge / short-lived processes.** Every cold start pays startup cost. For 20 collections at ~50 ms total, that's a meaningful slice of a 100 ms invocation budget. Byline's current target is a long-running Node process.
2. **Hundreds or thousands of collections in a multi-tenant installation.** At 500+ collections, even concurrent SELECTs get uncomfortable. Two better options at that scale: lazy DB reconciliation with synchronous in-memory fingerprinting at startup (catches authoring errors fail-fast without hitting the DB for unused schemas), or a "did anything change since last boot?" aggregate-hash check that reconciles individually only on a mismatch.
3. **Reconciliation starts doing expensive work.** If Phase 2's history-table writes get large enough that bumping 20 collections on a redeploy is painful, selective or deferred reconciliation would win.

The Phase-1 code is structured so that dropping in a lazy or hybrid strategy later is a localised change: `collectionRecords` stays the contract; only the population strategy moves.

**Fail-fast by default.** A concrete benefit worth pulling out: startup reconciliation means a backwards `version` pin, a duplicate collection path, or an adapter mis-configuration fails the process before it accepts traffic. Operators find out during deploy, not during the first affected request. For a CMS where the blast radius of a silent schema desync is "every document written during the window is mis-stamped," that's the correct trade even before considering performance.

---

## Current limitations

Recording the schema version is in place; *reading* by it is not. The boundary is:

- **Reads ignore `collection_version`.** A document written under v2 and loaded
  against a live v3 definition reconstructs against v3. A field v3 added is absent;
  a field v3 removed leaves orphaned store rows that are ignored; a renamed field
  reads as the old name orphaned and the new name absent. Materialising an old
  document against its original schema (and migrating it forward in memory) is
  not yet supported.
- **`schema_hash` is nullable.** The runtime invariant is that any row written
  after `ensureCollections()` carries a hash; only rows predating the feature can
  legitimately be `NULL`.
- **Bootstrap is fail-fast, not fail-partial.** If one collection throws (e.g. a
  backwards version pin), reconciliation rejects and the server refuses to start;
  other in-flight reconciliations may already have written. A partially-reconciled
  startup is deliberately treated as worse than no startup.
- **`initBylineCore` is async.** The webapp awaits it via top-level `await` in
  `byline/server.config.ts`; a non-Vite consumer would need to await explicitly.
