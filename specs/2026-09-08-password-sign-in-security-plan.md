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

Status: step 1 is independently approved. Steps 2 and 3 are not implemented. The user requested this committed handoff before moving to another machine. This plan is the portable source of workstream state; do not depend on the previous session's memory, temporary scripts, or local databases.

## Start here in the next session

1. Read root `AGENTS.md`, relevant package instructions, this plan, and its companion specification. Inspect `git status`, branch, and recent commits before editing. The handoff was prepared on `develop`, based on release commit `7cc6cd14` (`chore(release): 5.0.0`). The implementation commit is recorded below after creation.
2. Preserve the approved step-1 implementation. The most recent user message explicitly states that independent review considers step 1 complete. Do not restore account-wide/global buckets, remove request cleanup, reintroduce configuration-owned timers, or replace the shared HMAC secret with per-process randomness.
3. Confirm the new machine's dependencies and local database/server configuration. The old machine had both development databases and the dev server running; this is not evidence that the new machine does. The user restarted dev after the scheduler/HMAC changes. Singleton configuration changes require a fresh server process.
4. Ask the user to choose D2-A: immediate invalidation of outstanding access JWTs versus allowing their remaining lifetime (normally at most 15 minutes). Also confirm whether self-service password change signs out the changing session or securely replaces it, and the chosen disable/re-enable behavior. Do not infer approval from the reviewer's statement that either option is possible.
5. While awaiting that decision, inventory mutation/issuance call sites and transaction facilities and design the race tests. Do not change token payloads or commit to session-version/timestamp schemas until the policy is selected.
6. Implement step 2 and obtain independent review, then settle the step-3 concurrency protocol before implementing it. Update the checkboxes and evidence below as work progresses. No separate agent/task should be created without an explicit request or applicable instruction.

No live passwords, JWT secrets, cookies, or database credentials are included in this handoff. Obtain local development credentials through the new machine's existing ignored environment files or the user. Do not put the previously supplied test password into commits, test fixtures, or logs. The committed transport fixture requires no credentials or database.

## Commit and progress ledger

- [x] Step 1: unauthenticated admission, trusted IP, body bounds, HMAC identities, observability, scheduler cleanup, configuration/templates, native SQL release scripts, and regression tests.
- [x] Independent review: user confirmed step 1 complete, including 55 scheduler tests, 10 limiter tests, and the real Start test in the final review. Earlier independent review also ran the complete 226-test host node suite.
- [x] Portable specification and plan prepared under `specs/`.
- [ ] D2-A: choose immediate or bounded access-JWT invalidation.
- [ ] D2-B: choose current-session UX and pin disable/re-enable semantics.
- [ ] Step 2: implement, test, and review password/disable revocation and necessary issuance fencing.
- [ ] D3: select benign-concurrency/replay/cookie protocol.
- [ ] Step 3: implement, test, and review atomic refresh and lineage revocation.
- [ ] Review the two downstream production applications with the user.
- [ ] Complete release squash, CLI baseline synchronization, full gates, and rollout verification.

Implementation commit: `4d02070359e3e81fbf855ccc2cc5e92939d92efd` — `fix: hardened password sign-in admission`. The following `specs:` commit contains this handoff. Both commits use the required DCO sign-off; no co-author or AI-attribution trailers are present.

Commit rules: follow `.agents/skills/commit/SKILL.md`, `.claude/skills/git-commit/SKILL.md`, and `.claude/rules/conventional-commits.md`. Use conventional lowercase, preferably past-tense subjects; `specs:` is the repository's type for these documents. Use `git commit -s` for required DCO sign-off. Do not add co-authors or AI attribution. Stage specific files, preserve unrelated work, and do not bypass hooks/signing. No push, publish, release, or production mutation was requested.

## Step 2 implementation tasks

### 2.1 Inventory and policy note

Read these concrete entry points before editing:

- `packages/admin/src/modules/admin-account/service.ts`: `changePassword`; the documented non-revocation deferral is still present.
- `packages/admin/src/modules/admin-account/commands.ts`: constructs the service with only the user repository today.
- `packages/admin/src/modules/admin-users/service.ts`: `setPassword`, `disableUser`, `enableUser`, and deletion safeguards.
- `packages/admin/src/modules/admin-users/commands.ts`: service construction and authorization.
- `packages/admin/src/modules/admin-users/repository.ts`, `packages/admin/src/modules/auth/refresh-tokens-repository.ts`, and `packages/admin/src/store.ts`: current adapter-independent seams.
- Both adapters' `src/modules/admin/admin-users-repository.ts`, `refresh-tokens-repository.ts`, and `admin-store.ts`: transaction participation, optimistic revision checks, and revocation SQL.
- `packages/admin/src/modules/auth/jwt-session-provider.ts`: initial issuance, access verification, refresh issuance, logout.
- `packages/auth/src/session-provider.ts`: `AccessTokenPayload`, provider contract, capability boundaries.
- Host `src/server-fns/admin-account/change-password.ts`, `admin-users/set-password.ts`, and `admin-users/disable.ts`; SDK `packages/client/src/server/admin-context.ts` and `session-cookies.ts`.

Record the user's decision in the specification and select a concrete transaction/fence design. A session version is one candidate for immediate invalidation, not an already-approved schema. A timestamp solution must address seconds-versus-milliseconds and same-second issuance. Preserve `vid` concurrency checks separately from authentication generations.

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

Write a decision table for first refresh, benign concurrent loser, replay inside/outside any tolerance window, logout, password change, disable, expiry, failed transaction, and late response arrival. Specify shared-instance behavior and whether any browser coordination or retry response is required. No protocol has been selected yet.

Preserve hash-only refresh-token storage unless the user explicitly approves a different tradeoff. A loser cannot retrieve already-issued plaintext from its hash. A process-local promise map is insufficient across instances. A linear compare-and-swap chain does not by itself order rotation against revocation. A family identifier may help some designs but is not mandated. Any deterministic successor derivation or cache scheme needs its own security analysis and review; do not introduce one as an incidental fix.

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
