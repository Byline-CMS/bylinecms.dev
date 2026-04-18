# Phases of Work — Strategic Roadmap

> Last updated: 2026-04-18 (post-Phase 4)
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

## 1. Status-aware reads

**Scope.** Add a `status?: 'published' | 'any'` option to
`FindOptions` and `PopulateOptions`, plumbed through to
`getDocumentsByDocumentIds` and `findDocuments` as a new filter.
`@byline/client` defaults to `'published'`; admin server fns pass
`'any'`.

**Why now.** `find` and populate currently both read through
`current_documents`, which surfaces the latest version of a document
regardless of workflow status. A draft saved over a published version
will leak into populated relations and any public consumer of
`@byline/client` can see archived or draft targets. This is the only
meaningful read-side gap before the SDK is safe for non-admin
consumers, and it is a precondition for any future public HTTP
boundary.

**Shape.** Mostly a query-builder option propagated through the read
path. Now the top-priority client-API item with Phase 4 shipped — the
SDK is actively being exercised in non-admin contexts, so the status
filter is load-bearing.

---

## 2. Benchmark the UNION ALL at scale

**Scope.** Run `EXPLAIN ANALYZE` on the 7-way UNION ALL with realistic
seed data at 10k, 50k, and 100k documents (20–30 fields each). Find
the actual inflection point. Then decide whether the JSONB
read-cache column on `document_versions` (already partially in place
as the `doc` column) is worth building.

**Why now.** Long-standing strategic open item from
[STORAGE-ANALYSIS § "Where it might cost us"](./STORAGE-ANALYSIS.md).
Populate amplifies fan-out at depth (see RELATIONSHIPS-ANALYSIS §
"Risks"), so the question matters more now than when it was first
flagged. Selective field loading mitigates list views; single-document
reads still hit all seven stores.

**Rule.** Do not pre-optimize. Do measure. The decision tree on the
read cache is gated on the benchmark numbers, not on intuition.

---

## 3. `afterRead` hook

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

## 4. `hasMany` relations

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

## 5. Richtext document links

**Scope.** Lexical `DocumentLinkNode`, toolbar plugin reusing the
existing `RelationPicker`, save-time vs read-time hydration modes,
configurable field projection, shared `ReadContext` for recursion
safety.

**Why this slot.** Larger track that depends on item 3 (`afterRead`)
for Mode 2 hydration. Designed in detail in
[RELATIONSHIPS-ANALYSIS § "Future work: rich-text document
links"](./RELATIONSHIPS-ANALYSIS.md). Defer until `afterRead` ships.

---

## 6. Stable HTTP transport — explicitly NOT next

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

- **Item 1 (status-aware reads)** is the top priority now that Phase 4
  has shipped. Without it, `@byline/client` public consumers see
  drafts through populate.
- **Item 2 (benchmark) can run in parallel** with item 1; it is
  measurement work, not implementation work, and the result feeds
  every subsequent decision about read performance.
- **Item 3 (`afterRead`) gates item 5 and the access-control track**
  but does not block 1, 2, or 4.
- **Item 6 (HTTP transport) stays deferred** regardless of progress on
  1–5 unless an external-client trigger fires.

## Progress log

| Date | Change |
|------|--------|
| 2026-04-18 | Initial roadmap captured from strategic review. |
| 2026-04-18 | Phase 4 (client-API write path) shipped. Renumbered remaining items; status-aware reads promoted to item 1. |
