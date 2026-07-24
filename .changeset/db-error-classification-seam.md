---
"@byline/core": minor
"@byline/db-postgres": patch
---

Added a code-based `classifyError` adapter seam (`IDbAdapter.classifyError`, `DbErrorCodes`, `DbErrorClassification`) so `@byline/core` maps database failures to domain errors without inspecting driver-specific error anatomy. `rethrowPathConflict` now delegates to it; `@byline/db-postgres` implements the classifier by moving its existing `23505` + cause-walk detection behind the seam (behaviour unchanged). This is the error-side analogue of the storage `normalizeRow` seam and unblocks a second database adapter.
