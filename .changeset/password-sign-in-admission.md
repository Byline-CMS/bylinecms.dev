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
