---
title: "Auditability"
path: "audit"
summary: "Present-state reference for the auditability subsystem: the version audit trail (acting user + action), the document-grain audit log, the tabbed document-history view, and the system-wide activity area. The internal staff-accountability record behind the public 'who wrote it, who changed it' claim."
---

# Auditability

This is the reference for Byline's auditability subsystem: the per-version
acting-user trail, the document-grain audit log for changes that sit outside the
version stream, and the history and activity views built on top of them. It
builds on the [`withTransaction`](../03-architecture/03-transactions.md)
capability that lets each audited change and its audit row commit atomically.

## Why — the claim being honoured

bylinecms.app leads with auditability as a principle:

> "Auditable: versions, editorial trails and citations — ask 'where did this
> come from?' and get a real answer."

> "Every document carries its history: **who wrote it, who changed it**, and
> which version is the one you stand behind."

The immutable version stream honours the *what* and *when* — versions, a
History view, per-version diffs. The auditability subsystem honours the **who**,
and records the two classes of change that sit outside the version stream
(non-versioned document-grain writes, in-place status transitions) plus
deletions and — reserved — admin-module actions.

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

## The version audit trail (acting user + action)

Answers "who wrote it, who changed it" for every content save. A content save
is a new `document_versions` row, so the audit record on a version *is* its
creator — there is no separate `updatedBy`.

### Write side

Every `createDocumentVersion` call site in
`packages/core/src/services/document-lifecycle/` passes
`createdBy: context.requestContext?.actor?.id`:

| Module | Call sites | Action |
|---|---|---|
| `create.ts` | 1 | `create` |
| `update.ts` | 2 | `update` (whole-doc + patches) |
| `duplicate.ts` | 2 | `duplicate` |
| `restore.ts` | 1 | `restore` |
| `copy-to-locale.ts` | 1 | `copy_to_locale` |

No schema change was needed — `document_versions.created_by uuid NULL` already
existed, projected through the `current_documents` /
`current_published_documents` views. Rows written before the wiring stay NULL
(render as em-dash / "unknown"); there is nothing to backfill from.

**Attribution requires a real persisted user id — a UUID** (`actorId()` in
`document-lifecycle/internals.ts`). Internal-tooling callers either pass no
`requestContext` (seeds, migrations — the documented escape hatch) **or** a
synthetic super-admin context whose id is not a UUID
(`createSuperAdminContext({ id: 'import-docs-script' })`); both yield NULL
`created_by`. A non-UUID actor id is treated as "no attributable user" rather
than written to the `uuid` column, so script and seed writes never fail on it.

### Read side

- **Naming: plain `createdBy`, no underscore.** `created_by` is a raw column
  (not derived), so the read-surface underscore convention (leading `_` =
  derived/computed) does not apply — `createdBy` is the exact sibling of
  `updatedAt`. UI labels remain free to read "Updated By" in list contexts;
  that's presentation.
- `created_by` is surfaced per version through the history server fn
  (`packages/host-tanstack-start/src/server-fns/collections/history.ts`) and
  through `shapeDocument` (`packages/client/src/response.ts`) as `createdBy`
  (raw uuid) on `ClientDocument` / history rows.
- **Display names are an admin-realm concern, resolved in the admin server
  fns** — never a JOIN inside the document storage adapter (which must stay
  ignorant of `byline_admin_users` for the future `UserAuth` writer realm).
  The fns batch-resolve ids via `AdminUsersRepository.getByIds(ids)` and return
  an `actors: Record<id, { label }>` map alongside the page; the UI joins by
  id (`resolveActorLabels`, `server-fns/collections/actors.ts`). Ids absent
  from the map are deleted users — rendered as a "former user" tombstone.

### UI — the audit strip

The audit record (acting user + action + time) renders in a framework-owned,
muted colspan sub-row under each table row (the "audit strip") rather than as
`listViewColumns` entries — `listViewColumns` is the collection author's
surface over **user-defined fields**, whereas audit metadata is a system
concern that should be structurally present, not opt-in per collection.

- Strip content, compact single line:
  `created by <label> · <action> · <when>`. NULL-`created_by` rows render an
  em-dash label.
- Markup: a second `<tr>` per row — an empty spacer cell under the version
  column, then a `<td colSpan>` carrying the strip (`@byline/ui` `Table.Cell`
  spreads `colSpan`, so no Table-primitive extension was needed).
- The strip renders in the **History view** by default. It is not shown in the
  **list view** — it roughly halves row density, and the density toggle
  (per-collection admin config vs. a view-level control) is unresolved.

## The document-grain audit log

Records the changes the version stream deliberately does not: non-versioned
document-grain writes (`path`, `availableLocales`), in-place status
transitions, deletions, and — reserved — admin-module actions.

### Table

```
byline_audit_log
  id            uuid PK (UUIDv7 — time-ordered, no separate sort column needed)
  document_id   uuid NULL      -- nullable: admin-realm events have no document
  collection_id uuid NULL
  actor_id      uuid NULL      -- NULL = system / internal tooling
  actor_realm   varchar(16)    -- 'admin' | 'user' | 'system'
  action        varchar(64)    -- namespaced, see below
  field         varchar(128) NULL
  before        jsonb NULL
  after         jsonb NULL
  occurred_at   timestamptz NOT NULL DEFAULT now()
```

**One generic table, not a document-scoped one.** `document_id` is nullable
and `action` is namespaced — `document.path.changed`, `document.locales.changed`,
`document.status.changed`, `document.deleted` today; `admin.user.created`,
`admin.role.updated`, … reserved — so the system activity area and any future
admin-module auditing land in the same table without a second migration.
`actor_realm` is `'admin' | 'user' | 'system'` (`'system'` for non-UUID
synthetic / tooling actors). Deliberately **FK-free** — an audit row outlives
the doc / collection / actor it names (a `document.deleted` row cannot
cascade-delete itself). Indexes on `(document_id, id)`, `(actor_id, id)`,
`(action, id)`.

**The version stream stays the record for content.** Content saves are
**never** double-written into the audit log — the activity area unions the two
sources at read time. The audit log records only what the version stream
cannot.

### Atomicity (the load-bearing property)

The mutation and its audit-log row **commit together**. The one unacceptable
outcome for an auditability feature is a change that succeeds while its audit
row silently fails to write — a silent gap in the record. So the audit insert
runs in the **same database transaction** as the mutation, not best-effort
afterwards.

This rides on the request-scoped `withTransaction` boundary owned by the
service layer (the audit write is a peer command in the same transaction; the
storage adapter never learns the word "audit"). That mechanism — its
AsyncLocalStorage propagation and the DB↔DB vs DB↔external distinction — is
specified in **[Transactions](../03-architecture/03-transactions.md)**.

### Write points

Inside the existing service entry points, under the existing auth gates (no new
enforcement surface), each wrapping its mutation + audit append in
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

### Read surface

- `getDocumentAuditLog(documentId)` — per-document history, on the adapter
  contract + Postgres adapter. Reached end-to-end through
  `CollectionHandle.auditLog()` (the gated client read) →
  `getCollectionDocumentAuditLog` host server fn
  (`server-fns/collections/audit.ts`) → the document-history tab.
- `findAuditLog({ … })` — the system-wide activity union (see below).

### Authorization — transitive per document, gated system-wide

Two distinct read scopes, deliberately not transitive between each other:

- **Per-document audit history** inherits the document's own read gate.
  `getDocumentAuditLog` resolves the document through the actor's read pipeline
  first (inheriting the `collections.<path>.read` ability **and** `beforeRead`
  row-scoping), then fetches audit rows scoped `WHERE document_id = X` — exactly
  as version `history` gates via `findById`. An actor who cannot see the
  document gets an empty log rather than leaked change metadata.
- **The system-wide activity area** is *not* reachable transitively from any
  collection ability — it sits behind the separate `admin.activity.read`
  ability. Admin-realm events (`document_id NULL`) appear only there.

## The document-history view

Two tabs on a document's `/history` route, selected by a `tab` search param
(`'versions' | 'document'`, absent → `'versions'`) under an `AdminTabs` bar.
Both data sources load in parallel in one `Promise.all`; the active tab is a
pure render concern read from the URL, so switching tabs never refetches.

1. **Content versions** — the existing table, diff modal, restore flow, with
   the audit strip. Default tab.
2. **Document history** — a chronological list of audit-log entries for this
   document: when, action, actor, from → to. No diff viewer; before/after
   render inline (arrays comma-join, the deletion event shows an em-dash).
   Empty state explains that content edits live on the first tab. The client
   `auditLog()` gate mirrors `history()` (`findById` with `status: 'any'`; an
   excluded document yields an empty log). Acting-user ids resolve to labels
   admin-side (`resolveActorLabels`: system/tooling → "system"; deleted →
   "former user").

The per-document log is small and bounded, so it fetches a single generous page
(`page_size: 100`) rather than wiring a tab-specific pager. i18n keys ship in
the `byline-admin` bundle (EN/FR): `collections.history.tabs.*` and
`collections.documentHistory.*`.

## The system activity area

A top-level admin area at `/admin/activity` — the installation-wide
who-did-what feed.

- **Route**: `createAdminActivityRoute` factory in
  `@byline/host-tanstack-start/routes` (physical route at
  `apps/webapp/src/routes/_byline/admin/activity/index.tsx`); an **Activity**
  menu item (`ActivityIcon`) in the admin-management section of the menu
  drawer, shown when the actor holds `admin.activity.read`.
- **The report** is a filterable, paged feed over the **read-time union** of
  the version stream (content saves, surfaced as `document.created` /
  `document.updated` from `event_type` and attributed via `created_by`) and the
  audit log (everything else). The two sources are disjoint — a delete mints no
  version, a status change mutates the version row in place — so the union
  double-counts nothing. Ordered by the normalised `occurred_at` (the
  per-source UUIDv7 ids are separate sequences). Backed by
  `IAuditQueries.findAuditLog` (`@byline/db-postgres` `AuditQueries`, a
  `UNION ALL` normalised onto the `AuditLogEntry` shape). Filters: collection
  (by path, resolved to id server-side), action type, date range, and actor
  (param plumbed; UI control deferred). Each row resolves its actor and
  collection labels and links to the document it describes.
- **Authorization**: the `admin.activity.read` ability
  (`@byline/admin/admin-activity`, registered through `registerAdminAbilities`
  like `admin.users.*`) gates the host server fn `getSystemActivityLog` via
  `assertAdminActor`. Unlike the per-document modules it owns no AdminStore
  command — it reads the document db adapter's `findAuditLog` directly — so the
  assertion lives in the host server fn. The ability is system-wide and **not**
  reachable transitively from any collection ability, so an auditor role gets
  activity visibility without content read/write.

## Code map

| Concern | Location |
|---|---|
| Version audit-trail write (`created_by`) | `packages/core/src/services/document-lifecycle/{create,update,duplicate,restore,copy-to-locale}.ts` |
| `createDocumentVersion` `createdBy` param | `packages/db-postgres/src/modules/storage/storage-commands.ts` |
| `created_by` column + view projection | `packages/db-postgres/src/database/schema/index.ts` |
| Client shaping (`createdBy`) | `packages/client/src/response.ts` |
| Display-name batch resolution (`actors` map) | `packages/host-tanstack-start/src/server-fns/collections/actors.ts` + `bylineCore().adminStore` |
| `AdminUsersRepository.getByIds` | `packages/admin/src/modules/admin-users/repository.ts` + `@byline/db-postgres/admin` |
| History view + audit strip | `packages/host-tanstack-start/src/admin-shell/collections/history.tsx` |
| Tabs primitive | `packages/admin/src/presentation/tabs.tsx` |
| Audit table schema | `packages/db-postgres/src/database/schema/index.ts` (folded into the squashed `0000` baseline; existing-site script `packages/db-postgres/sql/0003_add-audit-log.sql`) |
| Audit write points | `packages/core/src/services/document-lifecycle/{system-fields,status,delete}.ts` + shared `audit.ts` |
| Audit queries (`getDocumentAuditLog`, `findAuditLog`) | `packages/db-postgres/src/modules/audit/audit-queries.ts` (contract: `packages/core/src/@types/db-types.ts` `IAuditQueries`) |
| Audit read (gated client) | `packages/client/src/collection-handle.ts` → `auditLog()` |
| Per-document audit host server fn | `packages/host-tanstack-start/src/server-fns/collections/audit.ts` (`getCollectionDocumentAuditLog`) |
| Document-history tab UI | `packages/host-tanstack-start/src/admin-shell/collections/document-history.tsx` |
| System activity server fn | `packages/host-tanstack-start/src/server-fns/admin-activity/get.ts` (`getSystemActivityLog`) |
| Activity route factory + feed UI | `packages/host-tanstack-start/src/routes/create-admin-activity-route.tsx` + `admin-shell/admin-activity/list.tsx` |
| Activity menu item | `packages/host-tanstack-start/src/admin-shell/chrome/menu-drawer.tsx` |
| `admin.activity.read` ability | `packages/admin/src/modules/admin-activity/abilities.ts` |
