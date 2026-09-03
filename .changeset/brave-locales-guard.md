---
"@byline/core": minor
"@byline/db-mysql": minor
"@byline/db-postgres": minor
---

Reject stale `previousVersionId` values with `ERR_CONFLICT`, and require the current parent for locale-scoped writes to existing versioned documents instead of silently carrying other locales forward from the wrong version.
