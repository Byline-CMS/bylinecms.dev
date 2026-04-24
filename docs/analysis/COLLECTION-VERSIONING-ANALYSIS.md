# Collection Definition Versioning — Analysis

> Last updated: 2026-04-23
> Companion to [STORAGE-ANALYSIS.md](./STORAGE-ANALYSIS.md).
> Describes Phase 1 of collection versioning: how every collection
> definition gets a monotonically-increasing schema version, how that
> version is stamped onto each `documentVersions` row, and where the
> boundary sits between what's shipped and what's deferred.

## Context

Byline lists **immutable versioning** as a differentiating pillar. The
document half of that story has been in place for a while: every save
writes a new `documentVersions` row keyed by UUIDv7, a `current_documents`
view resolves "the latest" via `ROW_NUMBER() OVER PARTITION`, and status
changes are the one deliberate exception that mutates a row in place.

The collection half was missing. `collections.config` stored the full
`CollectionDefinition` as JSONB, but the row was silently overwritten
whenever the definition on disk changed. That meant:

- Old `documentVersions` rows had no reliable way to name the schema
  they were written under — the row JSONB they might be compared
  against had already moved on.
- A document saved against an older field shape couldn't be materialised
  against its *original* schema, only against whatever was current.
- Phase-2 goals like in-memory forward-migration ("read an old doc,
  project it onto the latest schema") had no anchor.

The larger goal is unchanged from the README: a developer should be
able to fetch any document version, resolve the collection schema *as
it was* at that point in time, and migrate it forward in memory. Phase
1 makes that possible by recording the data we'd need later — it does
not build the migration machinery itself.

## What Phase 1 shipped (record-only)

The scope deliberately stops at "record the version, stamp it on every
write." No storage/lifecycle code reads by version yet. The full
sequence of planned phases:

| Phase | Goal | Status |
|---|---|---|
| 1 | Record version + fingerprint on `collections`; stamp `collection_version` on every `documentVersions` row | **Shipped** |
| 2 | Historical config snapshots in a `collection_versions` table; FK from `document_versions` | Deferred |
| 3 | Fetch `CollectionDefinition` by `(collection_id, version)` from core/client API | Deferred |
| 4 | In-memory forward-migration from any historical shape to the current shape | Deferred |
| 5 | Optional strict-CI mode (require manual `version` bumps on any hash change) | Deferred |

### Data model (Phase 1)

Two additive changes, one migration (`0002_conscious_reptil.sql`):

```sql
ALTER TABLE collections
  ADD COLUMN version     integer NOT NULL DEFAULT 1,
  ADD COLUMN schema_hash varchar(64);           -- nullable in Phase 1

ALTER TABLE document_versions
  ADD COLUMN collection_version integer NOT NULL;
```

Hand-edited in the generated migration to make the NOT NULL addition
safe against a populated database:

```sql
ALTER TABLE document_versions ADD COLUMN collection_version integer;
UPDATE document_versions SET collection_version = 1
  WHERE collection_version IS NULL;
ALTER TABLE document_versions ALTER COLUMN collection_version SET NOT NULL;
```

Every pre-existing document implicitly belongs to version 1, which is
also the DB default for new collection rows. `schema_hash` stays
nullable until Phase 2 lands — the first `ensureCollections()` run
populates it, and we'll tighten to NOT NULL alongside the history
table. Both `current_documents` and `current_published_documents`
views now project `collection_version`.

### Code surface

| File | Role |
|---|---|
| `packages/core/src/storage/collection-fingerprint.ts` | Data-shape SHA-256 fingerprint |
| `packages/core/src/services/collection-bootstrap.ts` | `ensureCollections()` — reconcile at startup |
| `packages/core/src/core.ts` | `initBylineCore` is now `async`; exposes `collectionRecords` map + `getCollectionRecord(path)` |
| `packages/core/src/@types/collection-types.ts` | Optional `version?: number` on `CollectionDefinition` |
| `packages/core/src/@types/db-types.ts` | `ICollectionCommands.update(id, patch)`; `createDocumentVersion` now takes `collectionVersion` |
| `packages/db-postgres/src/database/schema/index.ts` | Columns + view projections |
| `packages/db-postgres/src/modules/storage/storage-commands.ts` | `collections.create/update`; `document_versions` insert writes `collection_version` |
| `packages/core/src/services/document-lifecycle.ts` | `DocumentLifecycleContext.collectionVersion` threaded to adapter |
| `packages/client/src/client.ts` | `resolveCollectionRecord()` caches `(id, version)` per path |
| `apps/webapp/src/lib/api-utils.ts` | Collapsed to a thin cache lookup over `bylineCore.getCollectionRecord` |
| `apps/webapp/byline.server.config.ts` | Top-level `await initBylineCore(...)` |

## Design decisions

### Fingerprint scope: data-shape only

The fingerprint defines what counts as a "schema change" for the purposes
of bumping the version. It is deliberately narrow — only properties that
affect the storable document shape participate. See
`packages/core/src/storage/collection-fingerprint.ts`.

Included (a change bumps the version):

- `path`
- `fields` — recursive. Per field: `name`, `type`, `optional`,
  `localized`. Structure fields recurse into `fields` / `blocks`.
  `relation.targetCollection`, `relation.displayField`, `select.options.value`,
  `datetime.mode`, `text`/`textArea`/`richText`/`float`/`integer`
  `validation`.
- `workflow` — status `name`s and `defaultStatus`. Labels and verbs are
  stripped.
- `upload` — `mimeTypes`, `maxFileSize`, and `sizes[].{name,width,height,fit,format,quality}`.
- `useAsTitle`, `useAsPath`.

Excluded (changes do NOT bump):

- `labels.singular`, `labels.plural`
- `hooks` (function values — can't be JSON-stable anyway)
- `search`, `showStats` (admin UX)
- Field-level `label`, `helpText`, `placeholder` (admin UX)
- Workflow status `label`, `verb`
- `upload.storage` (implementation-side provider)
- Select option `label`s

The stripping rules are enforced by whitelist (known keys are copied;
unknown keys are dropped) rather than blacklist, so adding a new
presentational field to `CollectionDefinition` will not silently churn
versions. Stability is covered by 19 contract tests in
`collection-fingerprint.test.node.ts` — key-order invariance, function
exclusion, every "does NOT bump" rule, and every "DOES bump" rule.

The choice of SHA-256 is deliberate over `simpleHash` (a 32-bit
Java-style hash already in `utils.general.ts`): collision resistance
matters because this hash is the tamper-evidence record for the lifetime
of the installation. 64 hex chars is cheap to store and compare.

SHA-256 is computed via `crypto.subtle.digest` (Web Crypto), not Node's
`node:crypto`. Web Crypto is available identically in Node 20+ and every
modern browser, so the fingerprint module stays free of Node built-ins.
Earlier iterations used `node:crypto.createHash` — that top-level import
got pulled into the client bundle by Vite's module-graph walk from
`@byline/core` (`core.ts` → `collection-bootstrap.ts` → fingerprint),
even though client code never calls `fingerprintCollection`. Externalised
`node:crypto` throws on access at runtime. Switching to Web Crypto
eliminated the issue without any conditional platform code; the
side-effect of the change is that `fingerprintCollection` is now
`async` (Web Crypto's `digest` is async on every platform).

### Version-bump policy: hash-driven auto-bump, with optional pin

`CollectionDefinition` gained an optional `version?: number`. Behaviour
(from `ensureCollections` / `reconcileCollection`):

1. Compute the fingerprint.
2. If no row exists: insert with `version = definition.version ?? 1`
   and the fingerprint.
3. If the row exists and the stored hash matches: no-op. This case is
   independent of any `definition.version` pin — the hash is the source
   of truth for "did the shape change?" and a no-op write would just add
   noise.
4. If the row exists and the hash differs:
   - `definition.version` pinned and `> stored.version` → use the pin.
   - `definition.version` pinned and `< stored.version` → throw. Pinning
     backwards is always a developer error (it silently desynchronises
     the version from document history).
   - `definition.version` pinned and `== stored.version` → use it;
     effectively a "yes, I know the shape changed but don't bump" pin.
   - `definition.version` omitted → auto-bump to `stored.version + 1`.
5. First-run-after-Phase-1 special case: when `stored_hash` is NULL
   (existing row pre-dating this feature), don't auto-bump. Treat it
   as "backfill the hash at whatever version the DB already holds."
   Without this, every collection would bump from v1 to v2 on the
   first boot after deploying Phase 1 for no information reason.

The hybrid — auto-bump as default, explicit pin as escape hatch — was
chosen over "explicit only" and "hash-only, no pin":

- **Explicit only** is easy to forget and produces silent drift. A dev
  adds a field, forgets to bump, and now `collection_version = 3` on
  a row that was actually authored against a different shape than v3.
- **Hash-only** is the cleanest API but blocks two real workflows:
  aligning version numbers across environments (e.g. so staging catches
  up to prod) and reserving a round number for a major change ahead of
  time.
- **Hybrid** keeps the common case zero-effort while allowing either
  escape. Even under a manual pin, the hash is still recorded — so
  Phase 2 can detect "the config on disk no longer matches the version
  we have written down." That is the reason `schema_hash` exists as a
  separate column rather than being implied by `version`.

A Phase-5 `strictCollectionVersions: true` flag could later invert the
default for CI, requiring explicit bumps when the hash changes. The
plumbing is already in place — it's only a policy knob.

### Boundary: what does NOT read by version yet

Storage and the document lifecycle **write** `collection_version` but
do not read by it. All reads still use the current `CollectionDefinition`
in memory. A document from `collection_version = 2` loaded against a
live v3 definition will reconstruct against v3's field set, exactly as
it does today. Phase 3 will introduce a historical-definition fetcher
(`getCollectionByVersion(collectionId, version)`), and Phase 4 will
wire it through the read path and the client SDK's populate walk so
that relation targets authored under older shapes can be materialised
correctly.

Until then, `collection_version` is recorded data without semantics
in the read path. That's the point of scoping Phase 1 to "record only"
— it lets the forward migration story arrive without a schema
migration when we get there.

## Startup reconciliation vs. lazy per-request

The previous prototype used a lazy `ensureCollection(path)` that ran on
every admin API request — cache miss → insert → cache hit → return.
Phase 1 moves reconciliation to startup (`initBylineCore()` calls
`ensureCollections()` once, caches the result on `BylineCore`). This
section addresses the question of whether that trade is correct at
typical installation sizes (10s of collections) and how it scales.

### The old lazy path was cheap because it did almost nothing

The prototype's `ensureCollection` had exactly one decision to make:
does a row exist for this path? If no, `INSERT`. The result was
cached per-process. There was no comparison, no fingerprinting, no
version logic — a cache-warming operation masquerading as
reconciliation. It felt "free" because the work was trivial.

Phase 1 changes the work. Reconciliation now involves:

- Fingerprinting the in-memory definition (a few microseconds, no I/O).
- Reading the stored row (one indexed SELECT on a ≤-50-row table).
- Comparing hashes.
- Possibly an UPDATE (bump path) or INSERT (first boot).
- Possibly throwing (backwards-pin error) before the process accepts
  traffic.

That last point is where the placement question stops being a pure
performance decision. The work now has *semantics* — decisions with
consequences — and where a semantic decision runs changes its failure
surface.

### Why startup is the right default

At 10–50 collections, the cost is a short burst of concurrent SELECTs
and (in steady state) zero writes. Concretely, in
`collection-bootstrap.ts` the loop is `Promise.all(...)` across all
definitions, so wall-clock time is ~one DB round-trip plus the
fingerprint cost (sub-millisecond), not N round-trips. For a local
Postgres that's ~5 ms total; for a managed-DB-across-a-VPC that's
~10–50 ms. It's paid once per process.

Lazy would push that same work onto the request path, with a handful
of non-performance downsides:

| Concern | Startup | Lazy (per-request, cached) |
|---|---|---|
| When a `version` pin error surfaces | Server refuses to start (loud, ops-visible) | First request to the offending route fails at runtime (scattered, user-visible) |
| When version-bump logs appear | All at boot, together, easy to grep | Scattered across the day's request logs |
| When an unreachable DB blocks you | Boot | First request per collection |
| First-request latency | Normal | Adds 1–2 round-trips on cold collection paths |
| State predictability for ops | "Everything reconciled by the time the server is up" | "Each collection reconciles when someone first hits it" |
| Consistency under parallel cold-starts | Single synchronous phase, no races | Two simultaneous first-requests to the same collection can both try to insert/update — needs locking or uniqueness-retry |

The last row matters under load. Lazy reconciliation inside a request
handler has a lost-update window where two concurrent first-requests
both compute the same hash, both see "no match," and both try to
bump. Depending on the adapter, you get either a duplicate-key error
or a double-bump. Startup reconciliation runs once, before any request,
and avoids the class entirely.

In short, the lazy approach is defensible only if the work is
genuinely trivial. Once it has semantics, startup is the right home.

### Where lazy (or a hybrid) would actually win

There are configurations that would flip the trade:

1. **Serverless / edge / short-lived processes.** Every cold start
   pays startup cost. For 20 collections at ~50 ms total that's
   significant against a ~100 ms invocation budget. Byline's current
   deploy target is a long-running Node process, so this doesn't
   apply — but a future Cloudflare Workers or AWS Lambda target
   would need to revisit.
2. **Hundreds or thousands of collections in a multi-tenant
   installation.** At 500+ collections, even concurrent SELECTs get
   uncomfortable. Two better options emerge there:
   - Lazy DB reconciliation, but still do synchronous *in-memory*
     fingerprinting at startup. That catches definition-authoring
     errors (fail-fast) without hitting the DB for unused schemas.
     First use of each collection pays one reconcile; subsequent uses
     are free.
   - A lightweight "any definitions changed since last boot?" check
     — compare an in-memory aggregate hash against one stored in a
     singleton row. Reconcile individually only on a mismatch.
3. **Reconciliation starts doing expensive work.** If Phase 2's
   history-table writes get large enough that bumping 20 collections
   on a redeploy is painful, we'd want selective or deferred
   reconciliation. This is speculative — Phase 2 writes will still be
   "one INSERT per changed collection."

None of those apply today. The current `ensureCollections` is the
right shape for the current deployment model. The Phase-1 code is
structured so that dropping in a lazy or hybrid strategy later is a
localised change — the `collectionRecords` map stays the contract, and
only the population strategy moves.

### Fail-fast by default

A concrete benefit worth pulling out: startup reconciliation means a
backwards `version` pin, a duplicate collection path, or an adapter
mis-configuration fails the process before it accepts traffic.
Operators find out during deploy, not during the first affected
request. For a CMS where the blast radius of a silent schema
desync is "every document written during the window is mis-stamped,"
that's the correct trade even before considering performance.

## Known limitations and open questions

- **`schema_hash` is still nullable.** It tightens to NOT NULL when
  the `collection_versions` history table lands in Phase 2. The code
  invariant today is that rows written post-`ensureCollections()`
  always have a hash — only rows that exist *before* the first Phase-1
  boot can legitimately carry NULL.
- **No composite FK from `document_versions` to a `(collection_id,
  version)` pair.** There is no table to anchor against until Phase 2.
  The integer column records the version; adding the FK is trivial once
  the history table exists.
- **Bootstrap is fail-fast, not fail-partial.** If one of N collections
  throws (e.g. a backwards pin), `Promise.all` rejects on the first
  failure and the server refuses to start. Other in-flight
  reconciliations may have already written to the DB. This is
  intentional — a partially-reconciled startup is worse than no
  startup — but worth knowing.
- **The webapp's `ensureCollection` shim is still in place.** It is
  now a thin cache lookup over `bylineCore.getCollectionRecord`, not
  DB I/O. Callers could move directly to the core accessor; leaving
  the shim avoids churn in the admin route layer ahead of the deferred
  stable HTTP boundary (see
  [ROUTING-API-ANALYSIS.md](./ROUTING-API-ANALYSIS.md)).
- **`initBylineCore` is async.** The webapp uses top-level await in
  `byline.server.config.ts`, which TanStack Start / Vite support
  natively. Scripts that import the config for side effects (seeds,
  one-offs) inherit the wait via ESM module evaluation. A future
  non-Vite consumer would need to await explicitly.

## Next

Phase 2 is the smallest useful follow-up: a `collection_versions`
history table that snapshots `{collection_id, version, config,
schema_hash, created_at}` on every bump. Once that exists, Phase 3
adds `getCollectionByVersion(collection_id, version)` to
`ICollectionQueries`, Phase 4 threads it through the read path and
`@byline/client`, and Phase 5 decides whether strict-CI mode should
ship as a default.
