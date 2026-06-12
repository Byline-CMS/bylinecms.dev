---
title: "Auditability"
path: "audit"
summary: "The auditability work domain: the version audit trail (acting user + action), the document-grain audit log, the tabbed history view, and the system-wide activity report. Closes the gap between the public auditability claim and what the admin actually shows."
---

# Auditability

:::note[Status]
**Working document / plan — nothing in this doc is built yet** except where
explicitly marked as shipped. This is the domain home for the auditability
work; it subsumes the earlier
[CORE-DOCUMENT-STORAGE.md → Phase — document-grain audit log](./CORE-DOCUMENT-STORAGE.md#phase--document-grain-audit-log-planned)
and expands around it. Where this doc and a shipped doc disagree, the shipped
doc wins until this one loses the status banner.
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
Internal-tooling callers without a `requestContext` (seeds, migrations —
the documented escape hatch) keep writing NULL; see Open questions for an
optional explicit "system" convention.

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

The spec sketched in
[CORE-DOCUMENT-STORAGE.md](./CORE-DOCUMENT-STORAGE.md#phase--document-grain-audit-log-planned),
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
and `action` is namespaced (`document.path.updated`,
`document.locales.updated`, `document.status.changed`,
`document.deleted`, `admin.user.created`, `admin.role.updated`, …) so
Workstream 4's system-wide activity report and any future admin-module
auditing land in the same table without a second migration. Indexes on
`(document_id, id)` and `(actor_id, id)`; UUIDv7 ids give time ordering
for free.

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
**[TRANSACTIONS.md](./TRANSACTIONS.md)**, and is the **prerequisite this
workstream builds on first**.

### Write points

Inside the existing service entry points, under the existing auth gates
(no new enforcement surface), each wrapped in `withTransaction` with its
audit-log append:

- `updateDocumentSystemFields` (`document-lifecycle/system-fields.ts`) —
  path and availableLocales changes, with before/after.
- `changeStatus` (`document-lifecycle/status.ts`) — every transition,
  from→to.
- `delete.ts` / `delete-locale.ts` — deletion events (the one change that
  otherwise erases its own history).
- Later, the `@byline/admin` user/role/permission commands (gated behind
  Workstream 4 actually needing them — don't build ahead of the report).

### Read surface

A paged adapter query + core service (`getDocumentAuditLog(documentId)`
and `findAuditLog({ where, page })` for the activity report), exposed
through new host server fns following the existing
`server-fns/collections/*` pattern.

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

Two views on the document's history; **the tabs-vs-routes question is
deliberately parked** until Workstreams 1 and 2 are nailed down. The two
candidate shapes — one route with the `tabs.tsx` presentation primitive
(`@byline/admin/src/presentation/`), or two child routes under `/history`
whose tab bar is simply two styled links — converge in TanStack (linkable
either way), so the choice can wait. The content split is settled:

1. **Content versions** — the existing table, diff modal, restore flow,
   now with the audit strip from Workstream 1. Unchanged
   otherwise.
2. **Document history** — a simple chronological list of audit-log entries
   for this document: who, what (action + field), when, from → to. No
   diff viewer needed; before/after render inline. Empty state explains
   that content edits live on the first view. Read access per the
   Authorization section in Workstream 2 (gated by the document's own
   read pipeline).

i18n keys for both views in the `byline-admin` bundle (EN/FR) from the
start.

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
just "migrate then deploy". W1 needs no DDL at all.

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
- **System writes.** Seeds/migrations write NULL actor today. Worth an
  explicit sentinel (`actor_realm: 'system'`) in the audit log so "no
  actor" is distinguishable from "a row written before audit wiring"?
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
| Audit read service | `packages/core/src/services/` (new) |
| Activity route factory + menu item | `packages/host-tanstack-start/src/routes/` + `admin-shell/chrome/` |
| `admin.activity.read` ability | `packages/admin/src/` (abilities) |
| Example list-view opt-in | `apps/webapp/byline/collections/docs/admin.tsx` |
