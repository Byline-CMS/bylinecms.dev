---
"@byline/core": minor
"@byline/db-postgres": minor
---

threaded the document's canonical (source-locale) `path` into the write-side
collection hook contexts — `afterCreate`, `afterUpdate`, `beforeUnpublish` /
`afterUnpublish`, `beforeDelete` / `afterDelete`, and `beforeStatusChange` /
`afterStatusChange` now carry `path` so cache-invalidation, CDN-purge, webhook,
and search-reindex hooks can act on the specific document/URL instead of
invalidating the whole collection. Added a narrow `getCurrentPath` storage query
(reusing the existing source-locale path projection) to back it. Additive and
backward-compatible; `beforeCreate` stays path-free because the path is not
resolved until after it runs.
