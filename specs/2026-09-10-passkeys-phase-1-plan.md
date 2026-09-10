---
title: "Optional passkeys — Phase 1 implementation plan"
path: "passkeys-phase-1-plan"
summary: "Implement optional native passkeys in reviewable stages with equivalent PostgreSQL and MySQL behavior and preserved session guarantees."
---

# Optional passkeys — Phase 1 implementation plan

Companions:

- [Approved Phase 1 specification](./2026-09-10-passkeys-phase-1-spec.md) defines scope, recovery, and session policy.
- [Authentication and authorization](../docs/07-auth-and-security/01-authn-authz.md) documents current configuration and provider contracts.
- [Password security plan](./2026-09-08-password-sign-in-security-plan.md) records the existing session implementation and cleanup follow-up.
- [Testing](../docs/13-testing.md) describes package test environments and database safety.

Date: 2026-09-10. Status: review complete on 2026-09-10 after the release-workflow correction and the telemetry/dependency additions; awaiting Tony's approval to begin Stage 1. No implementation performed. The specification is approved for planning. You can use the stages below to implement and verify the feature without introducing Phase 2 enforcement.

## Start here in the next session

1. Read the [approved specification](./2026-09-10-passkeys-phase-1-spec.md) first, then this plan. Inspect `git status`, the branch, and recent commits before editing. The next session is expected to run on a different machine in another office: nothing in a local working tree, local database, or agent memory travels. Both documents were committed on `develop` in the `specs:` commit that contains this handoff; confirm that commit is present on the remote before relying on it, and pull it before starting.
2. Nothing in this plan has been implemented. No dependency has been added, no migration generated, no schema changed, no test written. The last code commit before the pause was `82765d1f` (`docs(client): corrected session cookie comments that described implicit refresh`); only the specs commit follows it. Confirm the new machine's dependencies with `pnpm install --frozen-lockfile` and its local `_dev`/`_test` databases before running integration gates; the password-security plan records what those environments need.
3. Confirm Tony's approval to begin, then start with Stage 1's first item: the npm registry `engines` check for the SimpleWebAuthn packages. Do not add the dependency until that record exists, because a Node 22 floor would need its own runtime compatibility proposal against Byline's advertised `>=20.9.0`.
4. Work stage by stage and stop at each checkpoint for review. Record commands, results, and outstanding failures beside the stage as the password-security plan did; do not report inherited test counts as evidence for new code.
5. Preserve the session guarantees the specification lists. The extracted shared issuance in Stage 3 must keep the current `signInWithPassword` transaction shape: verify outside the lock, revalidate under sorted account locks, revoke observed logins, issue, commit together.
6. Follow the repository's migration workflow: incremental Drizzle migrations plus new numbered native SQL scripts during development; the CLI baseline squash is Tony's explicit pre-release step. The password-security plan's open login-session cleanup follow-up is now owned by Stage 5 here.
7. Commit only when Tony asks, one conventional commit per logical chunk, `git commit -s`, DCO sign-off as the only trailer. No Playwright. Do not disturb the running dev server or the local databases without asking.

## Resolved review details

- Accept an omitted `crossOrigin` field or explicit `false` in verified client data; reject `true` and non-boolean values. Test registration and authentication independently. This follows the [WebAuthn client-data and verification rules](https://www.w3.org/TR/webauthn-3/#dictdef-collectedclientdata). Do not modify the signed bytes before verification.
- Current `AdminUsersService` protects self-disable and self-delete, and commands assert operation-specific abilities. It has no general super-admin-target restriction. Add the approved stronger rule specifically to passkey management: only super-admin actors may list or remove another super-admin's credentials. Do not silently change existing password-reset or user-edit permissions. Document this distinction and test the new ability independently of `read`, `update`, and `changePassword`.
- Consume a ceremony with a conditional database update, accepting exactly one affected row. PostgreSQL can return the claimed record with `RETURNING`. MySQL uses an explicit transaction, checks `affectedRows`, and reads the claimed record through that transaction. Never implement read-then-delete or infer success from an unconditional update.
- Preserve the two migration streams: incremental Drizzle migrations during development, squashed into one baseline before release for fresh CLI installations; separately numbered plain SQL scripts in each database provider's `sql/` directory upgrade existing sites. The password-security handoff's ledger repairs concerned local development/test databases, not deployed sites. Changing this release model is outside the passkey plan and would require a separate discussion.

## Proposed implementation defaults

These are starting limits for this implementation, not measurements. Keep them centrally defined and validate configuration overrides; weakening an authentication invariant requires spec review.

| Resource | Default |
| --- | --- |
| Challenge, ceremony identifier, fresh-proof grant, account user handle | Independently generated 32-byte random values |
| Ceremony or grant lifetime | Five minutes; converting a grant to enrollment never extends its original expiry |
| Complete serialized WebAuthn request body | 64 KiB, read within five seconds before framework deserialization |
| Password fresh-authentication body | Existing 16 KiB password envelope and credential limits |
| Passkey admission | Shared 60 requests/minute per trusted network across options, verification, and grant operations |
| Passkey process capacity | Four active requests, no queue, minimum 100 ms slot occupancy; acquire before counter/database work |
| Active credentials per account | Ten, checked under the account lock |
| Pending authenticated ceremonies and grants | Five combined per acting login, enforced under its account lock |
| Credential display name | 80 JavaScript string code units; render as text |

Passkey capacity is separate from the existing Argon2 slot. Password proof additionally runs the full password limiter using server-resolved email, including the email-plus-network bucket. Reuse trusted-IP normalization and HMAC counter-key conventions with a distinct passkey namespace. Capacity and admission failures return 429 with `Retry-After`; unavailable protection or storage returns 503. Retain cleanup proportional to admitted traffic for counter rows and scheduled idle cleanup. These limits bound admitted work, not availability against distributed saturation.

## Stage 1 — Contracts and configuration

- [ ] First, inspect the published npm registry metadata for candidate `@simplewebauthn/server` and `@simplewebauthn/browser` versions. Start with `pnpm view @simplewebauthn/server version engines --json` and `pnpm view @simplewebauthn/browser version engines --json`, then repeat for each exact candidate version. Record the version, published `engines` field, registry source, and maintained status before selecting or adding dependencies. Byline advertises Node >=20.9.0 and CI uses Node 22; CI's version alone does not establish compatibility with the supported floor. If the selected maintained release requires Node 22 or another higher floor, present a separate runtime compatibility proposal. Missing `engines` metadata is not proof of compatibility; validate the selected pair and relevant dependencies against the supported runtime before pinning.
- [ ] Extend `packages/auth/src/session-provider.ts` through an optional passkey capability and typed optional passkey operations. Existing custom providers must continue compiling and running without implementing them. Configuration must reject a capability without its required implementation.
- [ ] Keep cryptographic verification, native issuance, fresh-proof policy, and repository contracts in `packages/admin`; transport and cookies remain in `packages/host-tanstack-start`. Add configuration types and validation in core without importing server cryptography into client-safe configuration.
- [ ] Require explicit relying-party ID, display name, and exact allowed origins. Validate HTTPS/local-development rules at boot and disable related-origin expansion. Passkey support remains opt-in; configurations without it retain password behavior.

**Checkpoint:** contract type tests cover a password-only custom provider, configured native support, missing methods, invalid configuration, and server/browser import boundaries. Record the selected dependency/runtime combination before continuing its integration.

## Stage 2 — Persistence and atomic consumption

- [ ] Add a nullable unique WebAuthn user handle on the account. Allocate it once under the account lock during first enrollment; preserve it after all credentials are removed. Keep it out of general editable user DTOs.
- [ ] Add credential storage with an internal record ID, byte-exact unique WebAuthn credential ID, owning account, public key, counter, transport/backup metadata, name, timestamps, and revocation state. Use binary-safe comparison on MySQL; default case-insensitive text collation must not identify different credentials as equal. Retain revoked records so the same credential cannot be reassigned through re-enrollment.
- [ ] Add short-lived records for sign-in, fresh authentication, enrollment, and single-use grants. Store hashes of bearer identifiers, purpose, challenge where applicable, acting account/login/generation, intended action, target account/credential, creation/expiry, and consumption state. Return raw identifiers only to their initiating request with `no-store`; verification submits them in the body.
- [ ] Claim a record only when its identifier, purpose and applicable binding match, it is unconsumed, and it has not expired. Commit this claim in a short transaction before cryptographic verification or the business transaction. Failure, process death, deadlock, or uncertain commit never makes the same attempt reusable. Require a new ceremony instead of automatic retry.
- [ ] Implement the same contract on both adapters through scoped `AdminStore` repositories. Generate incremental Drizzle migrations for development and new numbered native SQL upgrade scripts in `packages/db-postgres/sql/` and `packages/db-mysql/sql/`. Preserve released native scripts unchanged and follow each adapter's ownership/DDL conventions. Leave CLI baseline synchronization until the existing pre-release squash step; do not copy incremental migrations into CLI templates.

**Checkpoint:** shared conformance uses separate connections to prove one winner for concurrent consumption, including MySQL affected-row behavior. Cover expiry, wrong purpose/binding, transaction failure after consumption, exact credential identity, and concurrent first enrollment. No token or credential operation may rely on an in-memory challenge store.

## Stage 3 — Provider and management services

- [ ] Extract private native session issuance shared by password and passkey sign-in. Preserve sorted observed-account locks, replacement revocation, account generation, `sid`, and rollback behavior. Never expose a user-ID-only issuance method.
- [ ] For passkey sign-in, claim the challenge, resolve the credential/account, and verify against a captured credential/account snapshot outside the issuance lock. Under the account locks, reread enablement, generation, credential ownership/revocation and verification-relevant state. Reject changed state with a fresh-ceremony requirement. Persist the verified counter/metadata and issue the session in the same transaction. Test zero counters and positive-counter conflicts.
- [ ] Implement fresh authentication separately from sign-in: password or passkey proof must identify the currently authenticated actor and must not issue a new login or replace cookies. Revalidate password hash/generation or passkey state under the actor lock before issuing a scoped grant. A grant obtained through a passkey also records that credential; recheck it at use.
- [ ] Consume an enrollment grant when creating its registration options. Transfer its action/account/login/generation binding and remaining lifetime into the registration ceremony. On completion, recheck the grant's authority, credential limit and account handle under lock before inserting the credential. Keep registration, sign-in, and fresh-authentication purposes distinct.
- [ ] Add self-service commands whose target comes from the actor, plus privileged list/remove commands requiring `admin.users.managePasskeys`. Recheck the acting login, fresh proof, current authority, and target super-admin status at removal under sorted account locks. Disabled targets remain manageable; disabled or revoked acting accounts do not.
- [ ] Removal revokes the credential, increments the target account generation, revokes every target login/refresh session, and invalidates its management grants/ceremonies atomically. Reject pending authority derived from old generations even if its row remains. Preserve another acting account's sessions. Renaming never changes credential identity or authentication state.
- [ ] Persist successful privileged-removal audit entries in the removal transaction. The existing audit table supports null document/collection IDs; provide a transaction-scoped admin audit writer rather than calling the separate `DBManager` pool from inside an `AdminStore` transaction. Store actor, target, internal credential reference, action and outcome; record denials/failures separately without credential material. Audit insertion failure rolls back removal.
- [ ] Extend the provider's existing `onEvent`/`NativeSessionEvent` telemetry seam with passkey attempt, success, terminal-failure, and admission-denial events. Include the ceremony purpose and bounded reason codes. Wire host/limiter denials into the same configured event sink because admission can reject before provider invocation; avoid counting one outcome twice. Emit success only after the relevant transaction commits. Keep events token-free, including no ceremony/grant identifiers, raw credential IDs, or response payloads. Hook failures must not change authentication outcomes or strand capacity slots; this best-effort telemetry remains distinct from the transactional privileged-removal audit.

**Checkpoint:** run complete adapter conformance, including existing JWT/session groups, on both databases. Add rollback injection and races between verification, removal, password reset, disable/re-enable, and replacement sign-in. Verify permission denial, super-admin targets, disabled-target recovery, and password-only regression behavior. Test telemetry redaction, outcome counts, pre-provider admission denial, no success on rollback, and throwing event hooks.

## Stage 4 — Host and user interface

- [ ] Add POST server functions for sign-in options/verification, password proof, passkey proof options/verification, enrollment options/verification, and credential mutations. Authenticated list calls also use the expected-login boundary. Extend pre-deserialization body checks to the compiled endpoints and prove actual Start request coverage with CSRF running first.
- [ ] Capture the page's expected login for management. Use the existing auth-action queue for successful sign-in submission and self-removal cookie handling; avoid holding a cross-tab Web Lock while a user is interacting with an authenticator. Recheck page identity before submitting work after the prompt. A successful self-removal clears cookies and requires sign-in; cross-account removal does not clear the actor's cookies. Failed or ambiguous responses never claim success or replay automatically.
- [ ] Add the explicit passkey sign-in button, account credential manager, and privileged target-account controls. Show only controls permitted by capability and authority; server checks remain definitive. Confirm all-target-session revocation before removal. Keep password choice visible and provide usable cancel, expired-ceremony, unsupported/full-key, and unavailable-device states.
- [ ] Translate the complete flow into `en`, `fr`, `es`, `de`, `it`, `zh-CN`, `ko`, and `th`. Preserve keyboard/focus behavior and the existing session-change interstitial.

**Checkpoint:** host and component tests cover cancellation, wrong-account fresh proof, expired access, missing/false/true/malformed `crossOrigin`, identifier substitution, full password admission, one-shot failures, and expected-login changes during prompts. Re-run anonymous public layout and authentication transport regressions.

## Stage 5 — Auth maintenance

- [ ] Add leased recurring tasks in one auth-maintenance family. Ceremony/grant cleanup removes expired or consumed records after a five-minute grace period, in batches of 100. Authorization continues enforcing the original expiry/consumption immediately.
- [ ] Login cleanup selects logins expired or revoked for at least 30 days. Under the owning account lock, reread eligibility so a renewed login cannot be deleted from a stale scan. Preserve all refresh predecessors of live logins, regardless of their individual expiry or rotation state.
- [ ] Drain eligible login refresh children in batches of 100, then delete the terminal parent only when no children remain. Do not rely on an unbounded cascading delete. Handle legacy refresh rows without `sid` separately once expired for 30 days; they cannot authorize native sessions. Keep revoked credential tombstones and audit entries outside this cleanup.
- [ ] Each task runs at 60-second intervals with a 60-second lease, heartbeats between batches, checks abort, and stops after 32 batches or 30 seconds with `workRemaining`. Propagate errors to scheduler health/backoff. Register tasks and the runner in the reference app and CLI wiring; support native login cleanup even when passkeys are disabled.

**Checkpoint:** both adapters prove bounded work for a login with more than 1,000 refresh members, retention of live predecessors, legacy cleanup, renewal/cleanup races, lease behavior, and independent authorization during cleanup outages. Close the historical login-row cleanup follow-up only after these checks pass.

## Stage 6 — Packaging and acceptance

- [ ] Follow the existing user-controlled pre-release squash: squash development Drizzle migrations to one SQL baseline and matching journal per adapter, then run `pnpm --filter @byline/cli sync:baselines` to update the CLI fresh-install bundles. Keep the sync script's single-baseline contract. Any local development/test ledger reconciliation belongs to that explicit release-preparation step; do not perform it implicitly or apply it to deployed sites. Existing sites upgrade through the new numbered native SQL scripts. Baseline drift caused by incremental development migrations remains an open release-preparation item until synchronization; it must be closed before acceptance.
- [ ] Verify new native SQL against an existing-schema test fixture and full Drizzle/CLI installation against empty test databases on both adapters. Verify disabling passkey configuration restores password-only operation without deleting credentials. Do not claim compatibility with old binaries that lack the new removal/generation checks.
- [ ] Run the executable CI gates: `pnpm byline:generate:check`, `pnpm docs:check`, `pnpm lint`, `pnpm typecheck`, `pnpm knip`, and `pnpm knip:exports`. Biome modifies files; review its diff. Run `pnpm build`, `pnpm test`, `pnpm --filter @byline/webapp test:sign-in-transport`, and `pnpm test:integration`.
- [ ] After building the CLI, run `pnpm --filter @byline/cli check:templates` and `pnpm --filter @byline/cli check:artifact`. Run `pnpm check:native-sql-history` against the agreed pre-change base and `git diff --check`. Use only `_test` databases and keep shared-database integration execution serial.
- [ ] Record real-device checks for Safari/macOS and iOS with a synced platform passkey, Chrome/Android with a synced platform passkey, and Chrome or Edge with a resident-key-capable physical security key. Include enrollment, sign-in, cancellation, password fallback, fresh proof, self/privileged removal, restart persistence, and two-tab account switching. Record actual browser/OS/authenticator versions; simulated credentials do not replace this evidence. Use manual or accessibility-assisted testing, preserving the existing no-Playwright constraint.
- [ ] Update auth/deployment documentation, including recovery limits, deliberate revoke-all removal, shared user handles, required runtime, scheduler health, and per-site RP configuration. Review each downstream deployment's origins and trust boundary before enabling passkeys.

**Completion evidence:** record commands, results, migrations tested, physical-device coverage, and any outstanding failures beside each stage. No inherited test count is evidence for new code. Spec approval and plan approval do not authorize publication or production deployment; those remain separate actions.
