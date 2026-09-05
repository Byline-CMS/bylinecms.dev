---
"@byline/admin": major
"@byline/cli": major
"@byline/client": major
"@byline/core": major
"@byline/db-mysql": major
"@byline/db-postgres": major
"@byline/host-tanstack-start": major
"@byline/i18n": major
---

Require document-wide optimistic-concurrency observations for every existing-document mutation. Editable SDK reads now return a document revision, successful mutations return the next revision, and stale or missing observations fail closed across core, both database providers, the SDK, and the TanStack host.

The admin editor retains unsaved work after a conflict, blocks further mutations, and requires an explicit reload-and-discard action. Metadata and structural changes participate in the same revision contract, and affected scheduled publications require reconfirmation.

Existing PostgreSQL and MySQL installations must use the provider-specific fenced cutover runbooks and numbered native SQL upgrades before starting the new packages. Rolling mixed-version writers and rollback to an old writer after reopening writes are unsupported. The CLI includes synchronized fresh-install baselines for new databases; package installation does not update copied maintenance scripts in an existing application.
