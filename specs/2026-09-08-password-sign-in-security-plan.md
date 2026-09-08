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

Status: step 1 is independently approved. Step 2 remains blocked after independent review: revocation semantics are approved, but ordinary concurrent refresh now revokes the winning successor. It is not independently releasable. Step 3.1 has a consolidated D3 draft; step 3.2 implementation awaits review and selection. The user requested this committed handoff before moving to another machine. This plan is the portable source of workstream state; do not depend on the previous session's memory, temporary scripts, or local databases.

## Pause and resume checkpoint (2026-09-08)

**Ready to pause after documentation validation.** Tony is taking this same machine home. No step-3 runtime implementation, new migration, or database change was made during this design phase. Tony subsequently requested commits for the checkpoint. Step-2 implementation, tests, migrations, and current-behavior documentation are committed as `74d28e13` (`fix: added account session revocation checkpoint`). The accompanying specs commit records this handoff and the D3 design. Both use DCO sign-off only. No push, server, or background job was requested or started for this handoff.

Selected: coordination-first, explicit renewal outside business requests, staged same-tab then cross-tab coordination as the proposed architecture, and Tony's explicit acceptance that collisions escaping coordination may require fresh sign-in. Preserve sliding refresh expiry and approved D2 immediate account-wide invalidation. Receipts remain a documented alternative, not active work.

On resumption, read **Selected D3 scope: coordination-first** in the specification and the CF acceptance table below. Finish these two gates before implementation:

1. Select access-token behavior after logout/replay: immediate per-login invalidation or the explicit remaining access TTL. Tony has not selected this policy. Its session identity also affects same-login retry protection.
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
- [ ] Step 2: implement, test, and review password/disable revocation and necessary issuance fencing.
- [x] Step 3.1: prepare a consolidated D3 proposal with explicit policies and review gates.
- [x] D3 scope: Tony selected coordination-first and explicitly accepted fresh sign-in after collisions that escape coordination.
- [ ] D3 protocol: settle per-login access invalidation and late-write cookie handling; review the full design before implementation.
- [ ] Step 3: implement, test, and review atomic refresh and lineage revocation.
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

Write a decision table for first refresh, benign concurrent loser, replay inside/outside any tolerance window, logout, password change, disable, expiry, failed transaction, and late response arrival. Specify shared-instance behavior and whether any browser coordination or retry response is required. Coordination-first and residual reauthentication are selected; the complete protocol still has access-policy and cookie gates.

Preserve hash-only refresh-token storage unless the user explicitly approves a different tradeoff. A loser cannot retrieve already-issued plaintext from its hash. A process-local promise map is insufficient across instances. A linear compare-and-swap chain does not by itself order rotation against revocation. A family identifier may help some designs but is not mandated. Any deterministic successor derivation or cache scheme needs its own security analysis and review; do not introduce one as an incidental fix.

### 3.1 review draft and implementation sequence (2026-09-08)

The user authorized proceeding with the design proposal, not implementing an unreviewed grace period. The specification's **D3 proposal: bounded recovery with independent receipts** is the current consolidated draft. The latest independent review endorsed the direction but did not approve grace. It identified missing refresh metadata, abandoned recovery, and per-login invalidation as unresolved. The draft addresses them with a new receipt protocol and withdraws metadata as a security gate. These recommendations are not selected policy yet.

The new proposal requires review of the entire package: independent receipt per loser, acknowledgement requiring both receipt and live successor, server-enforced expiry, immediate login revocation, versioned credential cookies with a sign-in-only selector, and a proposed 30-day absolute login lifetime. A scheduler alone does not establish safe recovery: possession of the successor must never clear another request's receipt. IP and UA become advisory; approved sign-in IP admission remains unchanged.

The subsequent consolidated-draft review endorsed the security argument but withheld package approval. The specification now compares coordination-first strict replay with receipts and recommends developing the smaller option first if Tony accepts residual reauthentication. Scope, per-login access invalidation, and absolute lifetime are separate unselected decisions. The browser lock does not itself solve SSR overlap, successful-cookie response races, deep-lineage revocation, or immediate access invalidation.

Receipt draft corrections adopted for review: batch up to 32 supplied secrets, allow the current live descendant beyond the direct successor, retry through the available five-second budget, integrate SSR CSP nonces, and record sign-in-storm effects. Batching does not eliminate lost-receipt or correlated-failure risk. A comparative verification-path benchmark is required before approving the receipt package; no benchmark has been run.

Tony has now explicitly accepted fresh sign-in after refresh collisions that escape coordination. The specification's **Selected D3 scope: coordination-first** is the active design. Preserve sliding refresh expiry; monthly reauthentication is not selected. Per-login access invalidation and residual late-cookie-write handling remain open, and no implementation is authorized yet.

Active development sequence after protocol review:

1. Settle per-login access policy, same-login retry identity, and the late-response cookie gate. Define exactly which R3 availability outcomes use the accepted fresh-sign-in fallback; never weaken revocation correctness.
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
