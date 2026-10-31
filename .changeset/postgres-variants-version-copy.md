---
"@byline/db-postgres": patch
---

Fix image variants being dropped from versions created by deleting a content
locale (`deleteDocumentLocale`) or re-anchoring a document (`reAnchorDocument`)
on PostgreSQL. The adapter's hand-written version-copy statements listed the
file columns without `variants`, so the new version's image fields lost their
generated variants. The copies now carry `variants`. MySQL was not affected.
