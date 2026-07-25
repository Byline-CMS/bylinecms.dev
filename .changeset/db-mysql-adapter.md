---
"@byline/db-mysql": minor
"@byline/db-postgres": minor
---

Added `@byline/db-mysql`, Byline's second database adapter. `mysqlAdapter()` implements
the same `IDbAdapter` contract as `@byline/db-postgres` over MySQL 8.0.14+ (InnoDB only;
the boot check rejects older servers and MariaDB) and passes the same shared
`@byline/db-conformance` suite the Postgres adapter runs, so document storage, versioning,
patches, workflow, populate, and admin auth behave identically regardless of which
database is configured. See `packages/db-mysql/README.md` for install steps, the engine
floor, and the documented differences from the Postgres adapter.

**BREAKING (`@byline/db-postgres`):** `date` and `datetime` field values now arrive as
`Date` objects instead of raw driver strings. `date` values are anchored to **UTC
midnight** for their calendar day; `datetime` values carry the full instant; `time`
values are unchanged and remain a string. This was previously undocumented raw driver
output — `packages/core/src/storage/storage-row-types.ts` already typed both columns as
`Date | string`, so code written to handle either shape is unaffected. Check any code
that reads a `date` or `datetime` field value and calls a string method on it (`.slice()`,
`.split()`, a regex) or hands it to a date-parsing library expecting a string — that code
now receives a `Date` and must be updated to use `Date` methods (or call `.toISOString()`
itself) instead. This is a `minor`, not a `major`, release: every publishable `@byline/*`
package is versioned in one lockstep group, and this change does not warrant taking all
sixteen packages to 5.0.0.
