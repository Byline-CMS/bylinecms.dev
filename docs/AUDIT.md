---
title: "Auditability"
path: "audit"
summary: "The auditability work domain: the version audit trail (acting user + action), the document-grain audit log, the tabbed history view, and the system-wide activity report. Closes the gap between the public auditability claim and what the admin actually shows."
---

# Auditability

:::note[Status]
**Workstreams 1–3 shipped (W1 in v3.8.0; W2 + W3 in v3.10.0); Workstream 4
(the system activity area + report) remains planned.** Sections below are
marked shipped inline; anything not so marked — chiefly W4 — is still a plan.
This is the domain home for the auditability work; it subsumes the earlier
[CORE-DOCUMENT-STORAGE.md → Phase — document-grain audit log](./CORE-DOCUMENT-STORAGE.md#phase--document-grain-audit-log)
and expands around it. Where this doc and a shipped doc disagree, the shipped
doc wins.
:::

## Why — the claim we have to honour

bylinecms.app leads with auditability as a principle:

> "Auditable: versions, editorial trails and citations — ask 'where did this
> come from?' and get a real answer."

> "Every document carries its history: **who wrote it, who changed it**, and
> which version is the one you stand behind."

> "Accountable. Because your content is original, attributable and auditable,
> you can stand behind it."

The version stream honours the *what* and *when* halves of that claim —
immutable versions, a History view, per-version diffs. The **who** half is
currently unhonoured, and two classes of change have no recorded history at
all. This domain closes the gap in four workstreams.

### Vocabulary — "audit", not "attribution"

Two words that sound adjacent but must not bleed in Byline:

- **Attribution** is *public-facing*: copyright, author / publisher credit on
  **published** content (the "original, attributable, auditable" thesis aimed
  at readers and the provenance story). It surfaces to the audience — e.g. a
  media item's `Credit / Attribution` field.
- **Auditability** is *internal*: which staff actor did what to a document or
  version, and when. A staff-accountability record inside the admin, never
  shown to readers.

Everything in this domain is the second. The internal vocabulary is
consistently **audit** (the record), **acting user / actor** (the who), and
**auditability** (the property) — never "attribution", which is reserved for
the public credit concept. The stored column is the neutral `created_by`.

## Present state — the gap, precisely

What exists today:

- **Immutable version stream.** Every content save is a new
  `document_versions` row (UUIDv7, time-ordered). The History view
  (`packages/host-tanstack-start/src/admin-shell/collections/history.tsx`)
  renders the lineage with a `DiffModal` per version, driven by the
  collection's `listViewColumns` (`adminConfig.columns`).
- **A `created_by` column that is never written.** `document_versions`
  carries `created_by uuid NULL` (`packages/db-postgres/src/database/schema/index.ts`),
  it is projected through the `current_documents` /
  `current_published_documents` views and the adapter's read queries, and
  `createDocumentVersion` accepts an optional `createdBy` param — but **no
  lifecycle service passes it**. Every row is NULL. The plumbing exists end
  to end except the single hand-off from the lifecycle context to the
  storage command.
- **The actor is available at every write.** `DocumentLifecycleContext.requestContext`
  carries the `Actor` (`AdminAuth.id` is the `byline_admin_users` id);
  `assertActorCanPerform` already rejects writes without it. Recording the
  actor is a wiring problem, not an auth-design problem.
- **The client read shape drops it.** `shapeDocument`
  (`packages/client/src/response.ts`) does not map `created_by`, so even a
  populated column would not reach the admin UI or any SDK consumer.
- **Non-versioned writes leave no trail.** `path` and editorial
  `availableLocales` are deliberately written outside the version stream
  (v3.3.0 decoupling, via `updateDocumentSystemFields`) — immediate writes
  with no record of who/when/from→to.
- **Status transitions mutate in place.** A publish → unpublish → re-publish
  sequence is not independently recorded beyond the current status value.
- **Admin-module actions are unrecorded.** User/role/permission changes
  (`@byline/admin` commands) have no activity record.

## Workstream 1 — the version audit trail (acting user + action)

**The cheapest, highest-leverage piece; ships first and alone.** Answers
"who wrote it, who changed it" for every content save.

### Write side

Pass `createdBy: context.requestContext?.actor?.id` at every
`createDocumentVersion` call site in
`packages/core/src/services/document-lifecycle/`:

| Module | Call sites | Action recorded |
|---|---|---|
| `create.ts` | 1 | `create` |
| `update.ts` | 2 | `update` (whole-doc + patches) |
| `duplicate.ts` | 2 | `duplicate` |
| `restore.ts` | 1 | `restore` |
| `copy-to-locale.ts` | 1 | `copy_to_locale` |

No schema change, no migration — the column exists. Historical rows stay
NULL (render as em-dash / "unknown"); there is nothing to backfill from.
**Attribution requires a real persisted user id — a UUID** (`actorId()` in
`document-lifecycle/internals.ts`). Internal-tooling callers either pass no
`requestContext` (seeds, migrations — the documented escape hatch) **or** a
synthetic super-admin context whose id is not a UUID
(`createSuperAdminContext({ id: 'import-docs-script' })`); both yield NULL
`created_by`. This was a deliberate hardening after a v3.8.0 regression where
a synthetic non-UUID actor id crashed every script/seed write on the `uuid`
column (`invalid input syntax for type uuid`); the fix shipped in v3.9.0. See
Open questions for the optional explicit "system" convention.

### Read side

- **Naming: plain `createdBy`, no underscore, no `updatedBy`.** Versions
  are immutable — every operation *creates* a row, so the audit record on a
  version is its creator. A shaped `ClientDocument` is the current-version
  projection, so the same name is accurate at both grains. And since
  `created_by` is a raw column (not derived), the read-surface underscore
  convention (leading `_` = derived/computed) does **not** apply —
  `createdBy` is the exact sibling of `updatedAt`. UI labels remain free
  to read "Updated By" in list contexts; that's presentation.
- Surface `created_by` per version through the history server fn
  (`packages/host-tanstack-start/src/server-fns/collections/history.ts`)
  and through `shapeDocument` as `createdBy` (raw uuid) on
  `ClientDocument` / history rows.
- **Display names are an admin-realm concern, resolved in the admin
  server fns.** The shared SDK carries only the raw id. The admin server
  fns are the realm-correct seam: document reads already go through
  `getAdminBylineClient()` — the shared `BylineClient` constructed with
  `requestContext: getAdminRequestContext`, so the *context* is the admin
  actor even though the SDK is shared — and the same fns reach the admin
  store the way `admin-users/list.ts` does (`bylineCore().adminStore`).
  They batch-resolve ids via a new `AdminUsersRepository.getByIds(ids)`
  (the repo has `getById` only today) and return an
  **`actors: Record<id, { label }>` map alongside the page**; the UI
  joins. What stays ruled out is the *document storage module* in
  `db-postgres` JOINing `byline_admin_users` — that would bake admin-realm
  knowledge into the shared document store and break when a `UserAuth`
  actor writes a version.
- **Public-client exposure (decision needed).** The public client
  (`byline-public-client.ts`) never resolves labels; whether public reads
  should include even the raw `createdBy` uuid is an open call — leaning
  **omit** (admin identity metadata on an anonymous surface).

### UI — the audit strip

> **Shipped state (v3.8.0):** the **History view** strip is live (default-on).
> The **list-view** strip is **deferred** — its toggle mechanism (per-collection
> admin config vs. a view-level density control) is unresolved; see the density
> bullet below. The list server fn does not yet resolve actor labels.

Decision (2026-06-12): the audit record (acting user + action + time) renders in a
**framework-owned, muted colspan sub-row under each table row** (the
"audit strip") — in the History view and in list views — rather than as
injected or opt-in `listViewColumns` entries. Rationale:

- **Structural separation of domains.** `listViewColumns` is the
  collection author's presentation surface over **user-defined fields**;
  audit metadata is a system concern that should not be configurable away
  per collection — an auditability claim wants the audit record to be
  *structurally present*, not opt-in. The strip gives each domain its own
  mechanism.
- The root fallback in `getColumnValue` (`history.tsx` — `fields` first,
  then document root) remains as the **documented whitelist** for
  version-grain fields that genuinely belong in columns: `status`
  (workflow is a concern editors act on) and `updatedAt` (sortable).
  These keep working unchanged — sorting stays a header-column
  affordance; the strip is not sortable.
- Strip content, compact single line:
  `created by <label> · <action: create/update/restore/duplicate/copy_to_locale> · <when>`.
  Rows written before audit wiring (NULL `created_by`) render an em-dash label.
- **Density trade-off, managed:** the strip roughly halves row density.
  Default **on** in the History view (history *is* the audit surface);
  list views get a toggle (per-collection admin config or a view-level
  density control — decide at build time).
- Markup: a second `<tr>` per row — an empty spacer cell under the
  version-number column, then a `<td colSpan>` carrying the strip. The
  `@byline/ui` `Table.Cell` already spreads `colSpan`, so no Table-primitive
  extension was needed after all (the history view ships this directly).
  A11y care still applies so screen readers associate the strip with its row.

## Workstream 2 — document-grain audit log (new table + migration)

> **Storage + write-points shipped to `develop` (unreleased).** The
> `byline_audit_log` table (migration `0001`), the `audit.append` command +
> `getDocumentAuditLog` query on the adapter contract, and the three
> write-points (`updateDocumentSystemFields`, `changeStatus`, `deleteDocument`,
> each wrapping its mutation + audit append in `db.withTransaction(...)`) are
> all live. **Workstream 3 (per-document read path + document-history view) is
> now also shipped to `develop`** — see below. **Still pending:** the
> system-wide `findAuditLog` report + activity area (Workstream 4).

The spec sketched in
[CORE-DOCUMENT-STORAGE.md](./CORE-DOCUMENT-STORAGE.md#phase--document-grain-audit-log),
adopted here as the authoritative home. Records the changes the version
stream deliberately does not.

### Table

One new table, one migration:

```
byline_audit_log
  id            uuid PK (UUIDv7 — time-ordered, no separate sort column needed)
  document_id   uuid NULL      -- nullable: admin-realm events have no document
  collection_id uuid NULL
  actor_id      uuid NULL      -- NULL = system/internal tooling
  actor_realm   varchar(16)    -- 'admin' today; 'user' reserved
  action        varchar(64)    -- namespaced, see below
  field         varchar(128) NULL
  before        jsonb NULL
  after         jsonb NULL
  occurred_at   timestamptz NOT NULL DEFAULT now()
```

**One generic table, not a document-scoped one.** `document_id` is nullable
and `action` is namespaced — shipped: `document.path.changed`,
`document.locales.changed`, `document.status.changed`, `document.deleted`;
reserved for later: `admin.user.created`, `admin.role.updated`, … — so
Workstream 4's system-wide activity report and any future admin-module
auditing land in the same table without a second migration. `actor_realm` is
`'admin' | 'user' | 'system'` (`'system'` for non-UUID synthetic / tooling
actors). Deliberately **FK-free** — an audit row outlives the doc / collection /
actor it names (a `document.deleted` row cannot cascade-delete itself).
Indexes on `(document_id, id)`, `(actor_id, id)`, `(action, id)`; UUIDv7 ids
give time ordering for free.

**The version stream stays the record for content.** Content saves are
**never** double-written into the audit log — the activity surfaces union
the two sources at read time. The audit log records only what the version
stream cannot: non-versioned document-grain writes, in-place status
transitions, deletions, and (later) admin-module actions.

### Atomicity (the load-bearing decision)

The mutation and its audit-log row **must commit together**. The one
unacceptable outcome for an auditability feature is a change that succeeds
while its audit row silently fails to write — a silent gap in the record.
So the audit insert runs in the **same database transaction** as the
mutation, not best-effort afterwards.

This is delivered through a request-scoped `withTransaction` boundary owned
by the service layer (the audit write becomes a peer command in the same
transaction; the storage adapter never learns the word "audit"), rather than
by threading audit intent into each storage command. That mechanism — its
AsyncLocalStorage propagation, the DB↔DB vs DB↔external distinction, and the
serverless db-contract-seam decisions — is specified in
**[TRANSACTIONS.md](./TRANSACTIONS.md)**. That prerequisite **shipped in
v3.9.0** (the `withTransaction` capability on `@byline/db-postgres`); this
workstream now consumes it — wrapping each mutation + `audit.append` in
`db.withTransaction(...)`.

### Write points (shipped)

Inside the existing service entry points, under the existing auth gates
(no new enforcement surface), each wrapping its mutation + audit append in
`db.withTransaction(...)`. The shared helper (`document-lifecycle/audit.ts`)
provides `requireAuditCapability(db)` — which throws `ERR_AUDIT_UNSUPPORTED`
loudly if the adapter lacks `withTransaction` / `commands.audit` rather than
recording a gap — plus `auditActor(ctx)` (UUID id → realm `'admin'`; synthetic
→ NULL + `'system'`) and the `AUDIT_ACTIONS` constants.

- `updateDocumentSystemFields` (`document-lifecycle/system-fields.ts`) — path
  and availableLocales changes, **one row per field that actually changed**
  (before/after; a same-value save records nothing).
- `changeStatus` (`document-lifecycle/status.ts`) — every transition, from→to.
- `deleteDocument` (`document-lifecycle/delete.ts`) — the deletion event (the
  one change that otherwise erases its own history); the soft-delete is in the
  transaction, the storage-file cleanup stays outside it (DB↔external).
- **Pending:** `delete-locale.ts` (it mints a version, so W1 already records
  the actor — revisit whether it also warrants an audit row) and, later, the
  `@byline/admin` user/role/permission commands (gated behind Workstream 4).

### Read surface

`getDocumentAuditLog(documentId)` (per-document history, **shipped** on the
adapter contract + Postgres adapter) backs Workstream 3, and is now reached
end-to-end: `CollectionHandle.auditLog()` (the gated client read) →
`getCollectionDocumentAuditLog` host server fn (`server-fns/collections/audit.ts`,
following the existing pattern, resolving actor labels admin-side) → the
document-history tab. `findAuditLog({ where, page })` for the system-wide
activity report is **pending** with Workstream 4.

### Authorization — transitive per document, gated system-wide

Two distinct read scopes, deliberately not transitive between each other:

- **Per-document audit history (W3 tab)** inherits the document's own
  read gate. The precedent is already in the code: version history routes
  through `CollectionHandle.history`, which gates via `findById` — when
  the actor's `beforeRead` predicate excludes the document, history
  returns empty rather than leaking version metadata
  (`server-fns/collections/history.ts`). `getDocumentAuditLog` mirrors
  this exactly: resolve the document through the actor's read pipeline
  first (inheriting the `collections.<path>.read` ability **and**
  row-scoping), then fetch audit rows scoped `WHERE document_id = X`. An
  actor with access to the `docs` collection sees that document's grain
  history — never the wider log.
- **The system-wide activity report (W4)** is *not* reachable
  transitively from any collection ability — it sits behind the separate
  `admin.activity.read` ability. Admin-realm events (`document_id NULL`)
  appear only there.

## Workstream 3 — tabbed history view

> **Shipped to `develop` (unreleased).** Both tabs render on the existing
> `/history` route. Read end-to-end through the gated client read
> (`CollectionHandle.auditLog()`), the `getCollectionDocumentAuditLog` host
> server fn, and the loader's parallel fetch.

Two views on the document's history. **Tabs-vs-routes resolved in favour of
the single-route + `tab` search param shape**: the existing `/history` route
gained a `tab` search param (`'versions' | 'document'`, absent → `'versions'`)
and an `AdminTabs` (the `tabs.tsx` presentation primitive) bar under the view
menu. Rationale: it keeps the diff-modal / current-document loader and the
audit-log fetch on one route (one `Promise.all`), needs no second physical
route file in the host app's file-based tree, and stays fully linkable
(`?tab=document`). The audit log is fetched unconditionally and in parallel —
the active tab is a pure render concern read from the URL, so switching tabs
never refetches. The content split:

1. **Content versions** — the existing table, diff modal, restore flow,
   with the audit strip from Workstream 1. Default tab; unchanged
   otherwise.
2. **Document history** — a chronological list of audit-log entries
   for this document: when, action, actor, from → to. No diff viewer;
   before/after render inline (arrays comma-join, the deletion event shows
   an em-dash). Empty state explains that content edits live on the first
   tab. Read access per the Authorization section in Workstream 2 — the
   client `auditLog()` gate mirrors `history()` exactly (`findById` with
   `status: 'any'`; an excluded document yields an empty log). Acting-user
   ids are resolved to labels admin-side via the shared `resolveActorLabels`
   helper (system/tooling rows → "system"; deleted users → "former user").

The per-document audit log is small and bounded, so v1 fetches a single
generous page (`page_size: 100`) rather than wiring a second, tab-specific
pager into the shared route; a dedicated pager can follow if a real
installation needs it.

i18n keys for both views shipped in the `byline-admin` bundle (EN/FR):
`collections.history.tabs.*` (tab labels) and `collections.documentHistory.*`
(column headers, per-action labels, the system-actor and empty-state strings).

## Workstream 4 — system activity area

A new top-level admin area: dedicated menu item + route under the dashboard
(root entry `apps/webapp/src/routes/_byline/admin/index.tsx`, factory-built
like the rest of the shell).

- **Route**: `/_byline/admin/activity` via a new
  `createAdminActivityRoute` factory in
  `@byline/host-tanstack-start/routes`; menu item added to the admin
  chrome alongside Collections / Users / Roles.
- **The report**: a filterable, paged feed over the **read-time union** of
  the version stream (content saves, attributed via Workstream 1) and the
  audit log (everything else). Filters: actor, collection, action type,
  date range. Each row links to the document (or admin entity) it
  describes.
- **Authorization**: a new `admin.activity.read` ability (registered like
  the existing `admin.users.*` abilities) so activity visibility is
  grantable independently of content abilities — an auditor role should
  not need write access.
- **Deferred polish** (named triggers, not now): CSV/JSON export of a
  filtered range (trigger: a real compliance ask); retention/pruning
  policy (trigger: an installation where the log's growth actually
  matters).

## Sequencing

```
W1  audit trail on version stream      ── independent, ships first
W2  audit table + write points         ──┐  one PR-chain: schema → writes → reads
W3  tabbed history view                ──┘  (W3 consumes W2's read surface)
W4  activity area + report             ── needs W1 + W2; ships last
```

W1 has no migration and no design risk — it can land immediately. W2+W3
are one coherent slice. W4 is the visible centerpiece but is mostly
assembly once the two data sources exist.

**Downstream-site note**: W2's migration is purely additive (new table, no
backfill, no NOT NULL retrofit), so the existing-site upgrade playbook is
just "migrate then deploy". The Drizzle-independent script for existing
production databases is
[`packages/db-postgres/sql/0003_add-audit-log.sql`](../packages/db-postgres/sql/0003_add-audit-log.sql)
(run as the app DB role, not a superuser). W1 needs no DDL at all.

## Open questions

- **Deleted admin users.** `created_by` / `actor_id` reference users that
  may later be deleted. Resolution: keep the id, render a tombstone label
  ("former user") — or soft-delete admin users. Decide before W4 (the
  report is where dangling ids become visible).
- **Public-client `createdBy` exposure.** Leaning omit (see Workstream 1
  read side) — decide before W1 ships, since it sets the public
  `ClientDocument` shape.
- **List-view strip toggle.** Per-collection admin config vs a view-level
  density control — decide at W1 build time (History view is default-on
  either way).
- **System writes.** Seeds/migrations and synthetic non-UUID actors write
  NULL `created_by` today (shipped v3.9.0 — see Workstream 1 read side). On
  the version stream that NULL is indistinguishable from a pre-audit row.
  For the **audit log** (W2), is an explicit `actor_realm: 'system'` sentinel
  worth carrying so a deliberate system write is distinguishable from "no
  actor recorded"?
- **Restore/duplicate provenance.** Should a restored version's audit
  entry record *which* version it was restored from? (The version row
  itself has `previousVersionId`; probably sufficient.)
- **Status history granularity.** Status mutates the version row in place;
  the audit log records the transition. Is per-version status history ever
  needed beyond that? (Current answer: no — the audit log is the record.)
- **`hasMany` interaction.** None expected — relations live in the version
  stream — but the activity report's row-rendering should be checked
  against `hasMany` shapes when both exist.

## Code map (planned touch points)

| Concern | Location |
|---|---|
| Version audit-trail write (`created_by`) | `packages/core/src/services/document-lifecycle/{create,update,duplicate,restore,copy-to-locale}.ts` |
| `createDocumentVersion` `createdBy` param (exists) | `packages/db-postgres/src/modules/storage/storage-commands.ts` |
| `created_by` column + view projection (exists) | `packages/db-postgres/src/database/schema/index.ts` |
| Client shaping (`createdBy`) | `packages/client/src/response.ts` |
| Display-name batch resolution (`actors` map) | `packages/host-tanstack-start/src/server-fns/collections/*` + `bylineCore().adminStore` |
| `AdminUsersRepository.getByIds` (new bulk lookup) | `packages/admin/src/modules/admin-users/repository.ts` + `@byline/db-postgres/admin` |
| History view (audit strip, history/document views) | `packages/host-tanstack-start/src/admin-shell/collections/history.tsx` |
| Audit strip component | `packages/admin/src/widgets/` (exported from `@byline/admin/react`) |
| `Table` sub-row support | `packages/ui/src/` (Table primitive) |
| Tabs primitive | `packages/admin/src/presentation/tabs.tsx` |
| Audit table schema + migration | `packages/db-postgres/src/database/schema/index.ts` + `migrations/` |
| Audit write points | `packages/core/src/services/document-lifecycle/{system-fields,status,delete,delete-locale}.ts` |
| Audit read (gated client) | `packages/client/src/collection-handle.ts` → `auditLog()` (+ `AuditLogOptions` in `types.ts`, re-exports in `index.ts`) |
| Audit read host server fn | `packages/host-tanstack-start/src/server-fns/collections/audit.ts` (`getCollectionDocumentAuditLog`) |
| Document-history tab UI | `packages/host-tanstack-start/src/admin-shell/collections/{history.tsx (AdminTabs),document-history.tsx}` |
| Activity route factory + menu item | `packages/host-tanstack-start/src/routes/` + `admin-shell/chrome/` |
| `admin.activity.read` ability | `packages/admin/src/` (abilities) |
| Example list-view opt-in | `apps/webapp/byline/collections/docs/admin.tsx` |
