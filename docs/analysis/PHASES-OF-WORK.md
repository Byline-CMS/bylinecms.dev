# Phases of Work — Strategic Roadmap

> Last updated: 2026-04-18 (post-Phase 5 + storage benchmark)
> Companion to [STORAGE-ANALYSIS.md](./STORAGE-ANALYSIS.md),
> [RELATIONSHIPS-ANALYSIS.md](./RELATIONSHIPS-ANALYSIS.md),
> [ROUTING-API-ANALYSIS.md](./ROUTING-API-ANALYSIS.md), and
> [CLIENT-IN-PROCESS-SDK-ANALYSIS.md](./CLIENT-IN-PROCESS-SDK-ANALYSIS.md).

This document captures the recommended sequencing of work across the
project as of April 2026. It is intentionally a living document —
priorities shift as phases land, benchmarks return numbers, and real
external clients arrive.

The two highest-leverage items are roughly tied; the remainder queue
behind them in priority order.

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

## 1. `afterRead` hook

**Scope.** Implement the first read-side hook in the
`document-lifecycle` family. Thread the existing
request-scoped `ReadContext` (already shipped with populate) through
the hook entry point so re-entry stays safe.

**Why now.** `ReadContext` was deliberately wired in ahead of this
work (see [RELATIONSHIPS-ANALYSIS § "Special consideration:
recursive-read safety"](./RELATIONSHIPS-ANALYSIS.md)) so the bulk of
the work is contract + plumbing, not redesign. The A→B→A recursion
class is already foreclosed.

**Why high leverage.** This is the binding point for two future
tracks:
- **Access control** (per-document or per-field read filtering).
- **Richtext document links Mode 2** (read-time hydration of
  `DocumentLinkNode` payloads).

Both are architecturally blocked on `afterRead` existing.

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
load-bearing for any earlier item.

---

## 3. Richtext document links

**Scope.** Lexical `DocumentLinkNode`, toolbar plugin reusing the
existing `RelationPicker`, save-time vs read-time hydration modes,
configurable field projection, shared `ReadContext` for recursion
safety.

**Why this slot.** Larger track that depends on item 1 (`afterRead`)
for Mode 2 hydration. Designed in detail in
[RELATIONSHIPS-ANALYSIS § "Future work: rich-text document
links"](./RELATIONSHIPS-ANALYSIS.md). Defer until `afterRead` ships.

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

- **Item 1 (`afterRead`) gates item 3 and the access-control track**
  but does not block item 2.
- **Item 4 (HTTP transport) stays deferred** regardless of progress on
  1–3 unless an external-client trigger fires.

## Progress log

| Date | Change |
|------|--------|
| 2026-04-18 | Initial roadmap captured from strategic review. |
| 2026-04-18 | Phase 4 (client-API write path) shipped. Renumbered remaining items; status-aware reads promoted to item 1. |
| 2026-04-18 | Phase 5 (status-aware reads) shipped. Item list renumbered; benchmark promoted to item 1. |
| 2026-04-18 | Storage benchmark sweep run and published; "consider a read cache" item closed. Items renumbered; `afterRead` promoted to item 1. |
