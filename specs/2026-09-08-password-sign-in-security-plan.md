---
title: "Password sign-in security implementation plan"
path: "password-sign-in-security-plan"
summary: "Resume session revocation and concurrent refresh work on another machine without losing the approved security decisions or release workflow."
---

# Password sign-in security implementation plan

Companions:

- [Security specification](./2026-09-08-password-sign-in-security-spec.md) records the approved behavior, unresolved decisions, module flow, and rejected fixes.
- [Authentication and authorization](../docs/07-auth-and-security/01-authn-authz.md) documents current implementation and public configuration.
- [Testing](../docs/13-testing.md) describes repository test setup.

Date: 2026-09-08.

Status: steps 1, 2, and 3 are approved. Independent combined R2/R3 review accepted the revocation semantics, login membership, coordination protocol, and pre-handler retry boundary. Release preparation remains outstanding; review approval is not production-release authorization.

## Combined R2/R3 approval and remaining work (2026-09-08)

The user supplied the independent review titled “Combined R2/R3 review — approved.” R2 and R3 are closed. This approval supersedes earlier pending/rejected review statements and design gates retained below as historical context. It does not claim additional browser fault-injection coverage beyond the recorded evidence.

The reviewer independently verified:

| Check | Result |
| --- | --- |
| PostgreSQL unfiltered adapter conformance | 358 / 358 |
| MySQL unfiltered adapter conformance | 358 / 358 |
| Host tests | 56 jsdom + 264 node |
| Admin tests | 35 jsdom + 203 node |
| Reference app tests | 36 jsdom + 145 node |
| Workspace typecheck | 44 / 44 tasks |
| Documentation | 72 documents / 710 links |
| Biome on 120 changed files | Only pre-existing noNonNullAssertion information |
| Anonymous public GET `/` | HTTP 200 |

Tony will handle release preparation. Downstream application migration will continue in a separate session tomorrow. This session ends at the approved implementation checkpoint; do not begin either workstream here.

Release prerequisites remain open and are not R2/R3 gates:

- [ ] Squash development migrations and synchronize CLI baselines; close the two deferred baseline tests.
- [ ] Rerun the production build and final release gates after release preparation.
- [ ] Review both downstream production applications and their deployment configurations.
- [ ] Perform one coordinated stopped-instance `sv`/`sid` cutover, applying migrations before restarting all instances and requiring fresh sign-in once.

Non-blocking follow-ups:

- [ ] Add physical cleanup for expired/revoked `byline_admin_login_sessions` rows. Use the existing scheduler pattern: a `RecurringTaskDefinition`, lease, bounded batches, and `workRemaining`. Rows currently accumulate; authorization already rejects revoked/expired state, so cleanup is not required for immediate invalidation. Account for cascading refresh-row deletion and retained audit/replay needs when defining eligibility. Editorial-scale growth does not block this release.
- [x] Clarify idempotent logout in the authentication document: credentials identifying no login can return success without a revocation write; successful logout still clears the browser credentials.

No cleanup implementation, commit, push, or release is authorized merely by recording this review.

## Expiry classification and conformance re-review (2026-09-08)

The next review found two failures in the previously omitted `JwtSessionProvider` conformance group. The earlier 47-test selection was insufficient evidence for combined acceptance. Access expiry deliberately reports `ERR_ACCESS_EXPIRED`, and its stale expectation is corrected. Ordinary refresh/login expiry now reports `ERR_INVALID_TOKEN` with `refresh token expired`; it is no longer intercepted by the login-revocation branch. Explicit revocation, replay, account disablement, and generation changes retain their existing precedence. A new adapter test verifies that a login which is both revoked and expired still reports revocation.

The anonymous-layout regression now belongs to the reference app beside its loader. It still imports the real host preview-state implementation. Its transport stub targets the host's installed TanStack dependency so a distinct app peer-dependency resolution cannot bypass the mock. Published host tests no longer import the consuming app's source.

`framework-fetch-shape.test.node.ts` exercises the installed TanStack serializer with GET, JSON POST, and FormData inputs. It asserts that the fetch URL is a string and the body is undefined, string, or FormData. The test deliberately resolves the installed serializer entry point, making changes to that upgrade-sensitive contract visible.

Re-review validation: the complete adapter conformance file passed **358/358 tests on PostgreSQL** (103.51 seconds) and **358/358 on MySQL** (105.51 seconds), with no name filter or skipped cases. This supersedes the earlier partial authentication selection for this review. The host suite passed 264 node and 56 jsdom tests; the app suite passed 145 node tests. The provider build, workspace typecheck (44 tasks), lint (26 tasks), documentation checks (75 documents and 727 links including specs), and `git diff --check` passed. No migration, production release, commit, or dev-server restart was performed in this pass.

For review, run the complete conformance file without a name filter from each adapter package:

```sh
# PostgreSQL on this machine, using the isolated test database
node --env-file=.env.test.local node_modules/vitest/vitest.mjs run --mode=integration tests/conformance.integration.test.ts --reporter=dot
# MySQL from its package directory
node node_modules/vitest/vitest.mjs run --mode=integration tests/conformance.integration.test.ts --reporter=dot
```

## Combined review corrections (2026-09-08)

Combined R2/R3 review rejected the first implementation handoff because `getPreviewStateFn` had accidentally received the admin-session middleware. The public layout calls that function for anonymous visitors, so missing credentials caused an HTTP 500. The gate is removed from this cookie-state read. Draft access remains enforced on the content read path; returning a preview preference is not an authorization grant.

The regression test is `apps/webapp/src/ui/layouts/frontend-layout-loader.test.node.ts`. It calls the reference application's public layout loader with the real preview-state function and anonymous cookie state. The host transport is adapted for the unit test; an additional real request with no cookie header verifies the running homepage returns HTTP 200. This is distinct from the earlier authenticated admin smoke checks.

MPL notices are restored at the beginning of all changed/new TypeScript source files, with imports grouped below them. `admin-context.ts` again explains why memoization preserves requestId and prevents a ReadContext from crossing request authorities.

The retry transport no longer constructs and clones Request bodies. Reusable BodyInit values, including FormData and Blob uploads, are serialized anew for the single safe retry without a tee retaining an unread upload branch. One-shot ReadableStream bodies and caller-supplied Request objects are sent once; after confirmed renewal, expiry returns an explicit “Please retry the operation” error instead of silently replaying them. Tests cover multipart content preservation without Request.clone and the one-shot stream fallback. This change removes the duplicate buffering mechanism; it is not a measured upload-size ceiling.

Correction-pass validation: the cookie-free `curl http://localhost:5173/` request returned HTTP 200 before and after the final build, with no serialized admin-session error. The host suite passed 262 node tests and 56 jsdom tests; the client suite passed 144 tests. Workspace build (22 tasks), typecheck (44 tasks), and lint (26 tasks) passed. Documentation validation passed 75 documents and 727 links; `git diff --check` passed. The MPL placement audit checked 119 changed/new TypeScript files with zero failures. These results do not include a new database conformance run because this pass does not change database behavior.

At this correction checkpoint, combined R2/R3 acceptance remained with the reviewer; it is now approved as recorded above. The previous database evidence is unchanged by these host and documentation fixes; no new database mutation or migration was introduced in this correction pass.

## Implementation evidence (2026-09-08)

The working tree implements sid-backed native login revocation on both adapters, verification-only request contexts, explicit renewal, a pre-handler expected-login boundary, one safe resend, same-tab coordination, optional Web Locks, token-free cross-tab notification, and the acknowledgement interstitial. Replacement sign-in revokes verified observed logins atomically. Logout identifies the login from either observed access or refresh credentials, including a rotated predecessor; failures do not clear cookies or report success. Account generation and login validity remain independent requirements.

Both local development databases have the additive login migrations applied: PostgreSQL native `0013_add-login-sessions.sql` and MySQL native `0008_add-login-sessions.sql`. The generated Drizzle `0003` migrations are also present for development migration history. Production rollout and the user-deferred CLI migration baseline synchronization remain outstanding.

Validation recorded for this implementation:

- `pnpm build`: 22 tasks passed.
- `pnpm typecheck`: 44 tasks passed.
- `pnpm lint`: 26 tasks passed; Biome formatted the touched source and tests.
- `pnpm knip`: passed. The public-export baseline records the intentional login repository and telemetry types.
- Documentation validation: 75 documents and 727 links passed, including both specs and the benchmark evidence. Generated collection types are current; `git diff --check` passed.
- `pnpm --filter @byline/host-tanstack-start test`: 260 node tests and 56 jsdom component tests passed. The added client transport tests cover six simultaneous expiry responses sharing one renewal, multipart body preservation, one-resend maximum, no retry after handler/network errors, and cancellation after session change.
- PostgreSQL and MySQL auth integration plus native session conformance: 47 tests passed on each adapter. Coverage includes strict contests, predecessor logout, access-only logout, mismatched logout, independent-device preservation, cross-account replacement, rollback, and more than 1,000 refresh members.
- SQL-injected revocation rollback: four tests passed on each adapter.
- The broad workspace unit run passed runtime package suites; two CLI migration-baseline drift assertions remain red because baseline synchronization is explicitly deferred to the release squash. Do not describe the entire workspace unit gate as green.

Reproduce database checks from each adapter package with `node node_modules/vitest/vitest.mjs run --mode=integration tests/conformance.integration.test.ts -t 'auth integration|native session revocation' --reporter=dot`, then run `tests/session-revocation-rollback.integration.test.ts` without the name filter. On this machine PostgreSQL additionally requires `--env-file=.env.test.local` before the Vitest script to select the isolated test database; the older canonical test database has unrelated migration-ledger drift.

The real local browser check used accessibility automation, never Playwright. Sign-in and protected News navigation worked. Reopening the admin with expired access restored sign-in through the explicit bootstrap without a password prompt. A replacement sign-in in a second tab made the first tab display the session-change interstitial with the active email; acknowledgement returned it to the admin. Confirmed logout returned to the sign-in form after restarting the dev server to load the updated provider contract, and sign-in was restored after testing. This was a same-account/new-sid browser check. Cross-account revocation is covered by adapter tests, not a claimed two-account browser race test.

[Local benchmark evidence](./experiments/password-session-ordering/README.md) records approximately 0.3–0.4 ms additional p95 verification latency. Tony asked to retain the measurements for a future user domain and not delay the editorial implementation with further optimization.

Review must distinguish these passing checks from exhaustive response-order validation. Real tab termination, deliberately reordered overlapping cross-account sign-in responses, and downstream deployment measurements have not been exercised. These smoke checks alone did not close CF-05/CF-08 or combined acceptance; the subsequent independent approval is recorded above without claiming those additional experiments occurred. No production release, commit, push, or replacement dev server was performed in this implementation phase.

The design handoff file is `packages/host-tanstack-start/src/admin-shell/chrome/session-change-boundary.tsx`. It is a component around the admin/sign-in views, not a standalone route. Preserve its fresh identity verification, explicit acknowledgement, disabled pending button, and discarded old-page work while improving its layout.

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

## Implementation sequence and architectural constraints

This section is the current resume point and supersedes historical recommendations below. Tony explicitly selected retaining JWT access tokens and refresh tokens, including the session-provider boundary for possible future IAM integration. Do not replace native authentication with opaque database sessions.

| Settled requirement | Implementation consequence |
| --- | --- |
| Persistent sign-in across normal browser restarts | Retain persistent credentials and sliding refresh expiry; no browser-close sign-out or monthly absolute lifetime. |
| Immediate account invalidation after password change/reset/disable | Preserve D2 and its account generation (`sv`); re-enable never revives sessions. |
| Immediate per-login invalidation after logout/replay | Add native login state and `sid`, checked alongside `sv` behind the provider interface. JWT verification in the native provider is consequently not entirely stateless. |
| Coordination-first renewal | Separate renewal from business requests; same-tab single-flight first, cross-tab coordination second. |
| Fresh sign-in after refresh collisions escaping coordination | Retain strict replay handling; no grace window or successor-token cache is approved. |
| Preserve independent-device logins and account identity | An old response must not silently restore another live account; accepted reauthentication does not authorize this outcome. |

**Historical cookie counterexample, now covered by the approved detection residual:** Two overlapping sign-ins may each create a live login without observing the other. A delayed response can then overwrite the newer login's fixed-name cookies. Per-login revocation rejects revoked credentials but does not reject an older login that is still live. Refresh coordination and deleting cookies alone do not settle this case.

Task 3 implementation is now authorized. Follow this sequence under the approved detection residual:

1. Add native login membership, `sid` verification, and atomic login revocation on both adapters. Keep account-generation composition and provider encapsulation. Implement predecessor logout with confirmed failure reporting; membership removes the traversal ceiling from authorization. Benchmark the added lookup before accepting the design.
2. Add explicit CSRF-protected renewal and verification-only business/SSR contexts. Only a pre-handler expiry outcome permits one resend, bound to the original login. Preserve SSR and preview authentication through the reviewed bootstrap flow.
3. Add same-tab coordination and the reviewed cookie/sign-in ordering behavior. Emit contested-refresh events. Add cross-tab coordination as the next stage with a documented fallback; do not require Web Locks for the first stage.
4. Validate both adapters, real host boundaries, and browser response ordering using an agreed non-Playwright harness. Replace the known-regression characterization with acceptance tests, run the relevant gates and build, and seek combined R2/R3 acceptance. Ship `sv` and `sid` together as one forced-sign-in cutover.

**Inactive work:** opaque database-session replacement, session-only browser binding, and the experimental IndexedDB/browser marker are not selected. Receipts, versioned credential cookies, the signed selector, receipt recovery UI/CSP, its retry loop, and absolute monthly expiry remain an inactive alternative, not task 3 requirements. The isolated models are exploratory evidence, not browser validation or a reviewed implementation.

**Verification constraint:** Tony has discontinued Playwright. Do not run or add Playwright tests. Do not disturb the user’s normal dev server. Record migration and test evidence separately from implementation authorization.

## Historical pause and resume checkpoint (2026-09-08)

**Ready to pause after documentation validation.** Tony is taking this same machine home. No step-3 runtime implementation, new migration, or database change was made during this design phase. Tony subsequently requested commits for the checkpoint. Step-2 implementation, tests, migrations, and current-behavior documentation are committed as `74d28e13` (`fix: added account session revocation checkpoint`). The accompanying specs commit records this handoff and the D3 design. Both use DCO sign-off only. No push, server, or background job was requested or started for this handoff.

Selected: coordination-first, explicit renewal outside business requests, staged same-tab then cross-tab coordination as the proposed architecture, and Tony's explicit acceptance that collisions escaping coordination may require fresh sign-in. Preserve sliding refresh expiry and approved D2 immediate account-wide invalidation. Receipts remain a documented alternative, not active work.

On resumption, read **Selected D3 scope: coordination-first** in the specification and the CF acceptance table below. Resumed decision state before implementation:

1. **Selected on resumption:** Tony approved immediate per-login access invalidation after logout/replay. The specification proposes sid-backed login state, account-generation composition, and same-login retry protection. No receipt state or monthly lifetime is selected.
2. Complete late successful refresh/logout/sign-in response handling with fixed cookies. The accepted collision tradeoff does not permit revoked-session revival or silent replacement of a newer login. Review the exact fallback and both response orders.

Then obtain protocol review and implementation authorization, and follow the coordination-first sequence. Do not execute the retained receipt sequence. R2 remains open; passing the existing known-regression test still demonstrates the unfixed behavior. Do not call the plan fully settled or the implementation releasable merely because it is portable.

No live session state or temporary process is needed to resume this design. Start the user's normal local databases/dev server as needed after the move; do not rely on their current running state. The previously verified development schemas are current for step 2, and the PostgreSQL migration-ledger caveat remains recorded below.

## Start here in the next session

1. Read root `AGENTS.md`, relevant package instructions, this plan, and its companion specification. Inspect `git status`, branch, and recent commits before editing. The handoff was prepared on `develop`, based on release commit `7cc6cd14` (`chore(release): 5.0.0`). The implementation commit is recorded below after creation.
2. Preserve the approved step-1 implementation. The most recent user message explicitly states that independent review considers step 1 complete. Do not restore account-wide/global buckets, remove request cleanup, reintroduce configuration-owned timers, or replace the shared HMAC secret with per-process randomness.
3. Confirm the new machine's dependencies and local database/server configuration. The old machine had both development databases and the dev server running; this is not evidence that the new machine does. The user restarted dev after the scheduler/HMAC changes. Singleton configuration changes require a fresh server process.
4. D2-A/B were selected in the resumed session: immediate invalidation, fresh sign-in, and no revival after re-enable. Preserve these decisions; the specification records the chosen generation and transaction design.
5. Review the step-2 changes and the resumed-session evidence below. Token issuance and account mutations now share an account lock; the ordinary concurrent-refresh/cookie protocol remains D3 work.
6. Step 2 is implemented but its R2 review remains open. Review and select the consolidated D3 proposal in the companion specification, then implement step 3 and seek combined R2/R3 acceptance. Update the checkboxes and evidence below as work progresses. No separate agent/task should be created without an explicit request or applicable instruction.

No live passwords, JWT secrets, cookies, or database credentials are included in this handoff. Obtain local development credentials through the new machine's existing ignored environment files or the user. Do not put the previously supplied test password into commits, test fixtures, or logs. The committed transport fixture requires no credentials or database.

## Commit and progress ledger

- [x] Step 1: unauthenticated admission, trusted IP, body bounds, HMAC identities, observability, scheduler cleanup, configuration/templates, native SQL release scripts, and regression tests.
- [x] Independent review: user confirmed step 1 complete, including 55 scheduler tests, 10 limiter tests, and the real Start test in the final review. Earlier independent review also ran the complete 226-test host node suite.
- [x] Portable specification and plan prepared under `specs/`.
- [x] D2-A: immediate access-JWT invalidation selected by the user in the resumed session.
- [x] D2-B: fresh sign-in after self-service password change; re-enable never revives old sessions.
- [x] Step 2: implement, test, and review password/disable revocation and necessary issuance fencing.
- [x] Step 3.1: prepare a consolidated D3 proposal with explicit policies and review gates.
- [x] D3 scope: Tony selected coordination-first and explicitly accepted fresh sign-in after collisions that escape coordination.
- [x] D3 access policy: Tony approved immediate per-login access invalidation after logout/replay.
- [x] D3 cookie gate: Tony accepted the detected account-switch residual with pre-handler sid enforcement and acknowledgement before further work.
- [x] Step 3: implement, test, and review atomic refresh and lineage revocation.
- [ ] Review the two downstream production applications with the user.
- [ ] Complete release squash, CLI baseline synchronization, full gates, and rollout verification.

Implementation commit: `4d02070359e3e81fbf855ccc2cc5e92939d92efd` — `fix: hardened password sign-in admission`. The following `specs:` commit contains this handoff. Both commits use the required DCO sign-off; no co-author or AI-attribution trailers are present.

Commit rules: follow `.agents/skills/commit/SKILL.md`, `.claude/skills/git-commit/SKILL.md`, and `.claude/rules/conventional-commits.md`. Use conventional lowercase, preferably past-tense subjects; `specs:` is the repository's type for these documents. Use `git commit -s` for required DCO sign-off. Do not add co-authors or AI attribution. Stage specific files, preserve unrelated work, and do not bypass hooks/signing. No push, publish, release, or production mutation was requested.

## Step 2 implementation tasks

### 2.1 Inventory and policy note

Read these concrete entry points before editing:

- `packages/admin/src/modules/admin-account/service.ts`: `changePassword`; revocation now belongs to the native repository password transaction.
- `packages/admin/src/modules/admin-account/commands.ts`: constructs the service with only the user repository today.
- `packages/admin/src/modules/admin-users/service.ts`: `setPassword`, `disableUser`, `enableUser`, and deletion safeguards.
- `packages/admin/src/modules/admin-users/commands.ts`: service construction and authorization.
- `packages/admin/src/modules/admin-users/repository.ts`, `packages/admin/src/modules/auth/refresh-tokens-repository.ts`, and `packages/admin/src/store.ts`: current adapter-independent seams.
- Both adapters' `src/modules/admin/admin-users-repository.ts`, `refresh-tokens-repository.ts`, and `admin-store.ts`: transaction participation, optimistic revision checks, and revocation SQL.
- `packages/admin/src/modules/auth/jwt-session-provider.ts`: initial issuance, access verification, refresh issuance, logout.
- `packages/auth/src/session-provider.ts`: `AccessTokenPayload`, provider contract, capability boundaries.
- Host `src/server-fns/admin-account/change-password.ts`, `admin-users/set-password.ts`, and `admin-users/disable.ts`; SDK `packages/client/src/server/admin-context.ts` and `session-cookies.ts`.

Record the user's decision in the specification and select a concrete transaction/fence design. The implementation uses an integer session version for the selected immediate-invalidation policy. A timestamp solution must address seconds-versus-milliseconds and same-second issuance. Preserve `vid` concurrency checks separately from authentication generations.

### 2.2 Implement account mutation and revocation coherently

1. Add the smallest provider/repository/transaction seam needed to change password or enabled state and revoke native sessions atomically. Audit every caller, test fixture, and adapter together.
2. Reuse `revokeAllForUser` where applicable. Do not implement two independent writes and describe them as atomic.
3. Make refresh check current enabled/account state and coordinate it with account mutation. Audit initial login that verifies an old password before a concurrent password change. Define and test commit ordering for both paths.
4. If immediate access invalidation was chosen, implement the new claim/state check in access verification and both token-issuance paths, plus legacy-token and rollout policy. Authorization already resolved for an in-flight request is not retroactively cancelled.
5. Implement the selected current-session cookie/UX policy. Other browsers' refresh sessions must not survive accidentally. Do not confuse JWT jti with refresh-token row identity.
6. Update both Drizzle development schemas/migrations if required and add native SQL release scripts under the user's workflow below. Update public provider contracts, templates, docs, and the existing breaking changeset as needed.
7. Remove/update comments that still promise future revocation after implementing it. Preserve third-party provider limitations explicitly.

### 2.3 Acceptance tests and review checkpoint

| ID | Required evidence |
| --- | --- |
| R2-01 | Self-service successful password change rejects the old password, accepts the new password, and revokes sessions according to D2-A/B. |
| R2-02 | Wrong current password, authorization failure, stale `vid`, and failed database writes do not partially change password or revocation state. |
| R2-03 | Administrator password reset revokes the same relevant native sessions; the self-service-only fix is insufficient. |
| R2-04 | Disable rejects access/refresh; re-enable does not revive old refresh sessions. Explicitly assert the selected behavior for unexpired old access JWTs. Hard delete continues to cascade. |
| R2-05 | Two existing sessions plus the changing session exercise current-session UX, cookies, and cross-session invalidation. |
| R2-06 | Deterministic barriers pause refresh and initial sign-in before mutation/issuance. A committed password change/disable cannot be followed by an unauthorized surviving session issued from old state. |
| R2-07 | Injected revocation/mutation failure rolls the entire change back in both PostgreSQL and MySQL. Retry only confirmed rollback cases. |
| R2-08 | If claims change, test old/missing/malformed claims, same-second events, successive changes, and migration compatibility explicitly. |

Do not declare step 2 complete if its required race ordering still relies on the unfixed step-3 provider. Bring forward the necessary atomic primitive, or record the remaining gap and keep the checkpoint open. Publish exact commands/results for independent review rather than only a narrative summary.

## Step 3 implementation tasks

### 3.1 Design before changing refresh behavior

Read the current provider, both refresh repositories, `packages/client/src/server/admin-context.ts`, request memoization, and cookie transport as one protocol. Inventory the existing comments that incorrectly describe atomic rotation, including the MySQL schema's rotated-to comment and the SDK context description.

Write a decision table for first refresh, benign concurrent loser, replay inside/outside any tolerance window, logout, password change, disable, expiry, failed transaction, and late response arrival. Specify shared-instance behavior and whether any browser coordination or retry response is required. Coordination-first and residual reauthentication are selected; the access policy is settled and the detected account-switch residual is now approved.

Preserve hash-only refresh-token storage unless the user explicitly approves a different tradeoff. A loser cannot retrieve already-issued plaintext from its hash. A process-local promise map is insufficient across instances. A linear compare-and-swap chain does not by itself order rotation against revocation. A family identifier may help some designs but is not mandated. Any deterministic successor derivation or cache scheme needs its own security analysis and review; do not introduce one as an incidental fix.

### 3.1 review draft and implementation sequence (2026-09-08)

Coordination-first with JWT credentials is the selected direction. Immediate per-login invalidation and residual refresh-collision reauthentication are approved; the detected account-switch residual is approved. The current decision section above is authoritative.

The retained receipt sequence and tests below record an earlier, unapproved alternative. They are not the active draft and must not be executed. The companion specification retains their technical rationale for possible evidence-driven reconsideration.

Active development sequence after protocol review:

1. Incorporate the selected immediate per-login policy using the proposed sid identity, then settle the late-response cookie gate. Define exactly which R3 availability outcomes use the accepted fresh-sign-in fallback; never weaken revocation correctness.
2. Introduce the verification-only context and mandatory pre-handler authentication boundary, plus explicit CSRF-protected renewal with an access-valid no-op. Check boundary coverage and forbid retry markers from handler errors.
3. Stage A: one same-tab renewal promise, one retry of a handler-not-started operation, authentication-action serialization, and the existing-route SSR bootstrap. Web Locks is not a prerequisite.
4. In parallel with the stage's functional work, complete the common server fixes: logout from predecessors, all-lineage revocation beyond 1,000 rows, transaction/rollback behavior, and honest logout failure reporting. These remain mandatory for release.
5. Add best-effort session-event instrumentation and accurate metric denominators. Stage B adds Web Locks with same-tab fallback and non-secret cross-tab notifications. No measurements are assumed in advance.
6. Test both databases and real browsers, including cross-tab/SSR/late-response faults; obtain combined R2/R3 acceptance. Stage A's smaller scope does not make the currently blocked step 2 independently releasable.

Coordination-first acceptance additions:

| ID | Required evidence |
| --- | --- |
| CF-01 | Six parallel same-tab business requests at expiry cause one committed renewal; late stale expiry responses reach the access-valid no-op instead of another rotation. |
| CF-02 | Only pre-handler outcomes permit one business retry; every covered handler has zero side effects on that outcome. Post-handler failures and ambiguous network outcomes never trigger replay. |
| CF-03 | Business and SSR context resolution never rotate/write/clear cookies; the explicit renewal endpoint is CSRF-protected and emits cookies only on confirmed success. |
| CF-04 | Valid SSR, anonymous public reads, expired-access bootstrap, safe return URLs, loop guard, disabled scripting, and service-error UI follow the reviewed contract. |
| CF-05 | Same-tab cookie-writing actions serialize; Stage B coordinates tabs when available and falls back without disabling authentication. Test tab death and uncertain response completion. |
| CF-06 | Strict contests revoke renewal and produce measured terminal outcomes. Test both attacker orderings, independent providers/connections, and no sibling/orphan survival. |
| CF-07 | Predecessor logout, legacy branching/cycles, deep lineages, transaction failure, and misleading logout success are covered on both adapters. |
| CF-08 | Both response orders for refresh/logout/new-sign-in satisfy the selected cookie and per-login access policy. No old-session revival or silent cross-login mutation retry. |
| CF-09 | Event hooks cannot fail authentication, secrets never appear, revocation telemetry reflects commit outcomes, and contest rates have renewal denominators. Measure correlated failures and sign-in throttling. |

The receipt-specific sequence below is retained for reference only; do not execute it under the selected coordination scope.

If the receipt candidate and its separate policies are approved after the benchmark/review gate, implement in this order:

1. Define native login/recovery contracts and adapter schema/transactions, including database time read after locking, uniqueness, receipt caps, and account-generation composition. Preserve hash-only secrets and account-first locking.
2. Implement login access checks, full-login revocation, atomic rotation, independent receipts and acknowledgements, and deadline checks. Register the bounded sweep task; test access denial with the scheduler stopped.
3. Implement the cookie selector/namespaces, bounded enumeration, exact-name cleanup, preview scoping, and public-cache detection. Include the absolute lifetime and legacy fresh-sign-in rollout.
4. Audit host authentication-before-side-effects and error serialization. Record which operations can safely retry; do not infer safety from comments or method names.
5. Implement the CSRF-protected recovery/termination endpoints, bounded fetch recovery, SSR recovery document, and same-login retry guard. Change logout to report revocation failures honestly.
6. Complete the tests below, replace the known regression test, rerun the relevant full gates and production build, and request combined R2/R3 review. No release approval is implied.

Additional acceptance evidence beyond R3-01–08:

| ID | Required evidence |
| --- | --- |
| D3-T01 | Two and several benign losers each receive a different receipt; batch exactly the supplied secrets; an omitted receipt remains pending. Cover invalid/mixed-login batches, idempotency, late arrivals, and R2 acknowledging a receipt for R0. |
| D3-T02 | Both attacker orderings, including attacker-first with identical IP/UA and attacker-created self-acknowledged receipts, expire the legitimate unresolved contest. |
| D3-T03 | Lost receipt response, closed tab, lost winner response, no scheduler, and attacker access-only use all enforce the unresolved deadline. No claim that the deadline bounds undetected theft. |
| D3-T04 | Expiry equality, lock waits spanning admission/deadline boundaries, and skewed application clocks use fresh database time. No transaction-start timestamp extends tolerance. |
| D3-T05 | Missing/throwing IP resolver and network/UA changes preserve receipt behavior; sign-in's existing fail-closed tests remain unchanged. |
| D3-T06 | Receipt cap boundaries, acknowledged receipt counting, malformed/unknown receipts, expiry, duplicate acknowledgement, wrong successor/login, and cross-account requests fail safely with bounded work. |
| D3-T07 | Access verification composes sid/ownership/generation/revocation/expiry/receipt status without a second account read; account changes still invalidate every login. |
| D3-T08 | Real browser response reversal within a login and across fresh sign-in preserves newer credentials; old logout/recovery/password responses cannot erase a new selector or affect its preview. |
| D3-T09 | Cookie header ordering, spoofed rotation suffixes, duplicate names, eviction, eight-pair/8 KiB limits, late cleanup, selector tombstones, and absolute expiry never fall back to an old login. |
| D3-T10 | Fetch recovery uses at most seven scheduled attempts per receipt through the available deadline, with no early 1.85-second cutoff; a winner arriving at 3 seconds can recover. Batching stays bounded and permits one business retry; a new sid prevents replay; unknown network/commit failures never trigger automatic mutation retries. |
| D3-T11 | Real SSR recovery safely delivers the receipt outside URLs, performs at most one recovery navigation, preserves a validated destination, and terminates without JavaScript or on repeated failure. Verify effective CSP nonce/module policy, multiple policy headers, blocked scripts, and absence of receipt secrets in reporting. |
| D3-T12 | Recovery CSRF/body/cache controls, all auth-cookie cache bypass paths, logout DB failures, multi-instance receipt processing, and rollback at every state transition are covered. |
| D3-T13 | Legacy missing-sid and branched data fail closed; fresh lineages beyond 1,000 rotations revoke fully on replay, logout, and account mutation. |
| D3-T14 | Benchmark both-adapter verification paths with representative history and 0/1/32 unresolved receipts; report latency, throughput, plans, and contention before package approval. Measure 2/6/20-request recovery with correlated faults and subsequent sign-in throttling. |

No implementation or migrations were changed while preparing this draft. Validation: `pnpm docs:check` passed (72 documents, 709 links); the same checker including both security specs passed after the coordination-first handoff (74 documents, 719 links); `git diff --check` passed. The initial sandboxed docs command could not open the tsx IPC socket; the normal command passed with local socket permission. No application tests were rerun for this documentation-only change. Prior green tests still include the known R2 regression and do not validate this proposed protocol.

### 3.2 Implement the reviewed protocol

1. Add adapter-level atomic rotation/claim primitives with explicit transaction, lock order, affected-row, and rollback semantics. Update the old `markRotated` contract if superseded.
2. Integrate the account fence/generation selected in step 2. Cover all issuance and revocation paths, including logout with a rotated predecessor.
3. Update host/SDK error and cookie handling for benign concurrency. A losing response must not erase a winner's new cookies; response reordering must not restore stale tokens.
4. Define replay containment across every descendant and remove or safely handle the 1,000-row traversal ceiling. Test existing malformed/branched chains if compatibility requires them.
5. Add only the schema/state the selected protocol requires. Coordinate both adapters, public interfaces, docs, templates, migrations, and release compatibility.

### 3.3 Acceptance tests and review checkpoint

| ID | Required evidence |
| --- | --- |
| R3-01 | Controlled concurrent refreshes yield one committed successor and the agreed benign-loser outcome, with no orphan rows. |
| R3-02 | Run against both real databases with independent connections/pools; add multiple provider/process instances where the protocol claims distributed coordination. |
| R3-03 | Replay inside/outside the selected tolerance follows the agreed policy; no plaintext persistence is introduced unnoticed. |
| R3-04 | Refresh versus logout/password mutation/disable cannot resurrect a revoked session; exercise both commit orders. |
| R3-05 | Transaction failure between predecessor/successor writes leaves no partial state. Deadlocks and ambiguous commit failures are distinguished. |
| R3-06 | Parallel real host requests at access expiry and out-of-order responses preserve browser session continuity and correct cookies. |
| R3-07 | Deep chains beyond 1,000 rows, already-revoked ancestors, and any supported legacy branching do not produce silently surviving unauthorized descendants. |
| R3-08 | Separate sessions/devices remain independent except where the selected account-wide mutation intentionally invalidates them. |

The original in-memory race reproduction is historical evidence, not a committed portable test. Recreate it as a deterministic regression test with barriers rather than sleeps or probabilistic timing. The previous counter concurrency test used 20 concurrent calls through two store objects sharing one pool; it did not prove multi-process refresh correctness.

## Environment and executable verification

Use the workspace's pinned pnpm 11 version from `package.json` and preferably the Node 22 version used in CI. Do not assume dependencies, database contents, or ignored environment files travel with Git. Use `pnpm install --frozen-lockfile`, then build packages if needed for their dist exports.

Database tests require package-local `.env.test` files. Existing test safety rejects database names without `_test`; development bootstrap accepts `_dev`/`_test`. Do not point integration suites at production or blindly reinitialize an existing development database. Consult package manifests and `vitest.config.ts` before changing setup. Keep shared Postgres/client integration runs serial. `pnpm db:init:test` and `pnpm db:init:test:mysql` are the root bootstrap commands for appropriately prepared local test environments.

Useful current commands, from the repository root:

```sh
pnpm --filter @byline/admin exec vitest run --mode=node tests/sign-in-rate-limiter.test.node.ts
pnpm --filter @byline/core exec vitest run --mode=node src/scheduler
pnpm --filter @byline/host-tanstack-start test:node
pnpm --filter @byline/webapp test:sign-in-transport
pnpm --filter @byline/db-mysql exec vitest run --mode=node tests/sign-in-deadlock.test.node.ts
pnpm --filter @byline/cli exec vitest run src/phases/wire/start-ts.test.ts src/phases/wire/server-ts.test.ts
pnpm --filter @byline/cli check:templates
pnpm --filter @byline/db-postgres exec vitest run --mode=integration tests/conformance.integration.test.ts -t 'shared sign-in rate limits'
pnpm --filter @byline/db-mysql exec vitest run --mode=integration tests/conformance.integration.test.ts -t 'shared sign-in rate limits'
pnpm --filter @byline/db-postgres exec vitest run --mode=integration tests/sign-in-rate-limit-migration.integration.test.ts
pnpm --filter @byline/db-mysql exec vitest run --mode=integration tests/sign-in-rate-limit-migration.integration.test.ts
```

`test:sign-in-transport` starts and closes its own real Start/Vite server. It substitutes application services, requires no database or real credentials, and runs in CI. It does not replace live real-provider/password tests for steps 2–3. On a sandboxed machine, local listener/tsx IPC restrictions may require the tool's approved local-execution mechanism; do not interpret EPERM as a product regression.

Static/release gates, respecting the repository's sequence:

```sh
pnpm byline:generate:check
pnpm docs:check
pnpm lint
pnpm typecheck
pnpm knip
pnpm knip:exports
pnpm test
pnpm test:integration
pnpm --filter @byline/cli check:templates
pnpm --filter @byline/cli check:artifact
pnpm build
node scripts/check-native-sql-history.mjs --base 7cc6cd14
git diff --check
```

`pnpm lint` modifies files through Biome; inspect its diff. Run focused tests while iterating, then the appropriate broader gates. Do not report the whole test suite as passing because focused tests passed.

## Independent review and follow-up (2026-09-08)

**Step 2 is not approved and is not independently releasable.** The reviewer independently passed the 14 revocation conformance cases and 4 rollback/migration cases per adapter, admin 199 tests, host 231 tests, and workspace typecheck. Those results approve revocation semantics only.

The blocking regression is concrete: two requests refresh the same browser cookie; one rotation commits, then the serialized loser sees the rotated predecessor and revokes its chain. There are zero active refresh rows and the winning token cannot be reused. Before step 2, overlapping readers could both succeed and create orphan siblings; the account lock replaces that integrity race with a deterministic loss of refresh continuity for this ordinary interleaving. The existing host error path can also clear the winner's cookies.

The selected review exit is to record the known regression and keep R2 open until the D3 protocol is selected and implemented. No grace period, replay tolerance, plaintext cache, or retry/cookie protocol has been approved by this follow-up. `session-revocation.ts` contains a permanent, deterministic `KNOWN REGRESSION R2/D3` characterization on both adapters. A passing characterization confirms the defect remains; it does not count as a passing concurrency acceptance test. Replace it with the selected D3 acceptance behavior when fixing the protocol.

Other review changes: the user-service fixture now models generation advances and synchronous session revocation; refresh issuance requires an explicit generation in TypeScript and checks it at runtime; native access verification uses one account read; self-service success feedback persists until the user chooses Sign in. PostgreSQL test commands below use Node's `--env-file`, avoiding shell-specific `source` syntax. The canonical PostgreSQL `byline_test` ledger drift remains unchanged and must not be mistaken for a passing full integration gate.

Follow-up verification:

- Both adapter runs passed 72 selected tests each, including the permanent known-regression characterization. The selection also matched existing rollback tests beyond the session suites. This confirms the regression persists; it does not close R2.
- Admin node suite: 203 passed. After adding service-level session assertions, the affected fixture/service/command selection passed 39 tests. The new success-confirmation component test passed in jsdom.
- Lint, workspace typecheck (44/44), docs (72 documents/709 links), Knip, public-export audit, and diff checks passed. The prior production-build result predates these review fixes; no new full production-build claim is made here.

Commands used for the database review follow-up, from the repository root:

```sh
pnpm --filter @byline/db-postgres exec -- node --env-file=.env.test.local node_modules/vitest/vitest.mjs run --mode=integration tests/conformance.integration.test.ts tests/session-revocation-rollback.integration.test.ts -t 'native session revocation|JwtSessionProvider|rolls back|native generation migration'
pnpm --filter @byline/db-mysql exec vitest run --mode=integration tests/conformance.integration.test.ts tests/session-revocation-rollback.integration.test.ts -t 'native session revocation|JwtSessionProvider|rolls back|native generation migration'
```

The `--` after `exec` is required here: without it, pnpm consumes `--env-file` before changing to the package directory, and the relative file is not found.

## Resumed-session evidence (2026-09-08)

D2-A/B are selected. Independent review approved the revocation semantics but rejected step 2 as a whole because serializing refresh now makes benign concurrency revoke the winner. The combined step-2 checkbox remains open; this implementation is not independently releasable. D3 and release are still open; the strict replay outcome, cookie-response races, logout lineage, and traversal ceiling are not claimed solved.

- `AdminStore.withSessionLock` supplies account-first transaction ordering to sign-in, refresh, and logout. Password/reset and both disable paths advance the generation and call `revokeAllForUser` within the mutation transaction.
- New conformance tests cover three-session self-service change, administrator reset, wrong-password/stale-revision rollback, disable/re-enable through both repository paths, old/malformed claims, legacy refresh rows, same-second successive changes, and both mutation-first and issuance-first races. The issuance-first tests require two physical database connections.
- Each adapter has a SQL failure-injection test for password, disable, and update-disable rollback, plus an idempotent native generation migration test. PostgreSQL uses a test trigger; MySQL uses a temporary CHECK constraint because trigger creation requires extra binary-log privileges on this local server.
- Focused adapter runs: 35 tests passed per database (14 new revocation cases and 21 existing provider cases). The separate rollback/migration files passed 4 tests per database.
- `pnpm --filter @byline/admin --filter @byline/host-tanstack-start test:node`: admin 199 passed; host 231 passed, including 5 password-change cookie tests.
- Generation check, docs check (72 documents/709 links), lint, workspace typecheck, Knip, public-export audit, and production build passed. Full unit/integration suites and release/CLI gates were not rerun. CLI baseline synchronization remains deliberately deferred under the release workflow below.

Local environment: Node 24.19.0, pinned pnpm 11.17.0, frozen install passed. PostgreSQL's old `byline_test` and development Drizzle ledgers predate the current squashed baseline. They were preserved. A separate `byline_session_security_test` database was prepared, with an ignored `packages/db-postgres/.env.test.local` override. MySQL's test database and ignored `.env.test` were prepared with user authorization. Do not assume these local files or databases travel with Git.

The following commands work in fish and POSIX shells. Reproduce the focused PostgreSQL run from the repository root after preparing a local `_test` database and its ignored environment override:

```sh
pnpm --filter @byline/db-postgres exec -- node --env-file=.env.test.local node_modules/vitest/vitest.mjs run --mode=integration tests/conformance.integration.test.ts -t 'native session revocation|JwtSessionProvider'
pnpm --filter @byline/db-postgres exec -- node --env-file=.env.test.local node_modules/vitest/vitest.mjs run --mode=integration tests/session-revocation-rollback.integration.test.ts
```

For MySQL, use its package-local `.env.test`:

```sh
pnpm --filter @byline/db-mysql exec vitest run --mode=integration tests/conformance.integration.test.ts -t 'native session revocation|JwtSessionProvider'
pnpm --filter @byline/db-mysql exec vitest run --mode=integration tests/session-revocation-rollback.integration.test.ts
```

Local development upgrade: PostgreSQL native scripts 0005 through 0012 were applied in order to fill verified missing columns/tables, preserving existing data and the old ledger. MySQL `byline_dev` was verified empty and initialized with the current Drizzle chain. Every current adapter column is now present in both development databases. After rebuilding all packages and restarting Vite, `/sign-in` and `/` returned HTTP 200; both sign-in-counter cleanup and scheduled-publication scheduler tasks reported success. No live password-change/browser-cookie exercise was performed against a real development user. PostgreSQL's old development ledger still cannot consume the squashed baseline directly; no ledger repair was performed.

Generated development additions for step 2 are PostgreSQL `0002_goofy_dakota_north.sql` and MySQL `0002_common_jimmy_woo.sql`, with generated snapshots/journals. Native release scripts are PostgreSQL `0012_add-session-generations.sql` and MySQL `0007_add-session-generations.sql`. No CLI baseline copy, commit, release, or production mutation was performed.

## Evidence at handoff

| Check | Recorded result and scope |
| --- | --- |
| Limiter | 10 tests passed after HMAC/scheduler changes: counter policy, IPv6, events, capacity, inert construction, bounded cleanup, lease loss, and secret isolation. |
| Scheduler | All 55 scheduler tests passed locally again during handoff preparation, matching the independent reviewer. The earlier focused boot/validation selection contained 11 tests. |
| Host node | All 226 tests passed locally and independently. |
| Real Start HTTP | Passed locally and independently: provider reached, actual body bounded, CSRF precedes body guard. |
| CLI host startup | 2 new tests passed; middleware wiring has 3 tests from the preceding stage. All four dialect/config template typechecks passed. |
| MySQL deadlock helper | 5 tests passed, including bounded 1213 retry and rejection of ambiguous/1205 retries. |
| Database counter conformance | 2 tests per adapter passed against local test databases; 20 concurrent operations through two store objects on one pool. |
| Native SQL | Both dialect release scripts applied twice to fixture tables, preserved existing counters, and matched Drizzle column/index shape. PostgreSQL ownership guard matched the established migration guard. |
| Static | Generation, docs (72 documents/709 links), lint, typecheck, Knip/public-export audit, and diff checks passed during the workstream. Public limiter option/event/policy types were intentionally added to the export baseline. |
| Earlier live dev check | Successful supplied-account login/sign-out and cookie checks; invalid shape/body/CSRF/throttling responses observed. Temporary scripts and credentials are intentionally not portable artifacts. |
| Production build | Passed earlier in step 1, before final scheduler/HMAC refinements. Do not claim a post-refinement production build without rerunning it. |
| Full CLI suite | Earlier run: 358 passed, 2 failed in `packages/cli/src/lib/baseline-drift.test.ts`, because new adapter incremental Drizzle migrations are not yet in the CLI baseline. This was directly observed, not inferred. Later focused CLI tests passed; do not claim the full suite is green. |
| Deployment | Dev was restarted by the user. No production application/proxy/WAF inspection, release, push, or deployment occurred. |

## User-directed SQL and release workflow

This is an explicit session instruction and supersedes the generic AGENTS.md instruction to keep CLI migration copies synchronized during development:

1. Drizzle migrations are for development. Generate incremental migrations using Drizzle; do not hand-edit meta snapshots.
2. Prepare plain SQL release scripts in `packages/db-postgres/sql` and `packages/db-mysql/sql`. Step 1 already added `0011_add-sign-in-rate-limits.sql` and `0006_add-sign-in-rate-limits.sql`, respectively.
3. PostgreSQL scripts creating tables must include the canonical ownership guard immediately before COMMIT, matching `packages/db-postgres/sql/0008_add-document-publish-schedules.sql`. MySQL has no equivalent PostgreSQL ownership operation; preserve its DDL/autocommit conventions.
4. The user manually squashes development Drizzle scripts before release, repairs the local development migration ledger, then copies the resulting single migration baseline into the CLI package. **Do not copy incremental migrations into CLI templates or silently squash/repair development ledgers in the next session.**
5. After the user performs that release work, rerun both CLI baseline drift tests, template/artifact checks, fresh-install and upgrade tests, and full release gates. The known failures must be closed, not waived forever.

Current development additions are PostgreSQL `src/database/migrations/0001_gray_titania.sql` and MySQL `0001_silky_revanche.sql`, their snapshots, and journal entries. They were applied on the original machine's development databases, which does not apply them on another machine. HMAC and scheduler refinements required no further database migration.

`.changeset/password-sign-in-admission.md` records a breaking upgrade: apply native SQL first, configure body middleware/protection and trusted IP, share the installation HMAC secret, register and execute cleanup, and verify task health. Extend this changeset/upgrade guidance for steps 2–3 as appropriate; do not publish package versions during implementation.

## Downstream review after steps 2–3

Obtain the two application locations and inspect their actual server configs, scheduler startup/health, proxy overwrite and bypass controls, single-value client-IP resolution, worker counts, HMAC secret consistency, telemetry/alerts, migration ordering/ownership, and cookie HTTPS behavior. Derive capacity and cleanup expectations from each deployment. Treat this as a separate deployment verification task; no production mutations have been authorized by this handoff.

## Resumed access-policy decision

Tony approved immediate per-login access invalidation after logout/replay. The coordination-first specification now proposes explicit login state and sid membership for JWTs/refresh rows, avoiding reliance on a 1,000-row traversal for revocation. This supersedes the earlier schema-preserving traversal candidate for the preferred design, subject to technical review. Access checks after commit must reject revoked sid state while independent logins remain valid; already-authorized operations retain the documented boundary.

The remaining design gate is cookie ordering: server revocation prevents old credentials from regaining authority but cannot stop a late Set-Cookie from replacing newer browser credentials. Finish and review that transport rule before implementation. This decision did not authorize runtime changes, a commit, or a release.

## Coordination scope and remaining cookie review

The approved immediate per-login policy expands coordination-first to a login record, an unpredictable sid carried by access JWTs and refresh rows, and a login-state check alongside account/permission verification. Neither account nor login validity overrides the other. Revocation by login membership removes chain traversal from the authorization decision; predecessor logout must confirm the revocation commit rather than swallow errors.

Receipts/table, versioned credential names, selector cookie, special SSR receipt document/CSP, receipt retry loop, and absolute monthly lifetime remain out. The ordinary bootstrap plus single pre-handler operation resend remains in. A scaled-down account/login/permissions benchmark on both adapters is now a pre-implementation design gate; the receipt-specific benchmark below stays inactive. If sv and sid ship together, plan one coordinated forced-sign-in cutover.

The reviewer recommends accepting late fixed-cookie overwrites as reauthentication. Keep this as a candidate until replacement-login revocation is defined: an old but still-live A is not rejected merely because B exists. Cover previous-login identification, account-switch lock ordering, independent devices, and an older in-flight sign-in absent from B's request. Do not claim that sid state alone orders browser writes or automatically invalidates older independent logins. Runtime implementation and release remain unapproved.

## Replacement sign-in proposal and residual

The specification now proposes atomically revoking each authenticated login observed in sign-in request cookies while issuing the destination login. Verify destination credentials first, acquire involved account locks in deterministic order, revalidate, and commit revocation plus issuance together. Revocation failure fails sign-in closed without cookies; failed sign-in must not partially revoke the previous login. Unrelated device logins survive. This proposal requires technical review and is not implemented.

Add acceptance cases for same-account replacement, cross-account replacement, access/refresh cookies naming distinct observed logins, forged identifiers, wrong password, revocation-write failure, uncertain commit, and both refresh/replacement commit orders. Add the explicit counterexample of two concurrent sign-ins that cannot observe each other's newly created sid. Test same-tab serialization, Web Locks, unsupported coordination, and tab termination without assuming any client lock cancels server work.

The counterexample leaves a live unobserved login whose late cookies can restore a different account. It is outside Tony's approved reauthentication tradeoff. Do not close CF-08 or R3 cookie acceptance until a reviewed browser-specific ordering/fencing rule handles it, or Tony explicitly selects a precisely described different policy. Account-wide sign-in revocation remains excluded. No implementation is authorized by this review exchange.

## Withdrawn browser-session binding recommendation

**Withdrawn:** Tony rejected the reduction in sign-in persistence after normal browser restarts. Do not execute this proposal. The historical draft proposed a stable browser-binding cookie and a server browser record containing current sid and authentication revision. Sign-in/refresh/logout never write that cookie; sign-in atomically supersedes the browser's current login, including a login whose response was not observed. Concurrent sign-ins against one revision cannot both succeed. Expected-sid checks on every business request prevent an old account's tab from silently operating under a newly selected account.

This is explicitly additional scope, not previously approved state. The proposed binding is a browser-session cookie to avoid reissuing an old binding from a late response. Closing/restarting the browser may therefore require fresh sign-in; Tony rejected that persistence consequence. Sliding refresh expiry stays; no monthly absolute lifetime is proposed. If cross-restart persistence is required, revise the binding lifetime protocol before implementation.

Review the spec's response-order table, account-first/multi-account transaction order, initial competing bootstrap responses, no-binding rejection, revision conflicts, and obsolete logout. Add these cases to CF-08; benchmark account + login + browser + permissions on both adapters and define bounded anonymous bootstrap admission/cleanup. These are design/validation prerequisites, not completed tests. Receipts, versioned credential names, and signed selector remain inactive alternatives. No runtime code or migration was changed.

## Persistent-sign-in clarification

Tony requires automatic sign-in across normal browser restarts while retained refresh credentials remain valid. The session-only binding recommendation above is withdrawn. The current decision and next work section at the beginning of this plan incorporates this requirement and the subsequent explicit decision to retain JWT authentication.
