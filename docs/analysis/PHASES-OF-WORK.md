# Phases of Work — Strategic Roadmap

> Last updated: 2026-04-27 (richtext link + inline image plugins shipped — `hasMany` is the only outstanding feature item)
> Companion to [STORAGE-ANALYSIS.md](./STORAGE-ANALYSIS.md),
> [RELATIONSHIPS-ANALYSIS.md](./RELATIONSHIPS-ANALYSIS.md),
> [ROUTING-API-ANALYSIS.md](./ROUTING-API-ANALYSIS.md),
> [CLIENT-IN-PROCESS-SDK-ANALYSIS.md](./CLIENT-IN-PROCESS-SDK-ANALYSIS.md),
> [AUTHN-AUTHZ-ANALYSIS.md](./AUTHN-AUTHZ-ANALYSIS.md), and
> [ACCESS-CONTROL-RECIPES.md](./ACCESS-CONTROL-RECIPES.md).

This document captures the recommended sequencing of work across the
project as of April 2026. It is intentionally a living document —
priorities shift as phases land, benchmarks return numbers, and real
external clients arrive.

AuthN / AuthZ (item 1) closed out its load-bearing work on 2026-04-26.
Phases 0–7 of the auth plan have shipped, including read-side row
scoping via `beforeRead` and the companion admin-on-`ClientDocument`
reshape. The bulk of Phase 8 (registered-collections / who-has-what
inspector views) is the only outstanding auth track and is a
read-only refinement that can slot around other in-flight tracks.
See the **Phase status** table at the top of
[AUTHN-AUTHZ-ANALYSIS.md](./AUTHN-AUTHZ-ANALYSIS.md) for the full
breakdown.

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

## ~~1. AuthN / AuthZ — load-bearing work~~ — shipped 2026-04-26

Phases 0–7 of the auth plan all shipped between 2026-04-18 and
2026-04-26: actor primitives and context threading, ability
registry with collection auto-registration, admin-users /
admin-roles / admin-permissions schema and services, JWT session
provider, service-layer enforcement on the write path / public
client read path / admin server fns, admin UI (sign-in, users,
roles, role-ability editor), `beforeRead` hook + query-level
filtering with per-`ReadContext` cache, and the companion admin-on-
`ClientDocument` reshape that pulls every admin document read
through the same pipeline as the public SDK. Six worked recipes are
in [ACCESS-CONTROL-RECIPES.md](./ACCESS-CONTROL-RECIPES.md).

The only outstanding auth track is the bulk of Phase 8
(registered-collections / who-has-what inspector views) — read-only
refinements that can slot around other in-flight tracks. The
role-ability editor at
`apps/webapp/src/modules/admin/admin-permissions/components/inspector.tsx`
is the only Phase 8 piece currently in place.

Full per-phase status and the strategic rationale live in
[AUTHN-AUTHZ-ANALYSIS.md](./AUTHN-AUTHZ-ANALYSIS.md).

---

## ~~1. Richtext document links~~ — shipped 2026-04-27

The link plugin (`LinkNode` + `RelationPicker`-driven modal, internal
and external links, configured via `linksInEditor: true` on each
target collection) and the inline image plugin
(`DocumentInlineImageNode` over the same envelope, with denormalised
media `{ title, altText, image, sizes }`) both landed. Both share the
`DocumentRelation` envelope and the `useModalFormState` hook
(`apps/webapp/src/ui/fields/richtext/richtext-lexical/field/shared/useModalFormState.ts`).
Mode 1 (save-time denormalisation) is the active path; Mode 2 has a
prepared `inline-image-after-read.ts` hook that is not yet wired into
any collection — opt in when staleness becomes a problem. The shape
that shipped diverges from the original spec in three notable ways
(flat envelope vs. `cached` bag, collection-level `linksInEditor`
flag vs. per-richtext-field config, and inline image as a sibling
plugin) — see
[RELATIONSHIPS-ANALYSIS § "What changed from the original spec"](./RELATIONSHIPS-ANALYSIS.md#what-changed-from-the-original-spec).

---

## 1. `hasMany` relations

**Scope.** Multi-target relation fields. Needs:
- new `hasMany: true` prop on `RelationField`,
- multi-select picker UX (add / remove / reorder),
- array-of-object Zod shape,
- array populate output,
- tests.

**Why this slot.** Commonly requested, well-scoped in
[RELATIONSHIPS-ANALYSIS § "Deferred"](./RELATIONSHIPS-ANALYSIS.md), and
the only outstanding feature item now that the richtext link / inline
image work has shipped. Not blocking; not load-bearing for any earlier
item.

---

## 2. Stable HTTP transport — explicitly NOT next

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

- **Auth (was item 1) closed out its load-bearing work** on
  2026-04-26. The companion "pull admin document reads through
  `CollectionHandle`" track shipped at the same time — admin reads
  now consume the public `ClientDocument` shape rather than raw
  storage shape, so `beforeRead` / `afterRead` / future read
  concerns land in one pipeline. The only outstanding auth track is
  the bulk of Phase 8 (inspector views) — read-only refinements
  that can slot around other in-flight tracks.
- **Item 2 (HTTP transport) stays deferred** regardless of progress
  on item 1 unless an external-client trigger fires. Whenever it
  does fire, it will inherit the `RequestContext` / `Actor`
  contract established by the auth phases.
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
| 2026-04-26 | Phase 7 (`beforeRead` hook + query-level filtering) shipped end-to-end with the companion admin-on-`ClientDocument` reshape. Auth (was item 1) is now structurally complete for its load-bearing work; only Phase 8 inspector views remain. Items renumbered: `hasMany` is now item 1, richtext document links item 2, HTTP transport item 3. Worked recipes added at [ACCESS-CONTROL-RECIPES.md](./ACCESS-CONTROL-RECIPES.md). |
| 2026-04-27 | Richtext document links shipped: `LinkNode` + link plugin (internal/external links, configured by `linksInEditor` on each target collection) and inline image plugin (`DocumentInlineImageNode` over the same `DocumentRelation` envelope, with denormalised `{ title, altText, image, sizes }`). Mode 1 (save-time denormalisation) is the active path; an `inline-image-after-read.ts` Mode 2 hook is authored but unwired. Shape diverges from the original spec — see [RELATIONSHIPS-ANALYSIS § "What changed from the original spec"](./RELATIONSHIPS-ANALYSIS.md#what-changed-from-the-original-spec). Items renumbered: `hasMany` is now item 1, HTTP transport item 2. Companion editor cleanup pass: shared `useModalFormState` hook extracted; field-widget dead `_isDirty` lines removed. |
