---
"@byline/core": minor
"@byline/host-tanstack-start": minor
---

Classify version writes that commit before an `afterCreate`, `afterUpdate`, or singleton `afterSave` hook fails as `ERR_DOCUMENT_HOOK_COMMITTED`, including the committed document and version IDs plus the side-effect error code. Admin save flows now preserve the committed state, continue successful navigation, and show a warning instead of treating the write as uncommitted.
