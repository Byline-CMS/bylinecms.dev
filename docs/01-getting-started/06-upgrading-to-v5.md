---
title: "Upgrading from 4.19 to 5.x"
path: "upgrading-to-v5"
summary: "Upgrade an existing Byline installation to document-wide optimistic concurrency through a fenced database and application cutover."
---

# Upgrading from 4.19 to 5.x

Companions:
- [PostgreSQL v5 cutover](./07-postgresql-v5-cutover.md) — the PostgreSQL operator procedure, including role fencing and session termination.
- [MySQL v5 cutover](./08-mysql-v5-cutover.md) — the MySQL operator procedure, including account locking and resumable DDL.
- [Client SDK API](../10-api-reference/04-client-sdk.md) — editable observations and the exact mutation signatures.
- [Scheduled publication](../11-scheduling/02-scheduled-publication.md) — authorization revisions and reconfirmation after changes.

Byline 5 prevents an editor or SDK caller from overwriting document state it did
not observe. Every supported mutation of an existing document now requires the
document's current integer revision. Content, workflow status, path, advertised
locales, schedules, source-locale re-anchoring, deletion, restoration and tree
placement all participate in the same document-wide contract.

This is a coordinated breaking release. Upgrade every registry-backed
`@byline/*` package together and use the cutover procedure for your database.
Do not run old and new writers against the same database. The fresh-install
Drizzle baseline bundled by `@byline/cli` is for an empty database; it is not an
upgrade script and the CLI refuses to apply it to an occupied database.

## What changes for application code

Read an editable observation before changing an existing document. Pass its
`revision` as `expectedRevision`, then carry the revision returned by each
successful mutation into the next deliberate operation.

Before:

```ts
await news.update(documentId, replacement, { locale: 'en' })
await news.changeStatus(documentId, 'published')
```

After:

```ts
const observed = await news.findByIdForEdit(documentId, { locale: 'en' })
if (!observed) throw new Error('Document is unavailable')

const updated = await news.update(documentId, replacement, {
  locale: 'en',
  expectedRevision: observed.revision,
})
await news.changeStatus(documentId, 'published', {
  expectedRevision: updated.revision,
})
```

Singletons use `getForEdit()`. An existing singleton save passes its document
revision; the first save into a genuinely empty slot passes
`{ expectedState: 'empty' }`. A published read returning `null` does not prove
that the singleton slot is empty.

Missing, malformed or stale observations fail closed. Byline does not fetch the
latest revision and retry the old payload. A successful write returns the next
revision. A committed after-hook failure is different: the write has already
committed and its error includes the committed revision, so callers must not
submit the write again.

## What editors see

When another mutation invalidates an open form, the admin retains its local
fields and shows a persistent warning. Save, status, metadata, scheduling,
locale, delete, duplicate and structural controls remain blocked for that
editing session. **Reload and discard my changes** performs the explicit fresh
read. Ordinary navigation continues to show the unsaved-change guard.

An old browser request that omits a revision is also rejected and shown a
reload-required message. There is no grace period that accepts old payloads.
Editors may copy text out of the retained form before reloading.

The revision is document-wide. Two translators editing different locales can
therefore conflict even when their field changes do not overlap. This
conservative behavior is intentional for v5. Locale-grain merging is not part
of this release.

## Scheduled publications

An armed schedule records the document revision that was explicitly authorized.
Content, path, advertised-locale, source-locale and actual tree/order changes
suspend it to `needs_reconfirm` in the same transaction as the triggering
change. Structural receipts identify authorized affected documents where the
actor may view them. The admin provides a review path and never automatically
reconfirms the schedule.

The database upgrade cannot reconstruct a trustworthy authorization revision
for a schedule created by v4. Every pre-existing armed schedule therefore moves
to `needs_reconfirm` with reason `upgrade_invalidated`; execution claims are
cleared. Review and explicitly confirm or reschedule each one after the new
application is running.

## Existing copied application files

Installing new packages does not rewrite files previously copied into an
application by the CLI. Search every application repository and deployment
image, including old operational branches, for these generated examples:

- `byline/scripts/regenerate-media.ts`
- `byline/scripts/regenerate-media-operation.ts`
- `byline/scripts/import-docs.ts`
- `byline/scripts/lib/walk-document-status.ts`
- `byline/scripts/re-anchor.ts` in PostgreSQL example installations
- `byline/scripts/backfill-version-locales.ts` in PostgreSQL example installations
- application seeds and one-off jobs that call `CollectionHandle`,
  `SingletonHandle`, `db.reAnchorDocuments`, or lifecycle services

Replace copied media-regeneration files as a pair. The v5 operation reads an
editable observation and performs one guarded replacement that preserves the
observed workflow status. When the document is published it archives the
superseded published version. It deliberately emits no status-change audit row
because the status did not change.

The v5 re-anchor script supplies a target list containing each document's
observed revision:

```ts
const targets = editable.docs.map((document) => ({
  documentId: document.id,
  expectedRevision: document.revision,
}))

await db.reAnchorDocuments({ targets, targetLocale, collectionId, dryRun })
```

Do not adapt an old script by fetching a revision immediately before its write
while retaining content prepared from an older read. The observation must
represent the state used to prepare the mutation.

### Manual inventory checklist

- Search for `.update(`, `.delete(`, `.changeStatus(`, `.unpublish(`,
  `.schedulePublish(`, `.restoreVersion(`, `.copyToLocale(`,
  `.placeInTree(`, `.removeFromTree(`, `.reorder(` and
  `reAnchorDocuments(` on Byline clients and services.
- Search direct host server-function payload construction for document IDs and
  add the observed revision rather than casting the payload.
- Update scripts in application source, worker images, scheduled-job bundles
  and operational repositories; a package lockfile update alone is insufficient.
- Compile and exercise each writer against a fenced staging copy before the
  production maintenance window.
- Remove or revoke old deploy artifacts and credentials so an overlooked v4
  writer cannot reconnect later.

## Supported rollout and rollback boundary

Use one maintenance cutover:

1. Stop editorial traffic, schedulers, importers and every external writer.
2. Disable the old database principal, revoke its write access and terminate
   its existing sessions while retaining a separate operator connection.
3. Back up the database, apply the numbered native SQL upgrade and verify its
   final schema assertions.
4. Deploy the complete v5 package set and all audited writer integrations with
   a new database principal or credentials.
5. Verify the old principal cannot connect or mutate data, verify editable reads
   and guarded writes, then reopen editors and workers.
6. Review schedules in `needs_reconfirm` and explicitly authorize the ones that
   should still publish.

Changing a password alone does not terminate established sessions. Adding a
non-null revision column alone also does not prevent an old process from
updating paths, statuses or version tables directly. The database fence and
application upgrade are both required.

After v5 writes resume, rollback to a v4 writer is unsupported. Restoring old
application code or removing the new columns would reintroduce blind writes and
cannot interpret authorization revisions safely. Rollback requires another
fenced maintenance window and either a complete pre-upgrade database restore or
a separately reviewed forward repair. Do not reopen old writer credentials.

## Verification boundary

Repository tests verify both native upgrades, fresh baselines, fail-closed
startup, old-request rejection, SDK contracts and editor recovery. They cannot
verify that a downstream operator revoked credentials, terminated every
session, found every copied script or reviewed each schedule. Record those
operator actions separately for the installation being upgraded.

