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

A downstream institutional installation — a bilingual Thai/English research
library of about 285 publications and 345 attachments — is starting attachment
extraction, then hybrid retrieval and a cited research assistant. It builds
host-side first and upstreams generic infrastructure afterwards: generic CMS
infrastructure goes to Byline core, and collection-domain work stays in the host.

This roadmap is the durable task list for the Byline side of that work. It
exists because the work spans several sessions. Tick tasks as they land, and
record the commit beside each one.

Rules that apply to every phase:

- **Spec before code.** Each phase produces a dated `-spec.md` and `-plan.md`
  pair under `specs/` in the shape of the MCP pair. No implementation starts
  until Tony accepts that phase's spec.
- **Independently releasable.** Each phase ships on its own and does not
  depend on a later phase.
- **Order (Tony, 2026-10-31).** Phase 4 (extraction contracts) next, then
  Phase 3 (search), Phase 5 (jobs), Phase 6 (embargo), and Phase 2 (MCP)
  last. The phase numbers are kept so earlier references stay valid.
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
| 4 — Extraction contracts in core | #5 | **In progress** — spec revision 3 and all eight decisions accepted 2026-10-31 |
| 3 — Search `where`, facets and locale discovery | #6, #81, #76 | Not started — second |
| 5 — Jobs-table pattern on the scheduler | new issue | Not started — third |
| 6 — Embargo as an access state (spec only) | new issue | Not started — fourth |
| 2 — Native MCP server, read-only phase 1 | #12 | Not started — last |

## Phase 0 — Anthropic structured outputs (#104) — done

- [x] Replace the forced `tool_choice` with `output_config.format` in the four
      document generate and patch paths; make refusal, truncation and missing
      JSON explicit errors; refresh the curated models; make live tests run. —
      `9eeac5ec`
- [ ] Release in the next `@byline/ai` patch (changeset
      `anthropic-structured-outputs.md` is staged in the commit).

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
- [x] 1.7 Docs, changeset, downstream adoption note (issue #85 update and the
      upload-receipts issue drafted, awaiting Tony's go-ahead to post). **Checkpoint 4.**

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
- [ ] 3.2a String-typed filter fields with `$in`, including a large-list
      form for allow-lists of thousands of keys, and `where` on document id;
      portable across both built-in providers, each behind a capability.
      Needed by the durable exclusion level in the extraction spec §8.2.
- [ ] 3.2b `SearchQuery.returnFields` (declared filter fields only) and
      `SearchHit.fields`, behind a `returnFields` capability, forwarded
      unchanged through `@byline/client` hydration.
- [ ] 3.2c Stale-write prevention on upsert: an optional `expectedVersion`
      (or provider-native optimistic token) raising a typed stale-write
      error when superseded, an explicit commit where the provider needs it,
      and an existence probe, so a host can tell acknowledgement from
      searchable visibility.
- [ ] 3.3 `search-postgres` implementation.
- [ ] 3.4 `search-mysql` implementation.
- [ ] 3.5 `search-conformance` suites for filters (including string `$in`,
      the large-list form and document id), facets, `returnFields`,
      stale-write refusal and the existence probe, and capabilities, run
      against both databases. **Checkpoint 2.**
- [ ] 3.6 Locale discovery and result-scope separation in at least one
      built-in provider, with the other provider declaring the capability
      honestly. **Checkpoint 3.**
- [ ] 3.7 Docs, changeset, adoption note. **Checkpoint 4.**

## Phase 4 — Extraction contracts in core (#5) — next

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
      **Checkpoint 1** — revision 3 accepted by Tony, 2026-10-31.
- [ ] 4.2 Provider types, typed failures, artifact and page map v1 with
      structural validators, producer hash, evidence validator and work
      decision (plan Stage 1, checkpoint 2); verified source read and probe
      with storage conformance (plan Stage 2, checkpoint 3).
- [ ] 4.3 Published provider conformance kit with sentinel page-map
      verification and dishonest-fake self-tests. Structural page-map
      validity is not provenance; only sentinels are (plan Stage 3,
      checkpoint 4).
- [ ] 4.4 Docs, changeset, issue updates, adoption note (plan Stage 4,
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

## Phase 6 — Embargo as a first-class access state (spec only)

- [ ] 6.1 Open an issue; spec covering declaration (field-level flag versus
      workflow status), enforcement at read, index, prune and derivation
      boundaries, prune-on-restrict and periodic reconciliation, and public
      storage locations (private location or signed URLs). Write it so the
      downstream per-file flag can converge on it once the installation reports
      what it learned. **Checkpoint 1.**

## Not in this track

- #14 (admin route splat resolver): land it the next time Byline itself adds
  an admin area; the downstream installation uses a host-owned route file.
- #72 (media retention): only where it touches hashing in Phase 1.

## Session log

| Date | Work | Commits |
|---|---|---|
| 2026-10-31 | Phase 0 fixed and #104 closed; roadmap written; Phase 1 coordinated run started; brief author's corrections folded in (MCP scope, page-map provenance, scheduler token, bytes-validator binding) | `9eeac5ec` |
| 2026-10-31 | Phase 1 implemented (Stages 1–4): content hash and validator, bound reads, atomic local writes, storage conformance (RustFS in CI), validator columns, Postgres `variants` fix, backfill/verify; checkpoints 1–3 approved | `b858dc15`, `242346ca`, `f9f8374b`, `1271c7fb` |
| 2026-10-31 | Release squash, `drizzle:rekey` helper, v6.12.0 released; #85 closed, #108 opened. Phase order changed: extraction contracts next, MCP last. Downstream adoption of 6.12.0 completed first | `96e3d1aa`, `00e08b10`, `59be4cae`, `e3075ca9` |
| 2026-10-31 | Phase 4 spec and plan drafted against the downstream identity and lifecycle policy; three manual review rounds; revision 3 and decisions 1–8 accepted; plan made self-contained for handover. Next: Stage 1 in a new session | uncommitted |
