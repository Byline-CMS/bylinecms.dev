---
title: "Extraction, retrieval and agent-access track — roadmap"
path: "extraction-retrieval-track-roadmap"
summary: "Break the upstream Byline work behind a downstream research library's extraction, retrieval and agent-access phases into independently releasable phases, tasks and review checkpoints."
---

# Extraction, retrieval and agent-access track — roadmap

Companions:

- [MCP server specification](./2026-10-10-mcp-server-spec.md) and [plan](./2026-10-10-mcp-server-plan.md) — Phase 2 implements their phase 1.
- [Search overview](../docs/06-search/index.md) — Phases 3 and 4 extend the search contract.
- [Recurring tasks](../docs/11-scheduling/01-recurring-tasks.md) — Phase 5 builds on the scheduler.

## Purpose and ground rules

A downstream research library is evaluating extraction and retrieval against a real corpus. Byline provides shared contracts and SQL providers. The host owns its collection policy and pilot evaluation.

This roadmap is the durable task list for the Byline side of that work. It
exists because the work spans several sessions. Tick tasks as they land, and
record the commit beside each one.

Rules that apply to every phase:

- **Spec before code.** Each phase produces a dated `-spec.md` and `-plan.md`
  pair under `specs/` in the shape of the MCP pair. No implementation starts
  until Tony accepts that phase's spec.
- **Independently releasable.** Each phase ships on its own and does not
  depend on a later phase.
- **Planning order (23 November 2026).** Review MCP and the other transports before starting the [storage benchmark refresh](../benchmarks/storage/README.md#next-benchmark-and-read-path-review). Decide which caller and operations the first pilot should support, what can reuse the in-process SDK, and when delegated access is needed. Record the outcome in the [MCP plan](./2026-10-10-mcp-server-plan.md). The review can finish before any transport is implemented.
- **Search design can proceed during the downstream pilot delay.** PostgreSQL and MySQL can exercise filters, authorized facet counts, locale behavior and index-update ordering on shared fixtures. Pilot results will inform the extraction store, reference drivers and page-map guarantees in [#109](https://github.com/Byline-CMS/bylinecms.dev/issues/109). The jobs pattern follows search. The MCP implementation sequence remains open for the transport review.
- **Two-agent review.** Each phase runs as one coordinated run (`/coordinate`).
  Claude Code implements, and a second agent reviews at the plan's checkpoints.
  Approval names a snapshot. Commits happen only when Tony asks.
- **Checks at every checkpoint:** `pnpm exec biome check .`, `pnpm typecheck`,
  `pnpm test`, and where storage or search is touched, the integration and
  conformance suites against both PostgreSQL and MySQL.
- **Close-out for every phase:** reconciled GitHub issues with updated
  acceptance criteria, a changeset, docs under `docs/`, and a short adoption
  note for the downstream installation.
- **Confidentiality.** Do not name the downstream installation or its domain in
  this repository. Describe it as "a downstream research library".

## Status at a glance

| Phase | Issues | Status |
|---|---|---|
| 0 — Anthropic structured outputs | #104 | **Done** — `9eeac5ec`, issue closed |
| 1 — Stored-file content identity | #85 (#72 only where hashing touches it) | **Done** — released in v6.12.0, #85 closed; receipts follow in #108 |
| 4 — Extraction contracts in core | #5 | **Released in v6.13.0** — spec revision 4 and decisions 1–12 accepted; all stages approved in run `2026-11-04-extraction-contracts`; merged into `develop` at `3223e697`; release and adoption evidence recorded in [#5](https://github.com/Byline-CMS/bylinecms.dev/issues/5) |
| 3 — Search `where`, facets and locale discovery | #6, #81, #76 | Ready for specification and conformance design |
| 5 — Jobs-table pattern on the scheduler | new issue | Not started — after search |
| 2 — Native MCP server, read-only phase 1 | #12 | Strategy review next, before benchmarking. Implementation order to be decided |

## Phase 0 — Anthropic structured outputs (#104) — done

- [x] Replace the forced `tool_choice` with `output_config.format` in the four
      document generate and patch paths; make refusal, truncation and missing
      JSON explicit errors; refresh the curated models; make live tests run. —
      `9eeac5ec`
- [x] Released in v6.12.0.

## Phase 1 — Stored-file content identity (#85)

Goal: `StoredFileValue.fileHash` is a real SHA-256 content digest on every
ordinary upload, with a separate storage validator and an optional storage
read primitive, so the downstream installation can drop its host-side hashing
bridge.

Decisions the spec must settle (Tony decides; the spec recommends):

- Whether the hash covers the bytes as received or as stored after any
  transform. Today the original is stored as received and image variants are
  separate objects, so "hash of the stored original" and "hash of the received
  bytes" coincide; the spec must say which one the JSDoc promises if a future
  transform changes that.
- The storage validator shape `{ kind, value }`, its persistence column on
  `store_file` in both adapters, and the statement that it is never compared
  with the hash.
- `download?` versus `getStream?`, the `head?` result shape, and what callers
  do when a provider lacks them.
- **Bytes and validator must be bound together.** An object can be replaced
  between a `head` call and a `download` call, so a separate `head` cannot tell
  a caller which version it read. The read primitive must return the validator
  (or version) of the exact bytes it streams — for example the S3 `GetObject`
  ETag or version id, or the local file's identity taken from the open file
  handle — and a hash recorded against a validator must never be paired with
  bytes from a different version. `head` stays a cheap change probe, not a
  provenance source.
- Backfill: where it runs (CLI command, script or client method), batching,
  idempotence, and the legacy-null policy for unreachable objects.
- Whether variants also get hashes (likely out of scope; record the decision).

Tasks:

- [x] 1.1 Write `specs/2026-10-31-stored-file-identity-spec.md` and `-plan.md`;
      reconcile #85 acceptance criteria. **Checkpoint 1** (with this roadmap) —
      approved at snapshot `61a9a60`; spec accepted with decisions 1–7.
- [x] 1.2 Core: types and JSDoc (`fileHash`, `storageValidator`, no empty
      string), streaming SHA-256 in `services/field-upload.ts` without a second
      read, `IStorageProvider.download?` / `head?` contracts.
- [x] 1.3 Providers: `download` and `head` in `storage-local` and `storage-s3`;
      `upload` returns the validator.
- [x] 1.4 Storage provider conformance: changed bytes at the same path give a
      new hash and validator; unchanged bytes give the same hash; a provider
      without `head` degrades as documented. **Checkpoint 2.**
- [x] 1.5 Persistence: `storage_validator` on `store_file` in PostgreSQL and
      MySQL (Drizzle schema, development migrations, flatten and restore,
      `db-*/sql/` upgrade script entry).
- [x] 1.6 Idempotent backfill with the legacy-null policy; integration tests on
      both databases. **Checkpoint 3.**
- [x] 1.7 Documentation, changeset and adoption note shipped. [#108](https://github.com/Byline-CMS/bylinecms.dev/issues/108) tracks server-issued upload receipts separately.

## Phase 2 — Native MCP server, read-only phase 1 (#12)

Goal: the existing plan's Stages 1 and 2 (its phase 1). Access checks live
inside each tool, and every result carries canonical document and version
identifiers that a client can cite. Attachment extraction, structured filters
and exact paging are not prerequisites.

Scope correction (confirmed by the brief's author, 2026-10-31): Stages 1–2
deliver a **development proof and read transport**, not production delegated
authentication. The existing plan gates production delegated authentication on
Stages 3–4 (see its Stage 2 checkpoint). Phase 2's acceptance criteria
therefore stop at a development-only authorization path; the downstream
installation must not expose the read surface in production until Stages 3–4
land. Those stages are a later phase of this track.

Tasks:

- [ ] 2.1 Spec and plan addendum against the 6.11 baseline: citation
      identifiers in outputs, tool-internal access checks, and acceptance
      criteria limited to the development proof per the correction above;
      reconcile #12. **Checkpoint 1.**
- [ ] 2.2 Stage 1 compatibility proof: MCP SDK and authorization-server
      selection, a desktop client run, two-instance stateless HTTP. Needs Tony
      for the desktop client. **Checkpoint 2.**
- [ ] 2.3 Stage 2 packages: `@byline/operations` and `@byline/mcp` skeletons,
      operation contract, descriptors.
- [ ] 2.4 Read tools `list_collections`, `describe_collection`,
      `query_documents`, `get_document` with `beforeRead` scoping and
      collection abilities applied inside each tool. **Checkpoint 3.**
- [ ] 2.5 Host request handler, limits, error mapping, provenance labelling;
      docs, changeset, adoption note. **Checkpoint 4.**

## Phase 3 — Search `where`, facets and locale discovery (#6, #81, #76)

Goal: filters applied inside the query (publication, format, topic, year
range, locale, access scope), facet aggregation on declared facet fields, and
a decided contract for source-locale discovery and cross-locale duplicate
suppression.

Tasks:

- [ ] 3.1 Spec and plan: portable `where` on declared filter fields, facet
      aggregation extending the 6.10.0 integer range facets, one capability per
      new behaviour, authorised (non-leaking) facet counts under `beforeRead`,
      and the #81 and #76 contracts. Reconcile all three issues.
      **Checkpoint 1.**
- [ ] 3.2 Core types in `search-types.ts`; `@byline/client` forwarding and
      validation (closes the "search `where` unvalidated" follow-up from
      6.10.1).
- [ ] 3.2a Specify how providers reject a stale write, handle an equal-revision retry and confirm that an acknowledged update is searchable. Cover a delayed delete as well as a delayed upsert.
- [ ] 3.3 `search-postgres` implementation.
- [ ] 3.4 `search-mysql` implementation.
- [ ] 3.5 Run shared conformance cases against both SQL providers for supported filters, facets under row scoping, stale writes and visibility checks. **Checkpoint 2.**
- [ ] 3.6 Locale discovery and result-scope separation in at least one
      built-in provider, with the other provider declaring the capability
      honestly. **Checkpoint 3.**
- [ ] 3.7 Docs, changeset, adoption note. **Checkpoint 4.**

Optional follow-ups after write protection and visibility checks are portable include returned hit fields, string `$in` (including large lists) and filtering by document ID. They do not gate the next phase.

## Phase 4 — Extraction contracts in core (#5) — shipped in 6.13.0

Goal: move the provider-neutral extraction contracts the downstream prototype
keeps in its own extractor package into `@byline/core`, beside
`search-types.ts`, marked provisional and schema-versioned; ship the generic
source-verification guarantees around them; and specify the lifecycle
(saved, derived and projected outcomes, retention versus eligibility,
promotion fencing, legacy migration) without implementing the store, worker
or admin surfaces. Spec: `2026-10-31-extraction-contracts-spec.md`; plan:
`2026-10-31-extraction-contracts-plan.md`.

Tasks:

- [x] 4.1 Spec and plan, reconciled with the downstream identity and
      lifecycle policy (revision 8) and the second-pass review; reconcile #5.
      **Checkpoint 1** — revision 3 accepted by Tony, 2026-10-31. Revision 4
      (historical producer reuse, evidence refresh, guard and fixture rules)
      accepted 2026-11-04.
- [x] 4.2 Provider types, typed failures, artifact and page map v1 with
      structural validators, producer hash, evidence validator and work
      decision (plan Stage 1, checkpoint 2); verified source read and probe
      with storage conformance (plan Stage 2, checkpoint 3).
- [x] 4.3 Publishable provider conformance kit, released in 6.13.0, with sentinel page-map
      verification and dishonest-fake self-tests. Structural page-map
      validity is not provenance; only sentinels are (plan Stage 3,
      checkpoint 4).
- [x] 4.4 Docs, changeset, issue updates, adoption note (plan Stage 4,
      checkpoint 5).

## Phase 5 — Jobs-table pattern on the scheduler

Goal: documentation, and where useful a small helper in
`@byline/core/scheduler`, for per-item background work driven by a sweep. This
is not a queue subsystem.

Tasks:

- [ ] 5.1 Open an issue; spec and plan covering states
      (`queued | running | parked | done | discarded`), `FOR UPDATE SKIP
      LOCKED` claiming, per-job lease and heartbeat, bounded attempts, and the
      stale-result precondition before a promoting write. The task handler's
      context does not expose the scheduler's lease token today (verify against
      the code), so the spec must choose between independently owned job claims
      (each job carries its own claim token and lease) and an explicit API
      addition that exposes the task token. Either way, every promoting write is
      fenced. **Checkpoint 1.**
- [ ] 5.2 Optional helper with integration tests on both databases.
      **Checkpoint 2.**
- [ ] 5.3 `docs/11-scheduling/` page, changeset, adoption note.
      **Checkpoint 3.**

## Not in this track

- #14 (admin route splat resolver): land it the next time Byline itself adds
  an admin area; the downstream installation uses a host-owned route file.
- #72 (media retention): only where it touches hashing in Phase 1.

## Session log

| Date | Work | Commits |
|---|---|---|
| 2026-10-31 | Phase 0 fixed and #104 closed; roadmap written; Phase 1 coordinated run started; brief author's corrections folded in (MCP scope, page-map provenance, scheduler token, bytes-validator binding) | `9eeac5ec` |
| 2026-10-31 | Phase 1 implemented (Stages 1–4): content hash and validator, bound reads, atomic local writes, storage conformance (live against RustFS locally; CI skipped it until the 2026-11-04 correction), validator columns, Postgres `variants` fix, backfill/verify; checkpoints 1–3 approved | `b858dc15`, `242346ca`, `f9f8374b`, `1271c7fb` |
| 2026-10-31 | Release squash, `drizzle:rekey` helper, v6.12.0 released; #85 closed, #108 opened. Phase order changed: extraction contracts next, MCP last. Downstream adoption of 6.12.0 completed first | `96e3d1aa`, `00e08b10`, `59be4cae`, `e3075ca9` |
| 2026-10-31 | Phase 4 spec and plan drafted against the downstream identity and lifecycle policy; three manual review rounds; revision 3 and decisions 1–8 accepted; plan made self-contained for handover. Next: Stage 1 in a new session | `9cb74b02` |
| 2026-11-04 | Readiness review against the downstream plan and open issues found no prerequisite. Decisions 9–12 and spec revision 4 accepted; coordinated run restarted on v6.12.1. Plan Stages 1–3 implemented and approved, with live S3 and real-Tika runs; Stage 4 documentation drafted | `8c885889`, `acdde3e4`, `8498333c`, `5ae6b481`, `3223e697` |
| 2026-11-04 | Correction: live S3 conformance had never run in CI. Turbo's strict environment mode withheld `BYLINE_S3_TEST_*`, so all eight CI runs that reached the S3 tests since 2026-10-31 skipped the suite while its unit tests ran. Added a `@byline/storage-s3#test` task that forwards the variables and disables caching | this entry's commit |
| 2026-11-23 | Reconciled the 6.13.0 release and downstream adoption. Search design can proceed. Review MCP and transports before the benchmark refresh. | [#5 close-out](https://github.com/Byline-CMS/bylinecms.dev/issues/5) |
