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

Status: steps 1, 2, and 3 are approved. Independent combined R2/R3 review accepted the revocation semantics, login membership, coordination protocol, and pre-handler retry boundary. Release preparation remains outstanding; review approval is not production-release authorization.

## Combined R2/R3 approval (2026-09-08)

Independent combined review approved R2 and R3 after reproducing 358/358 unfiltered conformance tests on each adapter, host/admin/app suites, typechecking, documentation checks, and an anonymous HTTP 200. Earlier pending design and review language below is historical and is superseded by this approval. The [plan's approval ledger](./2026-09-08-password-sign-in-security-plan.md) separates release prerequisites from two non-blocking follow-ups: batched login-row cleanup and a clarification of idempotent logout.

The [implementation evidence](./2026-09-08-password-sign-in-security-plan.md#implementation-evidence-2026-09-08) records completed code, tests, query measurements, and the remaining browser acceptance limits.

## Approved cookie residual and implementation authorization

Tony approved detection of the overlapping cross-account sign-in residual and authorized task 3 implementation. The cookie design gate is closed on this basis; do not start another comparison round or introduce browser binding state.

- Successful sign-in atomically revokes native logins identified by verified credentials observed on that request, including account switches. Revocation failure fails sign-in closed; unrelated device logins survive.
- Every authenticated business operation carries the page's expected login identity, not merely retries. The server compares it to verified current login identity before starting the handler. Mismatch rejects without side effects or automatic replay.
- The browser retains the login expected from successful sign-in and the page's current login identity. A mismatch with server-reported identity blocks further work behind an explicit session-changed interstitial requiring acknowledgement. Initial post-sign-in navigation is covered; merely displaying the current account name is insufficient.
- Acknowledgement discards queued old-login work and adopts freshly verified identity. It does not replay rejected edits. Same-account new logins also change sid and require this treatment.
- Stage B sends token-free cross-tab notifications and may serialize sign-in with Web Locks. Notifications and cooperative locks are aids, not the server enforcement boundary.
- The residual is a credential overwrite that is detected before further work, not a guarantee of physical cookie ordering. Password and CSRF requirements constrain the known scenario; no universal claim that it is attacker-unreachable is made.
- Reopen review if intentional concurrent multi-account admin sessions become supported or an attacker-driven path is found. A prevention mechanism requiring browser-scoped state would need separate explicit approval.

JWT credentials, persistent sign-in, D2 and per-login revocation remain selected. No Playwright. Both-adapter tests and local query-cost measurements are recorded in the implementation plan. Combined R2/R3 acceptance is now recorded above; release preparation remains separate.

## Native expiry classification

Access JWT expiry reports `ERR_ACCESS_EXPIRED` for the pre-handler renewal boundary. An otherwise valid native login whose refresh credential or login expiry has elapsed reports `ERR_INVALID_TOKEN` with `refresh token expired`. Explicit revocation and replay are checked first and continue to report `ERR_REVOKED_TOKEN`, including when the credential has also aged out. Missing login state and account generation mismatches remain revocation failures; expiry does not restore authority.

## Public reads and retry body handling

The preview-state cookie query is public and does not require an admin session. Anonymous public layouts must return successfully without credentials; cookie state alone never grants draft access. Business admin operations retain the pre-handler authentication and expected-sid boundary.

Automatic resend re-serializes reusable BodyInit values, including FormData/Blob, without cloning or teeing a Request body. Caller-supplied Request objects and one-shot streams require an explicit retry after renewal. This avoids retaining an unread branch of an upload solely for a possible retry.

## Current architectural boundary

Tony selected retaining JWT access tokens and refresh tokens, with persistent sign-in and a session-provider boundary suitable for future IAM integration. An opaque database-session replacement is not selected. Native JWT verification may consult revocation state: approved immediate account and login invalidation require checking both `sv` and login validity. Keep those native checks and persistence details behind the provider contract; do not require a future external IAM provider to share the native login table. Review existing provider contracts before adding capabilities, and document any compatibility change explicitly.

The selected D3 direction is explicit, coordinated renewal. A normal browser restart must preserve sign-in when retained refresh credentials are valid. Strict refresh replay handling remains selected, with fresh sign-in accepted for contests escaping coordination. Immediate revocation, cookie deletion, and browser response ordering are separate guarantees: cookie deletion stops the browser sending its current copy; revocation rejects other copies after commit; neither orders later cookie writes.

**Counterexample addressed by the approved detection residual:** overlapping cross-account sign-ins can create two live logins, and a late response can replace the newer credentials with the older live account's credentials. Observed-login revocation alone only partially addresses it. The approved expected-sid boundary and acknowledgement interstitial handle the remaining case; no new browser-state prevention protocol is selected.

### Reference approaches and their limits

- [Auth.js refresh-token rotation guidance](https://authjs.dev/guides/refresh-token-rotation) explicitly identifies concurrent single-use refresh races and discusses locking or background renewal. This supports making renewal explicit and coordinated; its OAuth examples are not a complete native-password or account-switch protocol.
- [Auth0 rotation configuration](https://auth0.com/docs/secure/tokens/refresh-tokens/configure-refresh-token-rotation) offers an overlap period to accommodate concurrent exchanges. That is a different replay tradeoff, not an approved setting for Byline. Do not introduce grace merely to copy the reference.
- [RFC 6265, section 4.1](https://www.rfc-editor.org/rfc/rfc6265.html#section-4.1) identifies races between concurrent Set-Cookie responses. Server transaction order does not by itself order browser cookie replacement.

Use these references to compare concrete JWT-compatible protocols against the response-order cases below. None establishes that the proposed cookie gate is already solved. Maintaining a provider abstraction also does not, on its own, resolve browser transport races.

### Alternatives and experiments are not requirements

The session-only binding draft is withdrawn because it reduces restart persistence. Opaque database sessions were considered and declined. The isolated browser-marker/IndexedDB models under `specs/experiments/password-session-ordering/` are unapproved experiments: they rely on abstract serialization and do not establish browser transaction, crash, eviction, or storage-failure behavior. Do not promote the marker into this protocol without a concrete scope proposal and review.

The receipt candidate remains historical technical material for possible reconsideration after measured coordination residuals. Its storage, versioned cookie names, signed selector, recovery document/CSP, receipt retry loop, and absolute lifetime are not part of the selected scope. A single pre-handler-safe business resend remains part of the coordination proposal.

No Playwright testing is permitted for this work. Browser validation remains required for eventual implementation, using an agreed alternative harness; isolated Node models are not browser acceptance evidence.

## Scope and sequence

The user requested a security audit of Byline's password-based admin sign-in, from `apps/webapp/src/routes/_byline/sign-in.tsx` through the TanStack host to the provider and admin repositories, followed by implementation. CSRF protection was already enabled in `apps/webapp/src/start.ts`; do not report it as absent.

The agreed order is:

1. Bound unauthenticated work: credential/body validation, trusted client-IP resolution, shared throttling, process capacity, observability, and counter cleanup. **Complete and approved.**
2. Revoke sessions when passwords change or users are disabled. **Revocation semantics approved; R2 blocked by concurrent-refresh regression.**
3. Make refresh rotation and revocation safe under ordinary concurrent browser requests and across application instances. **Implemented; combined R2/R3 review remains pending.**

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

## Step 2: selected policy and required behavior

### Decision D2-A: outstanding access JWTs

**Selected in the resumed session:** immediate invalidation, fresh sign-in after self-service password change, and no revival of old access or refresh sessions after re-enable.

The implementation uses integer `session_version` on accounts (initially 0) and refresh rows (legacy default -1), and the access JWT claim `sv`. Password writes and every disable write, including `update({ is_enabled: false })`, advance the account generation and revoke refresh rows in one transaction. `vid` remains a separate edit revision. Re-enable preserves the advanced generation. Failed writes roll back both changes.

`AdminStore.withSessionLock` locks the account row with `SELECT ... FOR UPDATE` before any transaction snapshot read. Sign-in hashes/verifies outside the lock and compares the observed password hash and generation after acquiring it. Refresh rereads its row under the same account lock and requires an enabled account and matching generation. Account mutation locks the account through its guarded UPDATE before touching refresh rows. Issuance and rotation writes share the lock transaction. There are no automatic transaction retries; ambiguous commits are not retried.

Access verification rejects missing, malformed, negative, or nonmatching generations. Existing access JWTs and refresh rows require fresh sign-in on rollout. Stop all old instances before migration and restart every instance with the new provider; mixed deployments retain old writers/verifiers and cannot enforce this policy. No plaintext refresh storage is added.

The host clears session and preview cookies only after a successful self-service change. The form shows persistent confirmation and a Sign in button; that button reloads the protected page to reach the host's configured sign-in route. Already-authorized requests are not retroactively cancelled. Third-party identity-provider sessions remain the provider's responsibility; native repository revocation does not revoke an external session.

Step 3 remains open: bringing rotation into the account transaction is necessary for step 2, but the existing strict replay outcome and cookie races are not an approved benign-concurrency protocol. Logout lineage and the 1,000-row traversal ceiling remain step-3 work.

The following table preserves the alternatives considered:

| Choice | Required behavior and implementation implications |
| --- | --- |
| Immediate invalidation | After a successful password change/reset, subsequent access-token verification rejects tokens from the previous credential/session generation. Introduce and atomically advance an account session version, or design a password-changed-at comparison with explicit timestamp precision and same-second issuance rules. Check it in `verifyAccessToken` and consistently fence refresh/initial issuance. Plan database migration, legacy-token handling, and coordinated rollout. |
| Bounded access window | Revoke all refresh sessions while allowing already-issued access JWTs to expire, normally within 15 minutes. No new JWT claim is inherently required. This is an explicit residual-access policy, not immediate sign-out. Atomic refresh/revocation ordering is still required; merely calling `revokeAllForUser` does not fix in-flight issuance races. |

Immediate invalidation means checks performed after the revoking transaction commits. It cannot retroactively cancel an operation already authorized with a request-scoped actor snapshot. Document that boundary.

D2-B revokes the changing session and requires fresh sign-in. The old self-service comment proposes `revokeAllExcept(adminUserId, currentJti)` but that method does not exist, and the JWT jti must not be assumed to identify a refresh row. Do not use the comment as an approved product decision. The user selected revocation of all refresh sessions and explicit reauthentication.

### Required paths and invariants

- Cover self-service `AdminAccountService.changePassword` and administrator-driven `AdminUsersService.setPassword`, including all commands and host callers. Both now use the atomic password-generation/revocation write.
- Cover `AdminUsersService.disableUser`. Access and refresh now reject disabled accounts. Disablement advances the generation and revokes refresh rows, so re-enabling cannot restore old sessions.
- Clarify old access JWT behavior on disable/re-enable too. Revoking refresh sessions alone still leaves an unexpired access JWT usable after re-enable under the bounded-access policy. Do not claim that all old credentials remain invalid after re-enable unless the selected design enforces it.
- Hard deletion already cascades refresh rows in both schemas. The earlier request for explicit delete-user revocation was withdrawn; do not add redundant calls.
- `RefreshTokensRepository.revokeAllForUser` is reused by native password and disable transactions. Keep its account-first ordering consistent with token issuance.
- Preserve current-password verification, creation complexity validation, authorization, self-disable/delete safeguards, optimistic `vid` checks, response sanitization, and error behavior.
- Account mutation and its revocation effects must not partially commit. `AdminStore.withSessionLock` now exposes the account-scoped transaction boundary for issuance.
- Refresh/initial login that verified old state must not issue a surviving session after password change/disable has committed. A shared account lock, generation fence, or equivalent ordering protocol must cover every participant. Hashing should not unnecessarily hold database locks; revalidate observed state before issuance.
- Treat the transaction/issuance ordering work as shared infrastructure with step 3. If any race remains until step 3, document it as pending and do not call step 2 fully secure or releasable.
- Preserve provider abstraction. Native JWT repositories do not automatically revoke third-party provider sessions. Define an honest capability/policy boundary rather than silently claiming equivalent guarantees for every `SessionProvider`.

## Blocking R2 regression and step 3 concurrency protocol

**Independent review rejected step 2 as a whole.** With two refreshes of the same browser cookie, the account lock lets one issue a successor. The loser then rereads the rotated predecessor and calls `revokeChain`, revoking that successor. There are zero active refresh rows and the winner cannot refresh again. Before the lock, overlapping readers could both succeed and leave orphan siblings; step 2 turns that integrity race into deterministic loss of refresh continuity for this ordinary concurrent interleaving. Host failures can also clear the winner's cookies. This is a known regression, not merely unchanged pending work.

The selected review exit keeps the R2 checkpoint open and prohibits treating step 2 as independently releasable. The permanent `KNOWN REGRESSION R2/D3` test in the shared adapter conformance suite characterizes the defect. Passing that test is evidence of the defect, not approval of the behavior. D3 must select the benign-loser, replay, and cookie protocol before the implementation is changed. No tolerance window or cache has been approved.

### Remaining step 3 design


Before step 2, the provider inserted a successor and marked its predecessor in separate operations, allowing sibling rows. Step 2 brings those operations under one account-lock transaction and rereads the predecessor there. `markRotated` remains a low-level mutation requiring that lock; it is not independently a compare-and-swap. Strict replay behavior remains, historical orphan compatibility remains to be designed, and the chain walk still has a 1,000-step ceiling.

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

## Selected D3 scope: coordination-first

**Tony explicitly accepted on 2026-09-08 that refresh collisions which escape coordination may require fresh sign-in.** Coordination-first is the preferred scope to develop. This selects the availability tradeoff, not implementation or release approval. Strict server replay detection remains; no grace, receipts, cookie namespace change, or absolute lifetime change is selected. Preserve sliding refresh expiry and approved D2 account-wide invalidation.

### Persistent sign-in requirement

Tony explicitly prefers the existing persistent sign-in experience. With retained, valid refresh credentials, a normal browser restart must not itself require entering credentials again. Preserve the sliding refresh lifetime. No new browser-session-only prerequisite, monthly absolute expiry, or other shorter binding lifetime may silently defeat valid refresh credentials.

This requirement does not prevent explicit logout, detected replay, password change/reset, disablement, refresh expiry, or the accepted collision fallback from requiring sign-in. Clearing or losing credentials still prevents recovery. Cookie ordering must be resolved within these requirements; the browser-session binding draft below is withdrawn, and no replacement cookie protocol has been selected. Persistent browser identification, if proposed later, needs its own complete renewal and late-response analysis rather than merely changing Max-Age in the withdrawn design.

### Scope after the immediate per-login decision

Coordination-first now includes three pieces previously costed under the receipt candidate: **a persistent login record with an unpredictable sid, a sid claim on access tokens, and a login-state check on every access verification**. Refresh rows also carry sid membership so any predecessor identifies the login. These are proposed implementation mechanisms for the approved immediate-invalidation policy, not existing runtime behavior.

Still excluded: receipts and their table, versioned credential cookie names, the signed selector, the special SSR receipt-recovery document and its CSP integration, the multi-attempt receipt acknowledgement loop, and a 30-day absolute lifetime. Sliding refresh expiry survives. The existing-route browser bootstrap and a single resend after a pre-handler refresh-required outcome remain in the coordination proposal; calling the receipt retry loop excluded must not accidentally remove that necessary renewal/resend flow.

**Neither account nor login validity overrides the other.** A failure of either rejects. `sv` checks the account-wide generation; `sid` checks this login's ownership, generation, validity, and revocation. Password change/reset/disable remain account-wide; logout and replay are login-scoped.

Login membership removes the traversal ceiling from authorization: revoking the login denies all its access tokens and refresh descendants without walking `rotated_to_id`. This designs out required property #8's 1,000-row cutoff; it is not yet an implemented or tested fix. Physical token cleanup can be batched without delaying denial. Logout with a rotated predecessor resolves its sid and reports success only after confirmed revocation; a database failure must not be swallowed as `{ status: 'ok' }`.

The benchmark obligation follows this state into coordination-first. Before approving the implementation design, compare the existing account-plus-permissions path with the proposed account-plus-login-plus-permissions path on both adapters. Use an isolated query prototype with representative active/revoked login counts and concurrent renewal/revocation, report query plans and p50/p95/p99 latency/throughput, and agree on the acceptable cost from evidence. There is no receipt-table check in this benchmark. No such benchmark has run yet.

For a single combined release, the new `sv` and `sid` requirements produce **one coordinated fresh-sign-in cutover**, not two user-facing upgrades. Stop old instances, apply all selected migrations, and start the complete new provider. Legacy credentials missing either claim fail closed. The sid migration is not implemented yet; do not imply the current session-generation SQL scripts create login state.

### Proposed request protocol

Move refresh out of business requests. `getAdminRequestContext()` becomes verification-only: it reads the access credential, checks the provider, and returns the memoized request context or an authentication outcome. It never rotates, writes, or clears session cookies. Distinguish expired/missing access eligible for a refresh attempt from disabled accounts, revoked generations, malformed credentials, and unavailable dependencies. A database error is a service error, not an invitation to rotate.

Add a dedicated CSRF-protected POST session-renewal endpoint. Under the browser coordinator it first verifies the cookies on **this new request**. If access is already valid, return success without rotation or cookie writes; another request/tab may have renewed while this caller waited. Otherwise invoke native atomic refresh exactly once if eligible, verify the result, and write credentials only on confirmed success. Return no raw tokens to browser JavaScript. Unknown, revoked, expired refresh credentials and replay are terminal; ambiguous commit or database failure returns a service error without cookie writes or automatic renewal retry.

Place a mandatory authentication middleware/wrapper before protected business handlers. Only this boundary can issue the transport's refresh-required, **handler-not-started** outcome. The browser wrapper may renew and resend an operation once only after that outcome. Handler errors, ordinary 401s, network timeouts, and wrapped arbitrary exceptions must never acquire this retry marker. Once the middleware calls the handler, no later error is automatically retryable. Permission checks and request-context reuse remain inside the normal lifecycle.

This makes retry safety structural for handlers using the boundary: the retryable response proves the business handler did not run. It still requires a coverage check that every protected entry point actually uses the boundary and that no business side effect precedes it. Validators and earlier middleware must be side-effect-free with respect to the business operation. Upload transports or other paths that cannot establish this boundary get explicit retry UI, not automatic replay. The current arrangement of calling `getAdminRequestContext()` somewhere inside each handler is not itself that structural guarantee.

### Stage A: same-tab coordination

Use one module-level in-flight renewal promise in the browser transport shared by all admin consumers in a page. Concurrent callers await it; clear it in `finally` only if it is still the current promise. Do not put this promise in server module state. Establish one browser module instance through the public transport facade rather than creating a coordinator per hook/component. No Web Locks support is required for this stage.

Each operation captures the page's session-change epoch and actor identity. Sign-in, logout, and password-change UI invalidate that epoch, cancel queued work, and prevent an old operation from automatically resuming in the new session. After successful renewal, resume only callers still in the same epoch. The host design must also identify same-session retries across tabs; account identity alone is insufficient because two sign-ins can belong to the same account. Use the proposed native login identity `sid` described below to bind retries to the original login; reject a different sid before the handler runs, even when the account is unchanged.

Serialize the page's explicit cookie-writing authentication actions with renewal. A new sign-in or logout waits for an in-flight renewal response before dispatch; queued business operations do not resume across that action. Do not abort renewal, release the queue, and assume its server response cannot arrive later. On uncertain network completion, show a recoverable session error rather than automatically dispatching another cookie-writing action as though ordering were established.

Ordinary business operations remain concurrent once authenticated. The coordinator serializes renewal/authentication actions, not all reads and writes. A stale refresh-required response can arrive after the first renewal promise settled; the renewal endpoint's access-valid no-op prevents it from needlessly rotating again.

### Stage B: cross-tab coordination

Add Web Locks around the same renewal/authentication queue when supported. After acquiring the lock, use the dedicated endpoint to check current cookies before considering rotation. Keep the same-tab promise as the fallback when Web Locks is unavailable. Do not delay Stage A development or require Web Locks to sign in. BroadcastChannel may notify other tabs that authentication changed and invalidate queued actions; it does not carry tokens or provide mutual exclusion.

A lock lost through navigation, closure, or process failure does not roll back a dispatched server request. Unsupported or nonparticipating contexts can still contest; strict replay revokes renewal and the user may need to sign in, as Tony accepted. Measure these outcomes. Cross-tab coordination is a subsequent development stage, not a reason to label the server safe based on client cooperation.

### SSR and public-page behavior

SSR and public soft-auth reads do not rotate. A valid access credential permits ordinary SSR. An anonymous public request remains anonymous and writes no cookies. An expired access credential on an admin navigation uses the existing sign-in/bootstrap route with a validated same-origin admin return destination. Its browser bootstrap invokes the same coordinator before showing the password form; a successful renewal performs one replacement navigation. A per-navigation non-secret attempt guard prevents loops. Terminal failure shows sign-in, and service failure shows retry UI without submitting credentials automatically.

This uses the ordinary application bootstrap, not a new HTML document carrying recovery receipts or a new inline recovery script. Without JavaScript, there is no automatic expired-access renewal under this proposed SSR design; show a sign-in explanation. This limitation must be reviewed for the supported admin browser contract. An SSR request cannot hold a browser lock; removing SSR rotation is what prevents it from competing with browser renewal. Two bootstrapping tabs are handled by Stage B or the accepted strict fallback.

### Server revocation and cookies still required

Keep account-first transactional issuance/rotation. Under that lock, a reused rotated predecessor revokes the affected refresh lineage before reporting the error. Logout must revoke from any known member, including a rotated predecessor, cover all related live descendants/siblings supported by legacy data, and commit before reporting success. Remove the 1,000-row silent cutoff. With the selected immediate per-login policy, prefer the sid-backed login record described below so revocation has constant traversal depth. The earlier schema-preserving traversal option is superseded for this design. Physical cleanup may be batched, but authorization must not depend on completing it.

Do not clear shared fixed-name cookies on authentication or renewal failure. Do not swallow logout database errors. Confirmed explicit logout/password-change cookie handling must still be designed together with successful renewal/sign-in responses. Same-tab serialization covers participating writers; Web Locks extends that coverage. Neither prevents arbitrary late responses from a context that lost its lock.

**Open cookie gate:** fixed names cannot conditionally ignore an old Set-Cookie success at the browser. Tony's acceptance of fresh sign-in after a refresh collision does not authorize revival of revoked sessions, silent replacement of a newer independent login, or accepting every cookie race. Before implementation, decide whether remaining late-write interleavings are contained by server per-login state plus a reviewed reauthentication fallback, or require an additional transport change. Demonstrate refresh-vs-logout and refresh-vs-new-sign-in in both response orders. Removing failure clears alone is insufficient. Do not adopt the receipt candidate's cookie scheme by implication.

Proposed cookie decision for review: keep fixed names, remove automatic failure clears, and permit a late write to require fresh sign-in **when the credentials it installs name a revoked login**. This is an availability fallback, not physical cookie-order protection. The review recommends applying the accepted collision tradeoff here, but its authority premise must first be established.

An older independent login A remains valid until explicitly revoked or expired; issuance of B alone does not invalidate A. Therefore A's late response overwriting B could restore A's still-valid authority rather than merely require sign-in. The replacement-sign-in design must specify revocation of the browser's previous login and its transaction ordering, including account switches, while preserving unrelated devices. It must also handle an older sign-in response not represented in the new request's cookies. Do not infer a global ordering from sid randomness, account identity, or token timestamps. Revoking all account logins on every sign-in is not authorized.

Before selecting this fallback, enumerate both orders for renewal/logout, renewal/replacement-sign-in, and overlapping sign-ins; show which login is revoked and when. Where the old login cannot be identified and fenced with the proposed state, document the unresolved case instead of claiming that a physical overwrite necessarily ends in fresh sign-in. Additional browser-instance state or cookie changes would be a separate scope proposal. This gate remains open; the approved immediate-invalidation policy by itself does not settle it.

### Proposed replacement-sign-in transaction

On explicit successful sign-in, revoke every distinct native login authenticated by the credential cookies **observed on that request**, including when the destination account differs. Resolve access cookies through signature-verified claims and refresh cookies through their stored hashes; never revoke from an unsigned sid, arbitrary client-supplied account ID, or an unverified cookie-name suffix. Invalid credentials confer no revocation authority. An expired access cookie may identify a login only under a separately defined signature/issuer/type validation path; ordinary access authorization must still reject expiry.

Verify the destination password before revocation. Then lock all involved account rows in a deterministic order, including the destination account and accounts owning the observed logins. Reread the observed login memberships and revalidate destination credentials/generation under those locks. Atomically revoke those logins and create the new destination login/token state. Wrong passwords, disabled destinations, stale credentials, or revocation/issuance failure must leave the old logins unchanged through rollback. Do not call a nested independently committing sign-in operation and then attempt cleanup afterward.

**If required revocation cannot commit, sign-in fails closed.** No success or new cookies are returned. An ambiguous commit is a service error without automatic sign-in retry, not presumed rollback. This is the same confirmed-commit discipline as logout. It needs a reviewed multi-account transaction primitive; the current single-account issuance callback alone does not establish atomic account-switch replacement.

This revokes the login represented by the sign-in request, including a successor that committed just before its revocation lock, while preserving unrelated logins on other devices. It does not revoke every login for either account. An earlier response carrying credentials for one of these revoked sids may physically overwrite cookies, but those values no longer authenticate; fresh sign-in is then the proposed availability fallback. The guarantee is membership-based: do not assume every earlier in-flight response necessarily belongs to a login observed by the sign-in request.

### Historical overlapping-sign-in counterexample

Consider two concurrent sign-ins starting with the same old cookies. The first creates login A for account X; the second creates B for account Y. Each revokes only the old login it observed, so neither transaction necessarily revokes A or B. If B's response arrives first and A's arrives last, fixed cookie names select live A. Deterministic database lock order does not change the request snapshots or order browser responses.

For the same account, this switches login identity and may invalidate queued operation assumptions even without changing account identity. For different accounts, it restores X after the user believes they selected Y; this matters especially when switching away from a privileged account. Neither outcome should be mislabeled as rejected stale credentials. Sliding refresh can keep the unobserved login alive through continued renewal; no absolute orphan-lifetime bound is claimed.

Same-tab authentication-action serialization prevents this interleaving among cooperating callers; Stage B extends coordination to cooperating tabs with Web Locks. Nonparticipating callers, unsupported cross-tab coordination, and a lock owner disappearing with a request in flight remain relevant. Account-wide revocation on sign-in is excluded because it breaks independent-device sessions and does not supply a general cross-account browser identity boundary.

**Historical review position, superseded by the approved detection residual above.** Tony accepted fresh sign-in after collisions, not restoration of a different live account. The next design step is to compare established JWT-compatible approaches against this case and identify the smallest necessary change without affecting other devices. No particular browser-specific mechanism is selected. Any additional browser identity/state or cookie transport required for that mechanism must be proposed explicitly; do not smuggle in the receipt selector or assert that client cooperation is a complete guarantee. Until this is resolved, observed-login revocation is a useful partial rule, not closure of the cookie gate.

**Selected access policy:** on resumption Tony approved immediate per-login access invalidation on logout and replay. Once the revocation transaction commits, subsequent access verification and refresh reject that login. Other independent logins remain valid. Password changes/resets and disablement continue to invalidate every login through the approved D2 generation policy. An operation already authorized before revocation is not retroactively cancelled. This policy approval does not authorize implementation of the still-unreviewed cookie protocol.

Proposed state contract for that policy:

- Add an explicit native login record identified by an unpredictable `sid`, with account ownership, issued account generation, revocation state, and expiry consistent with sliding refresh expiry. Each fresh sign-in creates a new sid; every refresh descendant retains it. No receipt state or absolute monthly expiry is introduced.
- Put `sid` in access JWTs and refresh rows. Keep `sv` as the independent account-wide generation and `jti` as an individual access-token issuance ID. Missing or malformed sid fails closed at the coordinated rollout, requiring fresh sign-in for legacy credentials.
- Verify signature/claim shape, enabled account, matching account generation, login ownership/generation, live login state, and expiry before resolving the actor. Prefer one coherent account/login lookup and reuse that account snapshot for permission resolution. No stale positive session cache may bypass committed revocation.
- Under account-first locking, sign-in creates the login, refresh checks and rotates within it, and logout/replay atomically marks it revoked. Account-wide password/disable writes advance generation and revoke login state in the same transaction. Re-enable never unrevokes it.
- Revoke by sid rather than recursive traversal. A revoked login denies all descendants even if physical refresh-row cleanup is deferred. Any known predecessor identifies the same sid for logout. Reject legacy rows without trustworthy membership rather than guessing how an old branched chain should be grouped.
- Bind automatic operation retries to the original sid at the pre-handler boundary. A newer login, including a new sign-in for the same account, cannot inherit pending edits from an old login.

This state closes the authorization side of a late-response race: credentials returned after their login was revoked cannot authenticate again. It does **not** control the browser's cookie jar. An old response can still replace fixed-name cookies for a newer login and cause loss of continuity. The cookie gate above remains open; immediate revocation must not be presented as proof that cookie ordering is solved.


### Withdrawn cookie proposal: browser-session binding

**Withdrawn after Tony rejected the browser-restart UX regression. Do not implement this proposal.** The following preserves the reasoning for reference only. Its session-cookie lifetime conflicts with the now-explicit requirement to preserve automatic sign-in across normal browser restarts while retained refresh credentials remain valid.

The withdrawn proposal would keep the existing access/refresh cookie names. Add one HTTP-only browser-binding cookie and a small server-side browser record that identifies its current login and authentication revision. The cookie is an unpredictable random value, stored only as a hash on the server. It is not sufficient to authenticate. Access/refresh credentials must belong to the current login of the presented browser binding.

This is additional scope beyond the selected login record: one browser record, one stable cookie, and a browser/current-login check joined into verification. It is not the receipt candidate's signed selector: sign-in, refresh, logout, and password change never change this cookie's value or write it at all. The authoritative current-login selection changes in the database. Receipts, versioned credential names, and monthly reauthentication remain excluded.

The reason for this addition is concrete. A login record alone can reject revoked A, but cannot discover an unobserved A created by overlapping sign-ins. The browser record gives those sign-ins a common server-side point of coordination even when neither request has received the other's new credential cookies. A new login supersedes the browser record's previous login; unrelated browser records/devices remain unaffected.

#### Initialization and persistence boundary

Before accepting browser sign-in, require a browser binding established by a dedicated, same-origin, CSRF-protected bootstrap POST. If a valid binding is already present, return its non-secret authentication revision and write no cookie. If absent or invalid, generate a fresh anonymous browser record and set its binding cookie once. Do not create a login or return credentials in that response. The browser must receive this cookie before a later request can authenticate within that record. Never return the raw binding value in a body, URL, or browser message.

Propose a **browser-session cookie**, without Max-Age/Expires, HTTP-only, SameSite=Lax, path=/, and Secure in production. Never renew or copy its value into a later response. This avoids late renewal of an old binding replacing a new binding. Closing a browser may discard it and require sign-in again; browser session restoration may retain it, so closing the browser is not a guaranteed server logout. This persistence change requires Tony's explicit approval. The server's refresh expiry remains sliding at 30 days; there is no new monthly absolute session limit. If persistent sign-in across browser restarts is required, revise this initialization/lifetime design before implementation rather than quietly adding a rolling binding-cookie write.

Without a binding, credential cookies alone cannot authorize or renew. An older credential response cannot recreate the binding. Two bootstrap responses can establish different anonymous bindings; a late bootstrap may disrupt continuity, but cannot restore an older authenticated browser binding: a freshly generated binding cannot have been used by the browser to sign in before its only Set-Cookie response was received. Never reuse or reissue bootstrap binding values. Test this initialization ordering rather than assuming only one bootstrap can be in flight.

Bound anonymous bootstrap creation and expire unused browser records with bounded cleanup. Reuse an existing valid binding on repeated bootstrap calls. Select the admission/retention limits during technical review; do not weaken or consume the password-sign-in budgets for unauthenticated record creation without an explicit design. Initialization must remain side-effect-free with respect to existing account sessions.

#### Sign-in ordering and transactions

The sign-in form captures the browser authentication revision from bootstrap/session status and submits it with credentials. Verify the password first. Read the browser's current-login ownership, then lock the involved account rows in deterministic order, followed by the browser record and affected login/token rows. Reread the browser revision and ownership under lock. If either changed, fail with session-changed and no cookies; do not acquire an additional account lock after the browser lock or silently retry the sign-in against the new state.

On a matching revision, atomically revoke the browser's previous login, create the destination login, advance the browser revision, and set its current-login pointer. Independently verified observed credential logins may also be revoked as described in the replacement rule, but browser state supplies the missing unobserved predecessor. A failed revocation or issuance rolls back all state; an uncertain commit yields a service error and no automatic credential resubmission. This preserves account-first fencing used by D2; account mutations need not write browser records because generation/login invalidation is sufficient.

Two sign-ins submitted against the same revision cannot both succeed: one commits, the other reports session-changed without setting credentials. A later deliberate sign-in obtains the new revision and revokes the previous current login, even if that login's credential response has not yet arrived. The sign-in UI must reconcile the resulting server session before showing authenticated content and discard success responses from an obsolete local authentication action. It must never automatically resubmit stored passwords after a revision conflict.

#### Verification, renewal, logout, and operation binding

Native browser authorization requires all of: valid access signature/claims, enabled/matching account generation, live login owned by that account, and matching browser binding whose current login is that sid. **Neither account nor login validity overrides the other.** Browser binding supplies an additional required condition, not a replacement for either check. Include browser state in the scaled verification benchmark and specify the provider/host boundary; direct non-browser consumers must not silently bypass the claimed browser guarantee.

Renewal checks current browser/login state under the same account-first lock order and can issue only for that login. A late renewal for a superseded login may overwrite credential cookie values but cannot pass verification. Logout is bound to the request's login: it revokes that sid and clears the browser's current pointer only if it still points to that sid, advancing the revision when it changes the pointer. An old logout request cannot revoke the browser's newer login. Confirm commit before reporting success. No authentication action clears or rewrites the binding cookie.

Every protected browser operation carries its expected sid, obtained from the authenticated bootstrap/context, and the mandatory pre-handler boundary compares it to the verified current sid. This extends the single-retry guard to old open tabs: a page built under account X cannot silently submit an operation under account Y merely because cookies changed. A mismatch returns session-changed before the handler, requiring context reload/user action rather than an automatic mutation retry.

#### Response-order outcomes

| Interleaving | Required result |
| --- | --- |
| Renewal A commits, replacement sign-in B commits, then A's response arrives | B's transaction revoked A and selected B in browser state. Late A cookies fail verification. Show fresh sign-in/session-changed; never fall back to A. |
| Replacement B commits before renewal A acquires its locks | Renewal rejects A and emits no credential cookies. |
| Two sign-ins use one browser revision | Exactly one succeeds. The loser emits no cookies and cannot overwrite the winner. |
| A's sign-in response is delayed; deliberate B sign-in uses the next revision | B revokes A despite not observing A's new cookies. A's late credentials are rejected. |
| Logout A completes after B is selected | Revoke A only; preserve B's server selection. Any late fixed-cookie deletion may require sign-in but cannot restore A. |
| Late anonymous bootstrap replaces the binding | Credentials from another binding cannot authenticate. Require bootstrap/sign-in again; no fallback to a different binding found in token claims. |
| Another tab still displays X after a switch to Y | Expected-sid check rejects its business request before the handler. No automatic cross-account replay. |
| Binding is lost on browser close/eviction | Existing credential cookies confer no authority without it; require fresh sign-in. |

The fallback does not promise physical cookie continuity: a late response can still cost a sign-in. It establishes the security premise that a browser cannot regain an earlier account through those writes. This recommendation needs independent review, explicit approval of browser-restart persistence behavior, measured verification cost, and bootstrap resource limits before implementation. No runtime work is authorized by this draft.

### Telemetry and decision criteria

Follow step 1's best-effort event-hook pattern with a separate typed session-event seam; do not silently repurpose its password-admission event contract. Emit `contested_refresh` when a locked reread finds a rotated predecessor, with a reason and confirmed revocation outcome. Call it a contest, not a proven attack. Emit renewal attempts/successes, access-valid no-ops, terminal failures, and coordination mode so counts have a denominator. Do not claim the server can reliably distinguish a legitimate collision from theft.

Include correlation/request IDs and, if required, purpose-separated HMAC session/account identifiers. Never emit passwords, access/refresh tokens, token hashes, cookie headers, or raw identities. Hook failure must not change authentication results. Emit confirmed-revocation success only after commit; distinguish rollback/unknown outcomes. Default diagnostics can be sampled; deployment metrics need accurate counters to measure rates. Avoid adding an unbounded database event table.

Measure the reference app and each downstream site separately: contests per renewal, terminal sign-ins, same-tab versus coordinated/fallback mode, latency distributions, and clusters around network/database faults. Reuse the existing sign-in denial metrics to detect recovery-induced 429s. Respect Retry-After; never weaken approved admission budgets or auto-submit saved passwords to recover. No production measurements or downstream wiring have occurred yet.

Keep the receipt candidate below. Reconsider it only after representative coordination telemetry and controlled browser tests show an unacceptable residual. Agree on the observation period and acceptable rate with Tony from actual deployment traffic; do not invent a universal threshold or call the residual rare before measurement. Stage A can be reviewed as an incremental change, but independent release still requires the common logout/revocation/cookie gates and R2/R3 acceptance.

## Inactive D3 alternative: bounded recovery with independent receipts

**Draft for review, not an approved protocol or implementation instruction.** The user authorized preparing this consolidated proposal on 2026-09-08. Step 3.1 is active; step 3.2 has not started. R2 remains open. This section supersedes the earlier informal metadata-gated grace direction, not the approved D2 policy.

### Scope decision first: coordination or receipts

The follow-up reviewer endorsed the receipt security argument, but **did not approve the package or implementation**. The review correctly identified that the earlier recommendation omitted a substantially smaller alternative. Tony subsequently selected coordination-first and accepted residual reauthentication; the receipt design below remains an unselected candidate.

**Selected scope: Tony accepted coordination-first and residual fresh sign-in after uncoordinated collisions.** Preserve strict replay detection and the approved account-wide D2 policy. Do not introduce receipts, new cookie namespaces, or monthly reauthentication simply to fix parallel fetches. This is a recommendation to select and finish that design, not a claim that a browser lock alone meets every current R3 requirement.

| Concern | Coordination-first, strict replay | Receipt recovery candidate |
| --- | --- | --- |
| Ordinary parallel browser fetches | Coordinate before requests can rotate; one refresh response supplies cookies for the waiting requests. | Overlaps can reach the server; losers batch their receipts and recover using a live descendant. Coordination can still reduce load. |
| Reuse that reaches the server | Immediately revoke the affected refresh lineage. No grace interval. | Reuse inside 2 seconds creates receipts; unresolved receipts deny access after their 5-second deadline. Outside admission, revoke immediately. |
| Uncoordinated navigation, closed tab, unsupported coordination | Accept a possible fresh sign-in. Frequency is unmeasured and must not be described as rare yet. | A delivered and acknowledged receipt can preserve continuity; abandoned/lost receipts still end the login. |
| Refresh storage and lifetime | Coordination itself needs no new tables and can preserve the current sliding refresh lifetime. | Login and receipt state, plus the proposed cookie design's separately approved absolute lifetime. |
| Cookies | Removing blanket failure clears fixes one race. Fixed names still require an explicit policy for late successful writes and logout/sign-in overlap. | Login/rotation names and selector isolate those responses, at the documented complexity and cookie-budget cost. |
| Logout and deep-lineage revocation | Still fix predecessor logout, the 1,000-row ceiling, and swallowed DB failures. These are not solved by the lock. | Included through explicit login state and scoped revocation. |
| Immediate access invalidation on logout/replay | Now selected by Tony. Coordination-first therefore also needs per-login state and access verification; the no-new-state comparison no longer describes the complete selected scope. | Included in the proposed login/receipt verification query. |
| Host and browser surface | A coordinated refresh boundary, no-cookie failure outcomes, and coverage of every participating caller. SSR overlap still needs an explicit fallback policy. | Receipt endpoints, batching, retries, SSR recovery/CSP, cookie enumeration, cache integration, and sweep task. |
| Evidence before release | Real browser concurrency, navigation-vs-fetch, missing-lock, tab-close, late-response, and both-database revocation tests. | All of those, plus receipt security/liveness tests, CSP integration, and a verification-path benchmark. |

The smaller option must coordinate **before** the existing transparent refresh can run. Today there is no browser-visible refresh call to wrap: `getAdminRequestContext()` rotates inside arbitrary server requests. A viable design must either coordinate all such requests before sending them or separate explicit refresh from business requests and ensure those requests never silently rotate outside the coordinator. Prefer exploring the latter so ordinary reads and writes need not be globally serialized. This entails host/SDK changes and a reviewed SSR policy; it is not a one-line client lock.

Web Locks can serialize cooperating tabs/workers sharing a storage bucket; BroadcastChannel is a notification mechanism, not equivalent mutual exclusion. Neither coordinates an already-dispatched SSR navigation with another tab's fetch. Request memoization prevents duplicate refresh inside one logical SSR request, but two navigations, or a navigation and fetch, can still contend. Thus the claim that a single SSR request cannot contest itself does not remove the SSR concurrency case. See the [Web Locks specification](https://www.w3.org/TR/web-locks/).

With fixed cookie names, removing failure clears does not stop a late successful refresh from overwriting a newer sign-in, or an old explicit logout response from clearing it. Either the smaller design must cover participating cookie writers and define safe fallback behavior, or Tony must explicitly accept reduced availability guarantees for those interleavings. Server revocation must still prevent session revival. The existing R3-04/R3-06 expectations cannot silently be checked off under weaker semantics.

The scope choice and two product policies are separate:

- **Scope:** coordination-first selected for design; receipts retained as an alternative. Implementation is not yet approved.
- **Per-login access invalidation:** immediate logout/replay invalidation selected by Tony on resumption. D2's approved account-wide immediate invalidation does not change.
- **Lifetime:** retain sliding refresh expiry or approve a 30-day absolute login lifetime. Do not infer monthly reauthentication approval from choosing receipts. If sliding lifetime is retained with receipts, the selector/lifetime design below must be revised before implementation.

### Receipt candidate and cost

If the receipt scope is selected, provide a short opportunity for overlapping requests to recover, with a separate random receipt for **each** losing request. A receipt can be acknowledged only by presenting that receipt and a live successor refresh token from the same login. An unacknowledged receipt expires the whole login on the server. Merely using the successor never clears a contest.

This supplies the missing distinction in the attacker-first case: the legitimate losing request receives a receipt that the attacker does not possess. The attacker cannot acknowledge that receipt merely by possessing the successor. The distinction depends on confidential, isolated HTTPS responses, not on IP addresses or User-Agent strings. This is a proposed application protocol requiring independent security review; it is not a standardized sender-constrained token scheme.

The complete receipt candidate also introduces an explicit login record, immediate per-login access invalidation, and cookies named by login and rotation. To keep the cookie selector stable without silently shortening a sliding session, recommend an explicit **30-day absolute login lifetime**, with refresh expiry capped at that deadline. Today the provider renews refresh expiry on every rotation; this recommendation changes that behavior and requires approval. Access-token lifetime remains 15 minutes, capped by the login deadline.

The additional state and transport work are substantial. A timer, IP comparison, or scheduler alone cannot provide these guarantees. If this scope is rejected, redesign D3 explicitly; do not implement just the grace interval and claim the rest follows automatically.

### Verified prerequisites and deficiencies

- `packages/client/src/server/admin-context.ts` currently calls `refreshSession({ refreshToken })`, omits both metadata fields, and clears fixed-name cookies on refresh failure. `oncePerRequest` coordinates one request only.
- The provider records supplied metadata on each successor, otherwise null. Consequently the normal host refresh path loses metadata after R0. Existing sign-in metadata cannot support the previously proposed gate.
- Trusted-IP resolution and its fail-closed policy currently belong to password sign-in. They do not automatically cover every authenticated request.
- `HostRequestBridge` currently exposes individual cookie reads/writes and an opaque request identity. The proposal needs bounded cookie enumeration and an explicit host metadata capability; SDK code must not cast the opaque identity to a Fetch Request.
- `adminSignOut` currently swallows revocation failures and reports success. That cannot satisfy confirmed server-side logout.
- `apps/webapp/src/middleware/public-cache.ts` recognizes the two current fixed cookie names. Cookie changes must update cache bypass in the reference app, templates, and downstream deployment instructions.

### Policy choices proposed for approval

| Decision | Recommended policy | Deliberate limitation or cost |
| --- | --- | --- |
| D3-A: duplicate admission | Admit a duplicate of a rotated, otherwise eligible predecessor only while database time is strictly before its rotation time plus 2 seconds. Give each duplicate its own receipt; never return successor credentials to the duplicate. | Two seconds is a proposed initial policy value, not a measured latency guarantee. Slow legitimate requests may require sign-in. |
| D3-B: abandoned recovery | Each receipt expires 5 seconds after its creation, without extension. Every receipt must be acknowledged by presenting its secret; allow up to 32 in one batch. Any overdue unresolved receipt makes the login unusable. | A lost response, closed tab, or suspended browser can end an otherwise legitimate login. |
| D3-C: metadata | Record bounded User-Agent and normalized trusted IP where available, but use neither as an authentication or tolerance gate. Missing, invalid, throwing, or unavailable IP resolution at refresh becomes null plus a diagnostic; no implicit header fallback. | This withdraws the earlier metadata gate. IP mobility and missing metadata do not cause logout. Receipts, rather than metadata, carry the recovery guarantee. Sign-in still fails closed exactly as approved in step 1. |
| D3-D: revocation scope | Logout, replay, receipt expiry, and explicit failed recovery revoke one login, including its access tokens and all refresh descendants. | Requires a persistent login identity and a lookup on access verification. Password/reset/disable retain account-wide D2 invalidation. |
| D3-E: receipt bounds | At most 32 receipts per rotation, counting acknowledged receipts too, and at most 32 unresolved receipts per login. Exceeding either bound revokes that login. | More than 32 overlapping losers may require sign-in. A token holder can force logout; tolerance is not protection against that denial of service. |
| D3-F: cookies | Use a stable login selector and immutable credential names per login/rotation. | Changes cookie transport and cache detection. This candidate currently depends on the separate D3-H lifetime decision. |
| D3-G: failures and retries | Retry only the explicit pre-operation recovery outcome. Do not automatically retry unknown network/commit failures or completed business operations. | Lost committed refresh responses can still require fresh sign-in. Hash-only storage cannot reconstruct a missing successor. |
| D3-H: lifetime, separate decision | Proposed for this cookie candidate only: a 30-day absolute login lifetime. Tony has not approved it. | Changes the current sliding lifetime and requires monthly reauthentication. Rejecting it requires revising the receipt cookie design; it does not authorize an implicit lifetime change. |

The thresholds are defaults proposed for this release, not a new collection of operator-adjustable security modes. Any later configurability must preserve finite deadlines, storage bounds, and the same tested invariants.

### Server state and transaction rules

A **login** is one successful sign-in, identified by an unpredictable `sid`. Each refresh token belongs to exactly one login. Separate sign-ins receive separate identities even for the same account and browser.

Proposed logical storage, with physical names to follow repository conventions:

- A login record contains `sid`, account ID, account generation at issuance, creation time, absolute expiry, revocation time/reason, and current rotation number. Index account ID for account-wide revocation.
- Every refresh row contains `sid` and an increasing integer rotation number, unique together. Preserve the predecessor/successor relationship for audit, but revoke by login membership rather than traversing a chain. Only one current live refresh row is permitted by the locked transaction.
- A recovery receipt contains a random 32-byte secret whose SHA-256 hash alone is stored, login ID, predecessor ID, creation/deadline times, and acknowledgement time. Return its plaintext once, only to that particular losing response. Never list receipts or expose an endpoint that recovers their plaintext. Do not deduplicate different losing requests onto one receipt.
- Use the predecessor's existing `revoked_at` together with `rotated_to_id` for rotation time and identity. Receipt deadlines and acknowledgement state are new information and need storage. Retain per-rotation receipt counts after acknowledgement so clearing receipts cannot defeat the cap.

All mutations acquire the existing account lock first, then the login, then refresh/receipt state, in one transaction. Initial hash lookup may identify the account but conveys no authority until reread under the lock. Password/disable transactions retain the same lock order and additionally revoke login records. No automatic transaction retry is proposed; confirmed rollback and ambiguous commit remain distinct.

Read a fresh database wall-clock value **after acquiring locks** for rotation/admission/deadline decisions. Do not use a transaction-start timestamp captured before a lock wait; PostgreSQL needs a clock read with the appropriate semantics. Refresh expiry and receipt deadlines use that same authority. Application clocks must not decide whether a duplicate is inside the window. Define and test the boundary as `now >= deadline` meaning expired. Database clock discontinuities remain an operational limit on wall-clock claims.

The native access claim adds `sid`; `sv` continues to mean account generation, and JWT `jti` continues to identify an individual access issuance. Verification validates the signature and claim shapes, then reads account plus login plus overdue-receipt status in one coherent adapter query. Require enabled account, matching `sv`, login ownership and generation, live login, and unexpired absolute deadline. Reject an overdue receipt even if the sweeper has not run. Resolve permissions using that already-read user rather than reading the account again. Neither account nor login validity overrides the other.

Revocation takes effect for authorization checks after the revoking transaction commits; already-authorized work is not retroactively cancelled. A database failure fails authentication closed as an availability error, without clearing cookies or attempting an alternative refresh path.

### Recovery protocol and security argument

1. A first refresh atomically rotates R0 to R1 and issues its access token. The transaction returns plaintext R1 only to the winning response. It creates no receipt on the uncontested path.
2. A duplicate R0 inside the admission interval creates a new independent receipt C. It returns `ERR_SESSION_RECOVERY_REQUIRED` with C, the login identity, and remaining recovery budget. It returns no access/refresh credentials, performs no protected operation, and writes no cookies.
3. The browser sends a batch of 1–32 receipt secrets to a CSRF-protected POST recovery endpoint. Browser cookies must supply the current live refresh token for the same login, at a rotation strictly greater than each receipt's predecessor. R2 is acceptable for a receipt created on R0 even if R1 has since rotated; a direct-successor requirement is explicitly rejected. Under the account/login lock, check for any overdue unresolved receipt, validate every supplied secret and its ownership, and acknowledge exactly the supplied receipts. Reject a malformed, unknown, or mixed-login batch without partially acknowledging it. Duplicate secrets in one batch are deduplicated; already-acknowledged entries are idempotent. It neither rotates nor returns credentials. Unsubmitted receipts remain pending.
4. Still presenting R0 means recovery is not ready; return the distinct pending outcome without creating another receipt or extending the deadline. Wrong-login credentials cannot acknowledge C. An overdue receipt first revokes its original login and cannot be revived by a late acknowledgement.
5. Acknowledgement is idempotent for the same receipt and eligible login, including a lost acknowledgement response. Acknowledged receipts never restore a revoked login. A receipt alone grants neither authentication nor access to account data.
6. Terminal recovery may present C to revoke its original login immediately, even if browser cookies now select a newer login. Receipt secrecy authorizes only that narrowly scoped revocation. If this request is lost, server deadline enforcement still applies.

In a benign overlap, the same browser receives R1 in one response and C in another, so it can acknowledge C. With several losers, the page collects the receipts already delivered to it and sends them together. Every secret must be presented, but each need not take a separate round trip. Receipts arriving later form a subsequent batch; separate tabs can submit independent batches without sharing secrets. Batching cannot recover a receipt whose response never arrived, and acknowledging one never dismisses an unsubmitted receipt.

In attacker-first ordering, the attacker receives R1 while the legitimate browser receives C and still has R0. Neither has both R1 and the legitimate C. The attacker can manufacture more losing requests and acknowledge their own receipts, but cannot acknowledge the legitimate receipt. In attacker-as-loser ordering, the attacker's receipt similarly cannot be acknowledged with R0. In both cases an unresolved receipt expires the login, irrespective of matching IP/UA or subsequent refreshes.

This argument assumes theft of a token, not ongoing control of the browser or access to the other party's HTTPS responses. If the attacker also obtains the relevant receipt and current successor, acknowledgement is possible. XSS or broader browser compromise needs separate defenses; do not describe receipts as proof of a human identity. If theft never results in a competing request or replay, no contest exists and this protocol does not detect the theft.

The bound is **5 seconds of database time after an unresolved receipt is created**, at most 7 seconds after that contested rotation under the proposed admission interval. It is not a bound measured from theft, nor a promise to cancel work already authorized. Every access and refresh authorization checks the deadline; scheduler timeliness is not required for denial. A scheduler task materializes expired revocations and reclaims state using leases, abort checks, bounded batches, and `workRemaining`. Register it at boot using the existing required-task pattern. Scheduler outages delay cleanup, not deadline enforcement; there is no unconditional wall-clock cleanup guarantee.

### Browser, SSR, and business-operation behavior

Fetch transport owns recovery before surfacing the operation result. A page-local coordinator batches all currently delivered receipts for the same login, up to 32. Do not delay earlier receipts waiting for all possible losers. Only one acknowledgement request is in flight per coordinator/login; later receipts join the next batch. Each receipt retains its own deadline, and an omitted receipt never gains an extension.

Replace the four-attempt cutoff with a deadline-driven schedule. Schedule attempts at approximately 100, 350, 850, 1,850, 2,850, 3,850, and 4,850 ms after initial receipt delivery, stopping on success or a terminal response. Missed schedule points while a request is in flight are skipped rather than queued as a burst. Reconcile the local monotonic budget with the server's remaining-budget response after each request, never extending it; clamp the final attempt to before that budget expires. A pending response must not cause terminal revocation at 1.85 seconds while recovery budget remains. A successor arriving at 3 seconds must be recoverable by a later scheduled attempt when the server deadline permits. Network time and browser suspension may still exhaust the actual server deadline; the server is authoritative, and client time cannot extend it.

For each receipt, allow at most seven scheduled attempts. New receipts may get an immediate next batch after the current response, but space acknowledgement requests by at least 100 ms per coordinator and never resend an existing receipt more often than its schedule. Use the recovery endpoint, not repeated calls to the original operation. Cross-tab messaging must not broadcast receipt secrets. Measure recovery success for 2, 6, and 20 concurrent requests with independent and correlated delays/loss: batching reduces round trips but does not eliminate the requirement to receive every receipt or survive a correlated outage.

After acknowledgement, retry the original operation at most once and require its original `sid`. A newer independent login returns `ERR_SESSION_CHANGED` and requires user action; never replay an edit under another login or account. If the retried operation encounters another recovery condition, settle or terminate that receipt without automatically replaying the business operation again. Generic 401s, transport errors, timeouts, and unknown commit outcomes do not enter this loop. This is not general mutation idempotency.

Before enabling any automatic operation retry, audit every native host handler and transport wrapper: authentication must precede business side effects, and only a failure at that boundary may carry the retryable code. Include uploads, analytics, preview, direct commands, and caught/wrapped errors. Anything not proven safe gets an explicit recovery/retry UI instead of automatic replay. Existing comments claiming every function authenticates first are not evidence of this audit.

An SSR navigation cannot wait for its request cookies to change. On the specific recovery outcome, return a minimal, private `no-store` recovery document containing that response's receipt safely encoded in its body. Do not put the receipt in a URL, redirect query, cookie, logs, analytics, or referrer. Its script performs the same bounded acknowledgement loop, then makes one replacement navigation to the original validated same-origin admin GET destination. Carry a non-secret one-attempt marker to prevent a recovery-page loop. Repeated failure shows sign-in/retry UI and terminates the associated receipt. With JavaScript disabled or a page abandoned, the receipt expires; no server-side refresh/redirect loop is allowed.

The recovery HTML uses a fresh cryptographically random nonce of at least 128 bits per response, shared by its script element and the effective `script-src` policy. Prefer a small same-origin external recovery module with safely encoded inert receipt data, avoiding secrets in executable script text or CSP report samples. The host must integrate the nonce with the application's policy before headers are sent, including `script-src-elem` when present; never add `unsafe-inline` or replace an application's stricter policy. Multiple CSP headers all apply, so adding a permissive second header cannot override a restrictive first one. If a proxy owns CSP, deployment wiring must explicitly permit the nonce/module. A nonce prop on a theme component is not evidence of a configured site-wide CSP. See [Content Security Policy Level 3](https://www.w3.org/TR/CSP3/).

**With JavaScript disabled, or recovery scripting blocked by CSP, every contested navigation with an unresolved receipt ends that login at its deadline.** Include a plain sign-in explanation in the recovery document. A no-JS automatic-recovery guarantee is not part of this candidate.

All recovery responses and endpoints are private and `no-store`; POST endpoints use the existing CSRF boundary. Bound request bodies, receipt lengths, and lookup work. Browser shutdown or a lost response may prevent acknowledgement, which intentionally trades availability for server-enforced containment.

### Cookie protocol and late responses

The current two fixed credential names cannot enforce response ordering. Browsers replace a cookie with the same name/domain/path when a response arrives; a database lock cannot conditionally apply that browser write. RFC 6265 explicitly describes races between concurrent Set-Cookie responses. The following cookie change is part of the proposal, not an optional implementation detail. See [RFC 6265, section 4.1](https://www.rfc-editor.org/rfc/rfc6265.html#section-4.1).

- A signed, purpose-separated HTTP-only selector cookie identifies the selected `sid` and its absolute expiry. It is routing state, never sufficient to authenticate. Only successful explicit sign-in writes it. Refresh, recovery, logout, expiry, and password-change responses never overwrite or delete it. An invalid/expired selector fails closed; never fall back to another login found in cookies.
- Access and refresh credential cookie names include `sid` and rotation number. Each successful issuance uses new names; no refresh response writes another rotation's credentials. The server authenticates values and their association with the names, then selects the highest authentic rotation for the selected login, independently of Cookie header order. An arbitrary numeric suffix is not authority. A revoked highest authentic rotation does not cause fallback to older credentials.
- A late R1 response can add only R1's names and cannot replace R2. A late response from login A cannot change the selector for newly selected login B. Requests still carrying A may finish using their original authorization snapshot but cannot select or revoke B.
- Successful responses may delete only exact older credential names observed on their request, for their own login. No wildcard deletion or deletion of a shared selector is allowed. Terminal responses may likewise delete only observed credentials for the affected login. An unobserved late credential may reappear physically, but server login revocation makes it unusable.
- Leave the selector as a non-authenticating tombstone after logout/revocation until its absolute expiry or a new sign-in. Refresh credentials expire no later than that same login deadline. This avoids selecting an old login when current credentials disappear and avoids refreshing the selector from stale responses.
- Preserve HTTP-only, SameSite=Lax, path=/, and Secure in production. Bound recognized credential cookies to 8 pairs and 8 KiB of authentication-cookie input. Exceeding the bound fails closed with explicit session-cleanup/sign-in UI; do not choose an arbitrary subset. Routine exact-name cleanup should keep the common case to one pair. Test accumulated late responses and cookie eviction; missing required cookies may require sign-in and must not revive another login.
- Serialize explicit sign-in submissions within the supported browser UI, including cross-tab coordination where available. Two independently completed explicit sign-ins still select according to their applied selector responses; no stronger total ordering of user sign-in intent is claimed. The guarantee here is that refresh/recovery/logout from an older login cannot replace a new explicit sign-in.
- Scope preview state to the selected login as part of the transport update. An old response must not erase or enable preview for a newly selected login. Update cache bypass to recognize the new auth cookie namespace; conservatively bypass when a selector remains after logout, documenting that cache-efficiency cost.

This design deliberately pays for versioned cookie names and an absolute lifetime instead of assuming browser locks can order arbitrary server responses. Browser coordination is an optimization for ordinary traffic, not the server security boundary. Cookie enumeration, header limits, expired access cookies, malformed names, duplicate cookie names, and cleanup need real-browser tests before approval for release.

### Complete outcome table

| Event | Server outcome | Transport and operation outcome |
| --- | --- | --- |
| First refresh of current live token | One successor, committed with predecessor rotation under account/login lock. | Write only new credential names; verify replacement before authorizing the operation. |
| Benign duplicate inside 2 seconds | Create independent bounded receipt; leave login usable until an unresolved deadline. | Distinct recovery-required response, no operation and no Set-Cookie; bounded acknowledgement then at most one operation retry. |
| Duplicate outside admission interval | Revoke the entire presented login, regardless of metadata. | Terminal auth outcome; no generic automatic retry or selector mutation. |
| Attacker first or attacker as loser | An independently unresolved receipt expires the login; own-receipt acknowledgement cannot clear another receipt. | Both parties' later access/refresh checks reject after the deadline. |
| Missing trusted IP, changed IP, missing/changed UA | Record available bounded metadata only; apply identical receipt rules. | No logout or tolerance bypass solely because of metadata. |
| Winner response lost; browser closed/offline | Any contest expires without browser assistance. If no contest exists, a later predecessor replay follows the same admission rules. | Fresh sign-in may be necessary; no plaintext reconstruction. |
| Correct receipt plus eligible successor | Acknowledge that receipt only, without rotation or deadline extension. | No cookies or credentials returned. Other pending receipts still matter. |
| Explicit failed recovery or newer selected login | Revoke original receipt's login only; never acknowledge it using another login. | Preserve newer selector/credentials; no business-operation replay under the new login. |
| Logout with any known predecessor | Revoke its login in constant traversal depth, including access tokens and every descendant. | Report success only after confirmed commit; DB failure gives retryable service-error UI, not a false successful logout. |
| Password reset/change or disable | Advance account generation and revoke all account logins atomically, as approved in D2. | Self-service shows confirmation and requires sign-in. Old responses cannot revive any revoked login. |
| Re-enable | Preserve generation and revoked login state. | Fresh sign-in required. |
| Expired token/login or malformed legacy claims | Reject; expired/revoked login cannot be recovered by receipt. | No retry loop, no fallback to another cookie lineage. |
| Confirmed transaction rollback | No partial successor, receipt, acknowledgement, or revocation. | No credentials/cookie writes from rolled-back work. |
| Correlated database/network slowdown | Many failed recoveries may require fresh sign-in together; retain approved sign-in admission limits. | Shared-network users may then encounter the 60/minute network budget and 429 responses. Respect Retry-After and require explicit sign-in; never auto-submit stored passwords or bypass step-1 budgets. Measure this compounded-outage case. |
| Ambiguous commit or service failure | Do not guess commit status or replay issuance. Deadlines remain authoritative when DB access resumes. | Service-error UI; no automatic business retry, no blanket cookie clear. |
| Late old success, cleanup, or logout response | Login state and cookie namespaces retain their original scope. | Cannot overwrite a newer rotation or another selected login; physically restored revoked cookies grant no access. |

### Migration, validation, and approval boundary

Fresh sign-in is required at coordinated rollout. Legacy JWTs without `sid` and refresh rows without valid login membership fail closed. Do not infer a safe login grouping from possibly branched historical chains. Retain or clean legacy records according to migration/retention policy, but never authorize them. Test legacy branches and chains longer than 1,000 rows to prove rejection, and new deep lineages to prove whole-login revocation without traversal.

Both adapters need login and receipt storage, constraints, indexes, transactional primitives, database-time access, and the joined verification query. Add native SQL scripts and generated development migrations using the existing workflow. PostgreSQL table-creation scripts require the repository ownership guard. Release baseline reconciliation and CLI migration copying remain the user's release step. Do not alter the current dev databases while reviewing this proposal.

Provider contracts must describe recovery as an explicit capability/result rather than requiring every third-party provider to implement native receipts. Host integration must reject unsupported native recovery wiring at boot; custom providers must not silently inherit claimed native guarantees. Package ownership remains auth contracts, admin provider/repository contracts, database adapters, client request/cookie logic, and host HTTP/browser recovery.

Before approving the receipt package for implementation, benchmark the proposed verification query against the current account-read-plus-permissions path on both databases using a disposable, read-only query prototype and representative indexed fixtures. Report p50/p95/p99 latency, query plans, rows examined, and throughput under concurrent refresh/acknowledgement writes, with 0, 1, and 32 unresolved receipts and substantial historical acknowledged data. Include the full permission-resolution cost and explain dataset/hardware limits. Agree on an acceptable regression budget from those measurements; no benchmark or performance approval has happened yet. A scoped benchmark prototype does not authorize production provider/schema changes.

Before step 3.2, independently review the receipt secrecy argument, cookie selector/version rules, changed absolute lifetime, and bounded resource policies together. Approval of the idea of grace alone is insufficient. R2 closes only after the implementation replaces the known-regression characterization with the agreed concurrency acceptance tests and passes both adapter and real-host/browser gates.

[RFC 9700, section 4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2) explains why reuse of a rotated bearer token cannot by itself identify the legitimate participant. It does not endorse this grace or receipt protocol; it is relevant security background, not a claim that Byline implements an OAuth authorization server.

## Withdrawn findings and evidence limits

The telemetry POST route is outside the server-function CSRF filter, but has its own public-domain allowlist and bounded body handling. It is not an unresolved password sign-in finding. Its `readBoundedBody` is private; the sign-in implementation follows its pattern rather than importing it.

Direct live CSRF/sign-in checks were performed on the original machine, including 403 cross-site rejection, 413 body rejection, 400 oversized credentials, limiter 429, successful credential sign-in, HTTP-only cookies, and sign-out. Credentials and temporary scripts are not committed. The reproducible committed Start fixture substitutes application services and tests actual HTTP transport; it is not a full real-password/database login test.

Independent review has explicitly approved step 1, including its scheduler and HMAC revisions. Do not reopen deliberate tradeoffs as bugs without new evidence. Steps 2 and 3, multi-instance refresh semantics, downstream proxy/WAF configuration, and final release baseline reconciliation remain outstanding.
