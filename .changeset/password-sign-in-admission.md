---
"@byline/admin": major
"@byline/auth": major
"@byline/core": major
"@byline/host-tanstack-start": major
"@byline/db-postgres": major
"@byline/db-mysql": major
"@byline/cli": major
---

Require pre-verification protection for TanStack password sign-in. Existing installations must configure it before deploying this release; missing protection fails closed with HTTP 503. Custom admin stores must implement `signInRateLimits` and custom limiters must implement capacity acquisition as well as counter admission.

Upgrade in this order:

1. Apply `packages/db-postgres/sql/0011_add-sign-in-rate-limits.sql` or `packages/db-mysql/sql/0006_add-sign-in-rate-limits.sql` to the production database. The Postgres script includes the deployment ownership guard.
2. Register `passwordSignInMiddleware` after CSRF middleware in `src/start.ts`. Configure `ServerConfig.passwordSignIn` with a process-singleton `createPasswordSignInLimiter(adminStore.signInRateLimits, signingSecret)` and an explicitly trusted client-IP resolver. Proxy header mode accepts a single overwritten address, never an address list or fallback chain.
3. Register the returned limiter's `cleanupTask` in `recurringTasks` and start `startBylineScheduler(core)` from the host server entry, or arrange external `runDueTasks(core)` execution. Boot rejects missing required cleanup-task registration; it cannot prove that the runner is executing. Verify task health after deployment. Config imports remain inert.
4. Wire limiter `onEvent` monitoring, verify proxy resolution, keep the HMAC secret consistent across instances, and deploy the application. See the password sign-in protection section in `docs/07-auth-and-security/01-authn-authz.md` for capacity defaults and distributed-guessing tradeoffs.

The release maintainer must squash development Drizzle migrations, repair development journals, synchronize CLI migration baselines, and rerun baseline checks before publishing. Incremental Drizzle scripts are not production SQL release scripts.

Counter and event identifiers now use domain-separated HMAC-SHA-256. Reusing the JWT installation secret is supported. Changing the secret resets live budgets and event correlation; existing rows expire normally. The per-process capacity ceiling is approximately 600 operations/minute (2,400 across four processes), subject to hashing and database latency.

Native session revocation adds account and refresh `session_version` columns and the access JWT `sv` claim. Stop every old instance, apply PostgreSQL `0012_add-session-generations.sql` or MySQL `0007_add-session-generations.sql`, then restart all instances together. Existing access and refresh credentials require fresh sign-in. Password changes/resets and disablement atomically invalidate native sessions; re-enable never revives them. Custom admin stores must implement the transactional `withSessionLock` contract and mutation revocation, and custom identity providers remain responsible for their own sessions. Step-3 concurrent-refresh/cookie behavior is still pending; do not treat step 2 as completion of that protocol.

**Release blocker:** step 2 now serializes concurrent refreshes, but the loser treats the predecessor as replay and revokes the winner's successor. Ordinary parallel requests can therefore lose the browser session. Independent review approved revocation semantics only; R2 remains open and these changes are not independently releasable before the D3 concurrency/cookie protocol fixes this known regression. Refresh issuance now requires explicit `session_version` input; missing or malformed input also throws at runtime.
