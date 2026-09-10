---
title: "Optional passkeys — Phase 1 specification"
path: "passkeys-phase-1-spec"
summary: "Define optional passkey sign-in for existing Byline administrators while retaining password sign-in and the native session lifecycle."
---

# Optional passkeys — Phase 1 specification

Companions:

- [Authentication and authorization](../docs/07-auth-and-security/01-authn-authz.md) describes the current provider and session contracts.
- [Password sign-in security specification](./2026-09-08-password-sign-in-security-spec.md) records the session guarantees this feature must preserve.
- [Phase 1 implementation plan](./2026-09-10-passkeys-phase-1-plan.md) sequences implementation and verification of this specification.
- [Testing](../docs/13-testing.md) describes the repository's verification workflow.

Date: 2026-09-10. Status: approved for planning following the user-supplied review. Implementation has not started. The implementation plan resolves the remaining protocol and repository details without changing the Phase 1 policy.

## Purpose and scope

Phase 1 lets you enroll a passkey on an existing Byline administrator account and choose either passkey or password at sign-in. A passkey is a WebAuthn public-key credential held by an authenticator, such as a device's credential manager or a security key. Byline stores its public key; the authenticator retains the private key.

Password sign-in remains available to every account, including super-admins. Enrollment never disables it. Passkeys improve the everyday sign-in experience and resist phishing on that path, but Phase 1 does not prevent attackers from targeting passwords. WebAuthn's origin-bound authentication model is defined in the [WebAuthn specification](https://www.w3.org/TR/webauthn-3/).

This phase covers the native provider, PostgreSQL and MySQL adapters, TanStack host, and admin user interface. It does not add public registration, passwordless accounts, mandatory passkeys, external identity providers, or a replacement session scheme.

## User behavior

- The sign-in page offers an explicit **Sign in with a passkey** action alongside the existing password form. Discoverable credentials let the browser offer an account without requiring an email first. Unsupported browsers, cancellation, and unavailable credentials leave password sign-in accessible without changing the current session.
- The account page lets an administrator add, name, list, and remove their own passkeys. Show creation and last-used dates, permit multiple credentials, and explain that removing a credential from Byline does not delete it from the device or credential manager.
- Enrollment and removal require fresh proof of the acting administrator's password or an already enrolled passkey. The first enrollment therefore requires the password. An existing session alone is insufficient. Renaming requires an authenticated, correctly bound account request.
- Fresh proof authorizes one enrollment or removal, expires within five minutes, and is bound to the acting account, current login, account generation, and intended action. Removal also binds the target account and credential. Session renewal is not fresh authentication.
- Removing the last passkey is permitted because the password remains available. A lost passkey is recovered from by signing in with the password or another passkey and removing the lost credential. If the user cannot act, an authorized administrator can remove the compromised credential and use the existing password-reset process to restore access.
- The admin-user page supports listing and removing another account's passkeys through a proposed dedicated `admin.users.managePasskeys` ability, with the existing super-admin bypass. General user-read or user-update permission alone does not grant this ability. Only a super-admin can manage another super-admin's passkeys. Enforcement belongs in the service/command boundary and is rechecked at removal; fresh proof is of the acting administrator, never the target user. This permission does not allow enrolling a credential for somebody else. Recovery remains possible while the target account is disabled.
- New controls, instructions, and errors are accessible and translated into all eight existing admin locales. Browser autofill integration and automatic enrollment are deferred; neither is required for Phase 1.

## WebAuthn requirements

Use a maintained verification library, with SimpleWebAuthn as the proposed choice. Require discoverable credentials and user verification during registration and authentication. The server must enforce verification of the user's device unlock or PIN; requesting it in browser options alone is insufficient. Support synced passkeys and compatible security keys without requiring vendor attestation. [SimpleWebAuthn's passkey guidance](https://simplewebauthn.dev/docs/advanced/passkeys) describes the relevant options.

Older security keys may lack discoverable-credential support or have small resident-credential capacity. An unsupported or full key must produce an actionable enrollment error without weakening this requirement.

The server verifies the challenge, ceremony type, expected origin, relying-party ID, signature, user presence, user verification, and credential ownership. The relying-party ID is the domain scope of the credential. Resolve the account from the stored credential and validate the returned user handle against that account; never accept a client-supplied account ID as authentication evidence. Mint a stable, opaque WebAuthn user handle on the account at first enrollment and use that same value for every credential belonging to it, including after removal and re-enrollment. Concurrent first enrollments must resolve to one handle. Do not use an email address.

Challenges must be unpredictable, expire within five minutes, and permit at most one verification attempt across all instances. Each has a separate unguessable ceremony identifier, returned only in the initiating response and submitted in the verification request body. The server binds that identifier to the challenge and purpose; enrollment and fresh-authentication records also bind the acting account, login, and generation. Failed verification consumes the attempt. Concurrent ceremonies have distinct identifiers; a fixed-name cookie must not select the ceremony. Keep identifiers out of URLs and logs and return ceremony responses with `Cache-Control: no-store`.

This proves possession of the ceremony identifier together with a valid WebAuthn response for the stored challenge and configured origin/relying-party ID. It does not identify a browser: copying both values could transfer the attempt before consumption. No browser-scoped identity or non-transferability guarantee is introduced. The plan must test challenge/identifier mismatches, purpose isolation, and single consumption without changing persistent-sign-in behavior.

## Session and transaction guarantees

Successful passkey verification enters the same native session lifecycle as password verification: access JWT, opaque refresh token, account generation (`sv`), and stable login identity (`sid`). Preserve immediate revocation, strict refresh replay handling, explicit renewal, observed-login replacement revocation, the expected-login boundary, and the session-change interstitial.

Shared issuance remains internal to the authenticated provider flow. There must be no generally callable user-ID-only path to session issuance. Under the existing account locks, passkey sign-in revalidates account enablement and generation, credential ownership and active state, and the credential state used during verification. Credential updates, observed-login revocation, and new session issuance commit or roll back together. Challenge consumption must still prevent another attempt after failure or rollback.

Signature counters require WebAuthn-aware handling: valid authenticators can report zero, so an unconditional increment requirement is incorrect. Apply the library's counter checks against current stored state and prevent concurrent updates from overwriting newer state. Challenges provide replay protection even when counters remain zero. [SimpleWebAuthn's server documentation](https://simplewebauthn.dev/docs/packages/server) explains counter behavior.

Enrollment and removal use the same account-lock ordering as sign-in and account mutations, including sorted locks when acting and target accounts differ. A credential removed before issuance commits cannot authorize that issuance. Removing a credential atomically revokes all native sessions and pending management grants for the target account. Self-service removal therefore signs out the caller; removing another account's credential preserves the acting administrator's sessions. Merely adding or renaming a credential does not revoke sessions.

Revoking every target session is a deliberate Phase 1 policy for both routine retirement and compromise recovery. Preserving the freshly authenticated current login is feasible using `sid`, but this phase chooses one uniform removal rule, accepting the extra sign-in. The removal confirmation must explain this consequence before the user proceeds.

Password changes and resets continue to revoke sessions but retain enrolled passkeys. Account disablement prevents both sign-in methods and invalidates that account's pending management authorization. Password reset alone is therefore not remediation for a compromised passkey: the owner or an authorized administrator must explicitly remove that credential. Record privileged removals with acting account, target account, credential record reference, and outcome, without recording credential material or ceremony authorization.

## Host protection and deployment

All ceremony and credential-mutation endpoints use CSRF-protected POST requests. Authenticated operations enforce the existing expected-login boundary. Successful passkey sign-in uses the existing coordinated cookie-writing and navigation path. Failures never issue or clear session cookies, and uncertain outcomes never trigger automatic ceremony replay.

Apply trusted client-IP resolution and shared network admission before allocating challenges or verifying responses. Discoverable sign-in has no account identity at challenge creation, so it cannot use the password email-plus-network bucket. Passkey requests do not consume the Argon2 capacity slot. Password-based fresh authentication uses the full password sign-in limiter: trusted network, normalized email-plus-network bucket, and process capacity. Resolve the acting account's email on the server; being signed in does not bypass admission.

Bound request bytes, read duration, challenge creation, credential count, and outstanding verification work. The plan must state concrete limits suitable for WebAuthn payloads. Store or protection failures fail closed. Diagnostics may record outcomes and pseudonymous identifiers, but must not log passwords, tokens, raw ceremony responses, or reusable ceremony authorization.

Passkeys require explicit server configuration for the relying-party ID and allowed origins. Never derive trust from arbitrary request or forwarding headers. Require HTTPS outside local development. Reject cross-origin iframe ceremonies by requiring `crossOrigin` to be false in the verified WebAuthn client data; do not infer framing from request headers. The plan must specify any standards-compatible treatment of an omitted flag and test it explicitly. Each downstream deployment needs verified configuration; changing its credential domain may require re-enrollment.

Existing installations and custom session providers continue working without passkey configuration. Advertise support through an optional provider capability and expose passkey controls only when configured. Enabling an incomplete or invalid passkey configuration must fail clearly rather than weaken verification. Library selection must respect Byline's supported Node versions or propose a separate compatibility change.

## Persistence and acceptance

Both adapters persist credentials and short-lived ceremony state with equivalent behavior. The account owns the opaque WebAuthn user handle. Credential records reference that account and include a unique credential ID, public key, counter, transport and backup metadata, display name, timestamps, and active state.

Include the existing login-session row cleanup follow-up in the same auth-maintenance task family, with separate eligibility rules for expired/consumed ceremony state and expired/revoked native logins. Use leased, bounded batches and `workRemaining`. The plan must define retention and cascading refresh-row deletion, including legacy rows. Preserve refresh predecessors needed for replay detection and observed-login revocation while their login remains live; do not blindly purge them by individual token expiry. Cleanup must serialize safely with renewal and must not affect authorization's independent expiry/revocation checks. Test both rules on both adapters before closing the follow-up.

Phase 1 acceptance requires:

- Both-adapter conformance for enrollment, password/passkey choice, account-level user-handle consistency, self-service and privileged removal, permission denial, disabled-target recovery, session/grant revocation, expiry, replay, concurrency, rollback, and races with account changes. Include zero-counter credentials, invalid WebAuthn proofs, and both cleanup rules.
- Host coverage for CSRF, full password reauthentication admission, passkey admission, payload limits, ceremony identifier/purpose isolation, cross-origin client data, and unchanged session/retry behavior, including account switching and anonymous public reads.
- Real-device evidence for a synced platform passkey and a compatible security key across the supported browser matrix, including cancellation, password fallback, and lost-credential removal.
- Additive upgrade migrations, synchronized CLI installation baselines, fresh-install verification, documentation, translations, and the repository's applicable static and test gates.

## Phase 2 boundary

After Phase 1 testing and acceptance, a separate specification may introduce a **per-account mandatory-passkey option**. Phase 2 must define password-path enforcement, migration of existing sessions, and administrator recovery that cannot silently bypass the requirement. No account or role is required to use a passkey in Phase 1.
