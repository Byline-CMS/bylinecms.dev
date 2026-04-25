# Phases of Work — Strategic Roadmap

> Last updated: 2026-04-25 (auth phase in flight — most plumbing shipped, service-layer enforcement remains)
> Companion to [STORAGE-ANALYSIS.md](./STORAGE-ANALYSIS.md),
> [RELATIONSHIPS-ANALYSIS.md](./RELATIONSHIPS-ANALYSIS.md),
> [ROUTING-API-ANALYSIS.md](./ROUTING-API-ANALYSIS.md),
> [CLIENT-IN-PROCESS-SDK-ANALYSIS.md](./CLIENT-IN-PROCESS-SDK-ANALYSIS.md), and
> [AUTHN-AUTHZ-ANALYSIS.md](./AUTHN-AUTHZ-ANALYSIS.md).

This document captures the recommended sequencing of work across the
project as of April 2026. It is intentionally a living document —
priorities shift as phases land, benchmarks return numbers, and real
external clients arrive.

AuthN / AuthZ (item 1) is currently in flight — Phases 0–3 and 5–6 of
the auth plan have shipped between 2026-04-18 and 2026-04-25; Phase 4
(service-layer enforcement), Phase 7 (`beforeRead` + query filtering),
and the bulk of Phase 8 (inspector views) remain outstanding. See the
**Phase status** table at the top of [AUTHN-AUTHZ-ANALYSIS.md](./AUTHN-AUTHZ-ANALYSIS.md)
for the full breakdown.

---

## ~~1. Client API Phase 4 — write path~~ — shipped 2026-04-18

`CollectionHandle.create` / `update` / `delete` / `changeStatus` /
`unpublish` landed as thin shims over `document-lifecycle`, with the
`BylineClient` resolving a `BylineLogger` in priority order (explicit
config → `getLogger()` → silent no-op) so migration scripts and
seeders don't need to call `initBylineCore()`. 11 unit + 11
integration tests. No storage-layer changes. Patches remain
admin-internal; public writes are whole-document.

---

## ~~1. Status-aware reads~~ — shipped 2026-04-18

`status?: 'published' | 'any'` on `FindOptions` / `FindOneOptions` /
`FindByIdOptions` / `FindByPathOptions`, defaulting to `'published'`
in-client. Threaded through `populateDocuments` as `readMode` so
populated relation targets follow the same rule. Backed by a new
`current_published_documents` Postgres view that applies
`ROW_NUMBER() PARTITION BY document_id` after filtering to
`status = 'published'` — so draft-over-published documents keep
returning the published content (v1) until the draft (v2) is itself
published, matching the user mental model. Admin continues to pass
through the adapter default of `'any'`. 10 unit + 7 integration tests;
one migration (`0001_demonic_joseph.sql`).

---

## ~~1. Benchmark the UNION ALL at scale~~ — done 2026-04-18

Sweep at 1k / 10k / 50k / 100k on M1 Pro. Full results at
[`benchmarks/storage/results/2026-04-18-storage-cold-summary.md`](../../benchmarks/storage/results/2026-04-18-storage-cold-summary.md).
Single-doc reads hold at ~3 ms full reconstruct across all scales;
populate batch fetches stay flat at ~7 ms for 50-doc batches. The
JSONB read-cache follow-on is **closed as not needed** — it would
be trying to optimise a query that already takes 3 ms. The only
query type that scales with N is the list view (`findDocuments`,
driven by the `current_documents` window function, not the UNION
ALL). List-view materialisation remains on the shelf as a deferred
idea for the day a real workload at 100k+ demands it.

---

## ~~1. `afterRead` hook~~ — shipped 2026-04-18

`CollectionHooks.afterRead` fires once per materialised document on
every `@byline/client` read path and once per populated relation
target. The hook receives a mutable raw-shape `doc`, the collection
path, and the shared `ReadContext`. Mutations to `doc.fields`
propagate into the shaped response; hooks performing nested reads
thread `readContext` back in via `{ _readContext }` on the client
read options. `ReadContext` grew an `afterReadFired` set so each
document runs through `afterRead` at most once per logical request —
the A→B→A guard. Unlocks both future tracks that were blocked on
it: access-control mask-on-read and richtext Mode 2 hydration.

---

## 1. AuthN / AuthZ — in flight

**Status.** Phases 0–6 of the auth plan have shipped between
2026-04-18 and 2026-04-25, including service-layer enforcement
(Phase 4) on the write path (`document-lifecycle.*`,
`document-upload`), on the public client read path
(`@byline/client` `CollectionHandle`), and on the admin webapp's
collection server fns. The outstanding auth tracks are now Phase 7
(`beforeRead` hook + query-level filtering — read-side row-scoping)
and the bulk of Phase 8 (registered-collections / who-has-what
inspector views — the role-ability editor is the only Phase 8 piece
in place).

**Scope.** Admin authentication and authorization as a first-class
subsystem. New `@byline/auth` package; `admin_users` /
`admin_roles` / `admin_permissions` schema; ability registry with
auto-registration from collections; `SessionProvider` interface
with a built-in JWT implementation; `RequestContext`-based actor
threading; enforcement at the `document-lifecycle` /
`IDocumentQueries` service boundary; admin UI for sign-in, users,
roles, and role-ability editor. Full strategic rationale and an
eight-phase implementation plan live in
**[AUTHN-AUTHZ-ANALYSIS.md](./AUTHN-AUTHZ-ANALYSIS.md)** along with
the per-phase status table.

**Why this slot.** Byline today has no authentication and no
authorization — every admin server function is effectively open.
This is the biggest structural gap between the current prototype
and anything that can be deployed responsibly, and it is a
prerequisite for the `packages/ui` extraction (which benefits from
having a stable actor / context model to thread through the
extracted components).

**Subsumes.** What was previously item 3 ("access control
(read-side)") is folded in as Phase 7 of the auth plan
(`beforeRead` hook + query-level filtering).

---

## 2. `hasMany` relations

**Scope.** Multi-target relation fields. Needs:
- new `hasMany: true` prop on `RelationField`,
- multi-select picker UX (add / remove / reorder),
- array-of-object Zod shape,
- array populate output,
- tests.

**Why this slot.** Commonly requested, well-scoped in
[RELATIONSHIPS-ANALYSIS § "Deferred"](./RELATIONSHIPS-ANALYSIS.md), and
a good user-visible feature once earlier items land. Not blocking; not
load-bearing for any earlier item. Can interleave with the auth
phases if priorities shift.

---

## 3. Richtext document links

**Scope.** Lexical `DocumentLinkNode`, toolbar plugin reusing the
existing `RelationPicker`, save-time vs read-time hydration modes,
configurable field projection, shared `ReadContext` for recursion
safety.

**Why this slot.** Larger track. `afterRead` has now shipped so Mode 2
hydration is unblocked — but this still sits behind `hasMany`
priority-wise (smaller unit, more commonly requested). Designed in
detail in [RELATIONSHIPS-ANALYSIS § "Future work: rich-text document
links"](./RELATIONSHIPS-ANALYSIS.md).

---

## 4. Stable HTTP transport — explicitly NOT next

The trigger for a stable/public HTTP API is **not** "the client SDK
gained more methods." It is **the first real client that cannot
safely or practically use direct adapters and core services
in-process** (mobile app, desktop app, separate frontend deployment,
external integration, hosted remote Byline service).

Until that arrives, hold the line per
[ROUTING-API-ANALYSIS](./ROUTING-API-ANALYSIS.md) and
[CLIENT-IN-PROCESS-SDK-ANALYSIS](./CLIENT-IN-PROCESS-SDK-ANALYSIS.md):

- TanStack Start server functions remain the internal transport for
  the admin UI.
- `@byline/client` continues to evolve as an in-process SDK without
  dragging a public surface along behind it.
- When the trigger fires, design the HTTP boundary across the full
  surface area — uploads, reads, list/find, create/update/delete,
  status, history, auth — not one operation at a time.

---

## Sequencing notes

- **Item 1 (auth)** is in flight; service-layer enforcement (Phase
  4) closed out 2026-04-25. Read-side row-scoping (Phase 7) and the
  remaining inspector views (Phase 8) are the outstanding auth
  pieces.
- **Pull admin *document* reads through `CollectionHandle` —
  deferred follow-up to Phase 7.** This refers specifically to the
  admin webapp's reads of CMS documents — the four server fns
  under `apps/webapp/src/modules/admin/collections/*` (`list`,
  `get`, `history`, `stats`). It is **not** about admin-user /
  admin-role / admin-permission management, which is enforced
  separately through `assertAdminActor` inside every `*Command`.

  Phase 4 closed those four document-read fns by adding direct
  `assertActorCanPerform` calls. That works, but it skips the rest
  of the `CollectionHandle` read pipeline: `populateDocuments` is
  invoked by hand, `afterRead` is never fired on admin document
  reads, and any future read concern (mask-on-read, redaction,
  audit logging) has to be wired in twice. Migrating to
  `bylineClient.collection(path).find(...)` / `findById(...)` etc.
  is the clean fix; defer until alongside or immediately after
  Phase 7, which forces the admin document-read path to use the
  same predicate compiler the client uses anyway. Full rationale
  in [AUTHN-AUTHZ-ANALYSIS § "Explicitly deferred"](./AUTHN-AUTHZ-ANALYSIS.md#explicitly-deferred-not-in-this-plan).
- **Item 4 (HTTP transport) stays deferred** regardless of progress
  on items 1–3 unless an external-client trigger fires. Whenever it
  does fire, it will inherit the `RequestContext` / `Actor`
  contract established by item 1.
- **`packages/ui` extraction** (not listed above as a standalone
  item) is the logical phase *after* auth — extracting
  `apps/webapp/src/ui/fields` and `ui/forms` is cleaner once the
  actor/context model is stable.

## Progress log

| Date | Change |
|------|--------|
| 2026-04-18 | Initial roadmap captured from strategic review. |
| 2026-04-18 | Phase 4 (client-API write path) shipped. Renumbered remaining items; status-aware reads promoted to item 1. |
| 2026-04-18 | Phase 5 (status-aware reads) shipped. Item list renumbered; benchmark promoted to item 1. |
| 2026-04-18 | Storage benchmark sweep run and published; "consider a read cache" item closed. Items renumbered; `afterRead` promoted to item 1. |
| 2026-04-18 | `afterRead` hook shipped. Items renumbered; `hasMany` promoted to item 1; added access-control track as a newly unblocked (but unscoped) item 3. |
| 2026-04-23 | AuthN / AuthZ promoted to item 1 with a full phased plan in [AUTHN-AUTHZ-ANALYSIS.md](./AUTHN-AUTHZ-ANALYSIS.md). Previous item 3 (access control) folded in as Phase 7 of the auth plan. `hasMany` and richtext document links shifted to items 2 and 3. |
| 2026-04-25 | Auth Phases 0–3 and 5–6 shipped over the past week (actor primitives, ability registry, admin schema + services + seed, JWT session provider, server-fn middleware, admin UI). Phases 4 (service-layer enforcement) and 7–8 (`beforeRead` + inspector views) remain. Item 1 promoted from "active next" to "in flight". |
| 2026-04-25 | Phase 4 closed out for the document-collection realm: most of service-layer enforcement was already shipped on the write path and on `@byline/client`; this pass added the four missing read assertions on the admin webapp's *document-collection* server fns (`list`, `get`, `history`, `stats`). The admin user/role/permission management area was already enforced via `assertAdminActor` inside every `*Command` and is unchanged. Phase 7 (`beforeRead`) and Phase 8 inspector views remain. |
