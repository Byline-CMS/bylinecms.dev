---
"@byline/admin": major
"@byline/auth": major
"@byline/core": major
"@byline/client": major
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

Native session revocation adds account and refresh `session_version` columns and the access JWT `sv` claim. Stop every old instance, apply PostgreSQL `0012_add-session-generations.sql` or MySQL `0007_add-session-generations.sql`, then restart all instances together. Existing access and refresh credentials require fresh sign-in. Password changes/resets and disablement atomically invalidate native sessions; re-enable never revives them. Custom admin stores must implement the transactional `withSessionLock` contract and mutation revocation, and custom identity providers remain responsible for their own sessions. The coordinated renewal and login-identity boundary below complete the implementation scope; combined R2/R3 review is approved.

**Approved residual:** strict replay still revokes the winning successor if a refresh contest escapes coordination. The host now coordinates ordinary parallel requests, and the user accepted fresh sign-in for residual contests. Combined R2/R3 review is approved; ship the generation and login protocol changes together. Refresh issuance requires explicit `session_version` input; missing or malformed input throws at runtime.

JWT sessions now carry a stable native login identity (`sid`). Access verification checks account generation and login validity; logout and replay revoke that login immediately without traversing refresh chains. Ordinary requests no longer rotate credentials. The host uses explicit coordinated renewal, checks expected login identity before business handlers, and requires acknowledgement when the active login changes. Logout failures are reported rather than silently treated as success.

Combined-release cutover: apply both generation and login-state migrations during one stopped-instance upgrade and require fresh sign-in once. Legacy credentials missing `sv` or `sid` fail closed; there are not two user-facing upgrades. Sliding refresh expiry and persistent sign-in survive normal browser restarts. No absolute monthly lifetime is introduced.

Custom session providers must return a stable `sessionId` from issuance and verification, accept observed access/refresh credentials through `RevokeSessionArgs`, honor expected identity during renewal/logout, and distinguish access expiry from other errors. Hosts must register `sessionRequestMiddleware` after CSRF protection. Native login persistence stays behind the provider interface. Combined R2/R3 review is approved. Release still requires migration-baseline synchronization, final build/gates, downstream review, and the coordinated cutover.
