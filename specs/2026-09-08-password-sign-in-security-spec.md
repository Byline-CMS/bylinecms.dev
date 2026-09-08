---
title: "Password sign-in security specification"
path: "password-sign-in-security-spec"
summary: "Record the approved sign-in protections and the unresolved contracts for password-change revocation and concurrent session refresh."
---

# Password sign-in security specification

Companions:

- [Implementation plan and handoff](./2026-09-08-password-sign-in-security-plan.md) contains the next actions, test matrix, environment setup, and release workflow.
- [Authentication and authorization](../docs/07-auth-and-security/01-authn-authz.md) documents the public authentication and configuration surfaces.
- [Transactions](../docs/03-architecture/03-transactions.md) describes transaction boundaries to inspect before designing atomic session mutations.

Date: 2026-09-08.

Status: step 1 is implemented and independently approved. Steps 2 and 3 are pending. This document preserves the complete workstream context for a new session on another machine; it does not select the outstanding access-token policy or authorize a production release.

## Scope and sequence

The user requested a security audit of Byline's password-based admin sign-in, from `apps/webapp/src/routes/_byline/sign-in.tsx` through the TanStack host to the provider and admin repositories, followed by implementation. CSRF protection was already enabled in `apps/webapp/src/start.ts`; do not report it as absent.

The agreed order is:

1. Bound unauthenticated work: credential/body validation, trusted client-IP resolution, shared throttling, process capacity, observability, and counter cleanup. **Complete and approved.**
2. Revoke sessions when passwords change or users are disabled. **Pending the access-token policy below.**
3. Make refresh rotation and revocation safe under ordinary concurrent browser requests and across application instances. **Pending an explicit concurrency protocol.**

Passkeys were discussed theoretically only. No passkey work belongs in these stages. Two downstream production applications are to be reviewed after this work; their identities, configurations, and deployment trust boundaries have not yet been inspected. Do not assume the reference application's proxy configuration proves either downstream deployment safe.

## Current flow by module

| Boundary | Implementation and behavior |
| --- | --- |
| Application sign-in route | `apps/webapp/src/routes/_byline/sign-in.tsx` uses the admin sign-in surface and TanStack host transport. |
| Start request middleware | `apps/webapp/src/start.ts` runs CSRF protection for server functions before `passwordSignInMiddleware`. The host middleware recognizes the compiled sign-in endpoint. |
| Body and input validation | `packages/host-tanstack-start/src/integrations/sign-in-body.ts` bounds the actual JSON stream before Start deserialization; `packages/core/src/validation/shared.ts` owns `passwordSignInSchema`. |
| Sign-in server function | `packages/host-tanstack-start/src/server-fns/auth/sign-in.ts` checks middleware coverage/configuration, resolves trusted IP, acquires local capacity, consumes shared counters, calls the provider, and releases capacity in `finally`. Cookies and best-effort locale reconciliation follow outside the slot. |
| Public contracts | `packages/auth/src/password-sign-in.ts` owns protection/limiter/IP contracts; `packages/auth/src/session-provider.ts` owns provider and token contracts. `ServerConfig.passwordSignIn` is declared in core. |
| Admission implementation | `packages/admin/src/modules/auth/sign-in-rate-limiter.ts` owns HMAC identities, network/account counters, local capacity, events, and an inert cleanup-task definition. |
| Built-in provider | `packages/admin/src/modules/auth/jwt-session-provider.ts` looks up the normalized email, verifies Argon2, resolves the actor, issues an access JWT and opaque refresh token, and persists only the refresh token's SHA-256 hash. Unknown emails still perform dummy password verification. |
| Persistence | `packages/admin/src/store.ts` bundles admin repositories; the PostgreSQL and MySQL `src/modules/admin/` factories implement them. Sign-in counters are separate from the legacy `failed_login_attempts` field. |
| Cookie transport | `packages/client/src/server/session-cookies.ts` uses the registered host bridge. Access and refresh cookies are HTTP-only, SameSite=Lax, path=/, and Secure in production. |
| Subsequent authenticated requests | `packages/client/src/server/admin-context.ts` verifies the access token; on failure/missing access it refreshes, writes cookies, verifies the replacement access token, and resolves an authenticated request context. Failures clear cookies. `oncePerRequest` memoizes within one request only. |
| Actor resolution | `packages/admin/src/modules/auth/resolve-actor.ts` rechecks whether the user exists and is enabled and resolves current permissions. Access JWTs default to 15 minutes; refresh tokens default to 30 days. |

Some existing comments describe rotation as atomic or locate the provider in an old package. Read executable code instead. The provider now lives in admin, and rotation as a whole is not yet atomic.

## Approved step 1 contract

### Input and trust boundary

- Preserve existing CSRF protection and ordering. A real Start HTTP test covers the body-marker Request identity coupling, provider reachability, body limits, and CSRF-before-body ordering.
- Accept nonempty sign-in passwords up to 128 JavaScript code units. Do not impose current password-creation complexity rules on existing credentials. Passwords are never trimmed. Email input is capped at 254 code units before trimming and lowercasing.
- Bound serialized sign-in JSON to 16 KiB and actual stream reading to five seconds. Oversized credentials fail before hashing; stream enforcement is not merely a Content-Length check.
- Client-IP resolution is explicitly configured. Header mode accepts one validated address from an operator-designated overwritten header. There is no implicit X-Forwarded-For fallback or comma-list parsing. Missing/invalid trusted identity fails closed. The reference application permits loopback fallback only in development.
- IPv4-mapped IPv6 shares the IPv4 bucket. IPv6 limiter identities use /64; session metadata retains the full normalized address.

### Admission and deliberate availability tradeoffs

The built-in password implementation uses vendored pure-JavaScript Argon2 (`packages/admin/src/modules/auth/password.ts` and `vendor/noble-argon2/`), including the unknown-account dummy path. There is no password worker pool. This unauthenticated CPU cost made admission the first priority; any previous 50–150 ms estimate is not a benchmark for the next machine.

- Shared network budget: 60 attempts/minute. Shared normalized-email-plus-network budget: 10 attempts/15 minutes. Network admission precedes account allocation.
- **There is no account-wide hard bucket.** It permitted cheap targeted lockout from an unrelated network. Refunding successful authentication cannot solve that problem because an exhausted pre-hash bucket prevents verification in the first place.
- **There is no installation-wide fixed-window bucket.** The initial 120/minute global proposal could be exhausted by one source because global consumption preceded IP denial. It is withdrawn.
- Each process has one active capacity slot, four queued requests, a 250 ms queue timeout, and a 100 ms minimum slot occupancy. Acquire capacity before counter access. Release after provider success/failure, store failure, or denial; release is idempotent and lives in `finally`.
- Full/timed-out queues and exhausted counters return 429 with Retry-After. Missing protection/middleware, invalid client identity, and store failures return 503. Provider credential errors retain the existing generic authentication behavior.
- The theoretical capacity ceiling is approximately 600 operations/minute/process, or 2,400 over four processes, before accounting for slower hashing/database work. It is intentionally per process because CPU is per process. This is neither a worker pool nor a guarantee of availability under sustained saturation.
- Every attempt that passes the relevant checks consumes counters, including successful and unknown-account attempts. Fixed windows permit boundary bursts. A distributed attacker obtains separate network budgets: 1,000 networks can receive 10,000 attempts against one account per 15-minute window, subject to capacity. Do not conceal this tradeoff or restore account-wide locking as a purported fix.

### Identity protection and observability

`createPasswordSignInLimiter(store, secret, policy?, now?, options?)` requires a shared installation secret of at least 32 bytes. HMAC-SHA-256 derives a key under `byline:password-sign-in:v1`; reference configurations supply the existing JWT installation secret. A dedicated secret is supported. Never substitute a random process-local secret: all instances must derive the same shared counter keys.

Persisted keys and emitted account/network identifiers are 64-character HMAC hex digests. Event account identity omits the network for distributed-guessing correlation; the account counter identity includes network and window. There are no plaintext passwords, emails, or IPs in these identifiers. Log/table access alone does not permit offline dictionary recovery without the secret. They remain pseudonymous and linkable, not anonymous. Rotation resets live counter identities and historical event correlation; old rows expire normally. No schema alteration was necessary for HMAC.

`onEvent` receives admission, denials, capacity shedding, store/cleanup errors, and verification outcomes. Hook failures cannot alter authentication outcomes. Without a hook, diagnostics are sampled by event type. This is an instrumentation seam and fallback logging, not a deployed cross-instance alerting service. Wire downstream monitoring during deployment review.

### Counter storage and cleanup

- PostgreSQL counter consumption uses an atomic upsert with RETURNING. MySQL uses a transaction containing upsert and locked read.
- MySQL retries only confirmed InnoDB deadlock victims (errno 1213, including bounded cause-chain lookup), at most three total attempts with jitter. Do not broaden this to lock wait timeout 1205, arbitrary SQLSTATE values, connection loss, or uncertain commit outcomes.
- Keep request-driven purge: each admitted request removes up to 100 eligible rows and creates at most two. Its cleanup allowance scales with traffic/process count; it does not depend on a manually configured number of replicas.
- The limiter starts **no background timer or database work on construction**. `cleanupTask` exposes `auth.sign-in-counters.cleanup` with a 60-second interval and lease. It drains up to 32 batches of 100, checks abort, renews the lease between batches, returns `workRemaining` at the budget limit, and rethrows errors for scheduler health/backoff.
- The scheduler coordinates the idle-backlog drain across instances. Its 3,200-row allowance is per task run for the installation, not per process. It complements the retained request-driven cleanup; do not remove both self-scaling request cleanup and the former per-process timer.
- Rows become eligible five minutes after their window expires. Cleanup latency changes storage retention only; window-scoped keys determine admission independently of deletion. No absolute database-size or exact residency guarantee is claimed during outages, churn, suspension, or custom policies.
- `requiredCleanupTask` is optional in the public limiter contract. The built-in limiter names its required task, and core boot rejects missing registration or an incapable scheduler adapter. Native-TTL custom limiters may omit the requirement.
- Boot proves registration, not execution. `apps/webapp/src/server.ts` starts the scheduler; CLI host wiring now also installs startup and preserves existing aliased startup calls. External runners must call `runDueTasks(core)` where the process cannot keep running. Check task health after deployment. Configuration imports must not start the cleanup runner.

## Step 2: unresolved policy and required behavior

### Decision D2-A: outstanding access JWTs

**The user has not selected either policy. Ask before changing token claims or implementing dependent behavior.**

| Choice | Required behavior and implementation implications |
| --- | --- |
| Immediate invalidation | After a successful password change/reset, subsequent access-token verification rejects tokens from the previous credential/session generation. Introduce and atomically advance an account session version, or design a password-changed-at comparison with explicit timestamp precision and same-second issuance rules. Check it in `verifyAccessToken` and consistently fence refresh/initial issuance. Plan database migration, legacy-token handling, and coordinated rollout. |
| Bounded access window | Revoke all refresh sessions while allowing already-issued access JWTs to expire, normally within 15 minutes. No new JWT claim is inherently required. This is an explicit residual-access policy, not immediate sign-out. Atomic refresh/revocation ordering is still required; merely calling `revokeAllForUser` does not fix in-flight issuance races. |

Immediate invalidation means checks performed after the revoking transaction commits. It cannot retroactively cancel an operation already authorized with a request-scoped actor snapshot. Document that boundary.

Also settle whether the changing user's current session is revoked or securely replaced. The old self-service comment proposes `revokeAllExcept(adminUserId, currentJti)` but that method does not exist, and the JWT jti must not be assumed to identify a refresh row. Do not use the comment as an approved product decision. A proposed simple default is revocation of all refresh sessions and explicit reauthentication; this remains a proposal until the user selects the UX.

### Required paths and invariants

- Cover self-service `AdminAccountService.changePassword` and administrator-driven `AdminUsersService.setPassword`, including all commands and host callers. Both currently only change the password hash.
- Cover `AdminUsersService.disableUser`. Access verification currently rejects disabled accounts, but refresh does not recheck enabled state. Without revocation, re-enabling an account can restore its refresh chain within the 30-day lifetime.
- Clarify old access JWT behavior on disable/re-enable too. Revoking refresh sessions alone still leaves an unexpired access JWT usable after re-enable under the bounded-access policy. Do not claim that all old credentials remain invalid after re-enable unless the selected design enforces it.
- Hard deletion already cascades refresh rows in both schemas. The earlier request for explicit delete-user revocation was withdrawn; do not add redundant calls.
- `RefreshTokensRepository.revokeAllForUser` already exists in the interface and both adapters and is unused by these flows. Reuse it where its semantics suffice, but coordinate it transactionally with the account mutation and token issuance.
- Preserve current-password verification, creation complexity validation, authorization, self-disable/delete safeguards, optimistic `vid` checks, response sanitization, and error behavior.
- Account mutation and its revocation effects must not partially commit. Introduce an adapter-supported transaction/fencing seam if required; `AdminStore` currently exposes repository objects, not a general transaction method.
- Refresh/initial login that verified old state must not issue a surviving session after password change/disable has committed. A shared account lock, generation fence, or equivalent ordering protocol must cover every participant. Hashing should not unnecessarily hold database locks; revalidate observed state before issuance.
- Treat the transaction/issuance ordering work as shared infrastructure with step 3. If any race remains until step 3, document it as pending and do not call step 2 fully secure or releasable.
- Preserve provider abstraction. Native JWT repositories do not automatically revoke third-party provider sessions. Define an honest capability/policy boundary rather than silently claiming equivalent guarantees for every `SessionProvider`.

## Step 3: concurrency and replay contract to design

The current provider finds a refresh row, inserts a successor, and then marks its predecessor rotated. Both adapters' `markRotated` lack a revoked-at-is-null condition. Concurrent consumers can create siblings; only one is reachable through the stored pointer. Replay-driven `revokeChain` can miss the orphan. The walk also has a 1,000-step ceiling.

The original audit reproduced this deterministically in memory. Both adapters were source-reviewed; this is not proof that a live MySQL race was reproduced. Parallel admin loaders make concurrent refresh reachable during ordinary use. Per-request memoization is not cross-request coordination. The earlier assertion that every administrator is logged out exactly every 15 minutes was withdrawn; the interleaving matters.

Required properties:

1. One accepted predecessor rotation produces one committed successor. No orphan/partially committed successor survives a conflict, rollback, or revocation.
2. Define what ordinary concurrent requests using the same browser cookie receive. A strict compare-and-swap alone can turn valid concurrent traffic into replay-triggered logout. The current client clears cookies on failures, so loser responses and response ordering are part of the protocol.
3. Hash-only refresh storage is retained unless the user explicitly approves a different security model. “Return the already-issued successor during a grace window” is not presently implementable: only its hash is stored. A shared plaintext cache adds machinery and plaintext-at-rest exposure and is **not approved**. Process-local coordination alone does not cover multiple instances.
4. Define bounded replay tolerance, expiration, and detection separately from benign concurrency. A family identifier is not automatically necessary, but compare-and-swap alone does not order rotation against account-wide revocation or logout.
5. Password mutation/disable/logout that races refresh must leave no unauthorized surviving successor. Include sign-in-versus-account-mutation ordering, not only refresh-versus-refresh.
6. Resolve whether logout with an already-rotated token revokes its live descendant. The current `revokeSession` revokes only the presented row; test the selected lineage semantics explicitly.
7. Define response-cookie ordering and browser retry behavior. A late failure must not erase the winner's new session, and a late older success must not roll cookies back.
8. Replace or safely handle the 1,000-step chain ceiling. Do not silently leave descendants active and report complete revocation.
9. Use transactions and conditional mutations supported by both adapters. Inspect foreign-key order before choosing mark-then-insert versus insert-then-mark; atomicity means the transaction as a whole, not one UPDATE.

Before implementation, record the selected protocol, lock order, rollback/retry behavior, and cookie response outcomes in the plan and obtain review. Do not adopt a family id, plaintext grace cache, timestamp claim, or strict loser rejection by assumption.

## Withdrawn findings and evidence limits

The telemetry POST route is outside the server-function CSRF filter, but has its own public-domain allowlist and bounded body handling. It is not an unresolved password sign-in finding. Its `readBoundedBody` is private; the sign-in implementation follows its pattern rather than importing it.

Direct live CSRF/sign-in checks were performed on the original machine, including 403 cross-site rejection, 413 body rejection, 400 oversized credentials, limiter 429, successful credential sign-in, HTTP-only cookies, and sign-out. Credentials and temporary scripts are not committed. The reproducible committed Start fixture substitutes application services and tests actual HTTP transport; it is not a full real-password/database login test.

Independent review has explicitly approved step 1, including its scheduler and HMAC revisions. Do not reopen deliberate tradeoffs as bugs without new evidence. Steps 2 and 3, multi-instance refresh semantics, downstream proxy/WAF configuration, and final release baseline reconciliation remain outstanding.
