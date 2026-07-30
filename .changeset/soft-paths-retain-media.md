---
"@byline/core": minor
"@byline/client": minor
"@byline/db-postgres": minor
"@byline/db-mysql": minor
"@byline/host-tanstack-start": patch
"@byline/cli": patch
---

Released document paths when a document is soft-deleted while retaining the
path value for history and explicit restoration. PostgreSQL and MySQL now
enforce path uniqueness only among live documents, filter path lookup to live
rows, and restore every version and retained path atomically. Existing
installations must apply
`packages/db-postgres/sql/0006_soft_delete_path_liveness.sql` or
`packages/db-mysql/sql/0001_soft_delete_path_liveness.sql`; the squashed
Drizzle and CLI baselines are for fresh installations, not upgrades.

Lifecycle `ERR_PATH_CONFLICT` messages now identify the attempted operation and
state that a live document owns the requested path. Update operations report
the document's source locale rather than the configured default locale. The
error code and public details shape are unchanged.

Soft delete now retains field rows, uploaded sources, and persisted generated
variants. Source and variant paths are immutable historical references that can
be shared by versions or duplicated documents, so deletion no longer infers
ownership or removes objects from storage. `storageCleanup` was removed from
the public delete side-effect phase union; only `afterTreeChange` and
`afterDelete` remain. No supported purge or reference-safe reclamation
operation exists yet. [Issue
#72](https://github.com/Byline-CMS/bylinecms.dev/issues/72) tracks generation
recipes, provider-neutral source reads, shared-reference analysis,
regeneration, and eventual cleanup.

`IDocumentCommands` now requires
`restoreSoftDeletedDocument({ document_id })`. Both built-in adapters implement
it. Out-of-tree `IDbAdapter` implementations must add the command and atomically
reactivate every version and path row, allowing live-path conflicts to roll the
operation back. The storage primitive does not reconstruct tree placement or
search/cache projections.

Existing-document version writes now take a row-scoped document lock before
checking liveness. Concurrent saves to the same document serialize with each
other and with soft-delete/un-delete, while writes to unrelated documents
remain concurrent. A fully deleted document cannot gain a live version except
through whole-document un-delete.
