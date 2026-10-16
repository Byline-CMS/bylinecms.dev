---
title: "Passkeys"
path: "passkeys"
summary: "Enable optional administrator passkeys, upgrade an existing installation, and recover access when a credential is lost or compromised."
---

# Passkeys

Companions:
- [Authentication & Authorization](./01-authn-authz.md) — the native session lifecycle, permissions, and password request protection.
- [Configuration API reference](../10-api-reference/01-configuration.md#passkey-configuration) — the exact passkey configuration and request-protection contracts.
- [Recurring tasks](../11-scheduling/01-recurring-tasks.md) — starting the scheduler and checking task health.
- [Auditability](./02-auditability.md#passkey-recovery-audit) — the record of an administrator removing another account's credential.

Passkeys let existing Byline administrators sign in using a device credential manager or a compatible security key. Use this guide to enable them on your installation, manage your own credentials, or help another administrator recover access.

A passkey is a WebAuthn credential: Byline stores its public key, while the authenticator keeps the private key. Passkeys are optional in Byline 6.8.0. Every account retains password sign-in, including super-admins; this feature does not create passwordless accounts or require a second factor after a password.

## Requirements

Use Byline 6.8.0 or later with the native `JwtSessionProvider` and either the PostgreSQL or MySQL adapter. Node `>=22.22.2` is required; on Node 24, use 24.15 or later. Existing installations must complete the [upgrade steps](#upgrade-an-existing-installation) before starting the updated application, including sites that keep passkeys disabled.

Production requires HTTPS. The browser and authenticator must support discoverable credentials, which let the browser offer an account without asking for its email first, and user verification, such as a device PIN or biometric confirmation. Older security keys may lack these features or have no space for another credential. Password sign-in remains available if a device cannot use passkeys.

## Enable passkeys

### Configure the site's identity

The **relying-party ID** is the domain to which credentials belong. An **origin** is the exact scheme, hostname, and optional port at which an administrator opens Byline. Configure the origin serving the sign-in and admin interface, which may differ from the public website's origin.

The reference application and CLI templates read these settings from the server environment:

| Variable | Meaning |
|---|---|
| `BYLINE_PASSKEY_RP_ID` | A lowercase domain name without a scheme, path, or port; for example, `cms.example.com`. |
| `BYLINE_PASSKEY_RP_NAME` | The site's display name, shown during registration. |
| `BYLINE_PASSKEY_ORIGINS` | Comma-separated exact HTTPS origins. No paths, trailing slashes, or wildcards. Each hostname must equal the relying-party ID or be its subdomain. |
| `BYLINE_PASSKEY_ALLOW_HTTP_LOCALHOST` | Set to `true` only for explicit HTTP development on `localhost`. It does not permit HTTP on a LAN address or a tunnel hostname. |

For an installation opened at `https://cms.example.com`, set:

```dotenv
BYLINE_PASSKEY_RP_ID=cms.example.com
BYLINE_PASSKEY_RP_NAME="Example CMS"
BYLINE_PASSKEY_ORIGINS=https://cms.example.com
BYLINE_PASSKEY_ALLOW_HTTP_LOCALHOST=false
```

Restart the application after changing its environment. With the complete server wiring below, the sign-in page shows **Sign in with a passkey**, and Account shows the Passkeys section.

These environment variables are an application convention, not settings that core reads automatically. An older or custom `byline/server.config.ts` must map them to `passkeys` and configure request protection. The current reference application and CLI templates already do this. Setting any one of the four variables activates configuration validation; partial configuration fails at startup.

Choose a stable relying-party domain before enrollment. Credentials created for a different domain do not automatically move with the application. A domain change may require users to sign in with passwords and enroll new passkeys. Never derive the relying-party ID or allowed origins from incoming request headers.

### Wire an existing application

The following server-only helper assembles the authentication settings using your adapter's `AdminStore`, installation signing secret, and existing trusted client-IP resolver. Keep the database, collections, routes, and other application settings in your existing `initBylineCore()` call.

```ts
import type { AdminStore } from '@byline/admin'
import {
  createAuthMaintenanceTasks,
  createPasskeyRequestLimiter,
  createPasswordSignInLimiter,
  JwtSessionProvider,
} from '@byline/admin/auth'
import type { ServerConfig } from '@byline/core'

export function nativeAuthentication(
  store: AdminStore,
  signingSecret: string,
  resolveClientIp: NonNullable<ServerConfig['passwordSignIn']>['resolveClientIp'],
  passkeys?: ServerConfig['passkeys']
) {
  const passwordLimiter = createPasswordSignInLimiter(store.signInRateLimits, signingSecret)
  return {
    adminStore: store,
    sessionProvider: new JwtSessionProvider({ store, signingSecret, passkeys }),
    passkeys,
    passwordSignIn: { limiter: passwordLimiter, resolveClientIp },
    passkeyRequests: passkeys
      ? {
          limiter: createPasskeyRequestLimiter(store.signInRateLimits, signingSecret),
          resolveClientIp,
        }
      : undefined,
    recurringTasks: [
      ...createAuthMaintenanceTasks(store),
      passwordLimiter.cleanupTask,
    ],
  }
}
```

Call this helper once during server bootstrap with the settings read from the environment. Spread its returned settings into `initBylineCore()` and merge its `recurringTasks` with any existing analytics or publication tasks. The password and passkey limiters share the counter-cleanup task name; register that task only once. The same passkey settings must reach both the provider and core.

Retain the TanStack host's CSRF, session, and `passwordSignInMiddleware` protection. Despite its name, that middleware also bounds passkey requests before deserialization. Password-based confirmation uses the full password limiter. Follow [Password sign-in protection](./01-authn-authz.md#password-sign-in-protection) for the trusted client-IP resolver and middleware setup; trusting an arbitrary forwarding header is not sufficient.

Start `startBylineScheduler(core)` in the host server entry, or arrange recurring `runDueTasks(core)` calls for an externally scheduled host. Importing configuration does not start cleanup. The [recurring-task guide](../11-scheduling/01-recurring-tasks.md) provides startup and shutdown examples. Keep authentication code out of browser configuration and client bundles.

### Local development and HTTPS tunnels

For the reference application at `http://localhost:5173`, use:

```dotenv
BYLINE_PASSKEY_RP_ID=localhost
BYLINE_PASSKEY_RP_NAME="Byline development"
BYLINE_PASSKEY_ORIGINS=http://localhost:5173
BYLINE_PASSKEY_ALLOW_HTTP_LOCALHOST=true
```

For testing on another device, expose the application through an HTTPS tunnel. Replace the relying-party ID with the tunnel's hostname and the origin with its exact HTTPS URL, and set `BYLINE_PASSKEY_ALLOW_HTTP_LOCALHOST=false`. Open that HTTPS URL on each test device. A phone's `localhost` is the phone itself; the HTTP localhost exception does not make your workstation's LAN address eligible.

Configure the host and proxy to accept that hostname and preserve the request information needed by CSRF protection and trusted client-IP resolution. Do not disable those protections to make the tunnel work. Use a stable tunnel hostname across enrollment and sign-in; a changed hostname may require a new test credential.

Check enrollment, sign-in, cancellation, password fallback, and removal on the browsers and authenticators your installation supports. Include Safari on macOS and iOS, Chrome on Android, and a discoverable-credential-capable security key when those are deployment targets. Automated verification tests do not establish physical-device compatibility.

## Use and manage your passkeys

1. Sign in with your password and open **Account → Passkeys**.
2. Choose **Add passkey**, give it a useful name, and confirm with your password. The first enrollment requires the password; later enrollments can use an existing passkey instead.
3. Follow the browser's prompt to select your device credential manager or security key. Byline supports up to ten active passkeys per account.
4. Sign out, then choose **Sign in with a passkey** on the sign-in page to check the new credential. The browser offers the accounts available to its authenticator.

Account lists credential names and last-used information. Rename changes the label stored by Byline; adding or renaming a passkey does not sign you out. Add and rename controls use drawers. The Users screen provides recovery controls; when viewing your own user there, follow the Account link to add or rename credentials.

Enrollment and removal require fresh confirmation with your password or one of your own passkeys. An existing session, including a renewed session, is insufficient. Confirmation authorizes one action and expires within five minutes. If a prompt expires, is cancelled, or fails, start the action again. Switching accounts in another tab invalidates management work tied to the previous login.

Removing a passkey signs its account out on every device, including the session used for self-service removal. Removing the last passkey is allowed because password sign-in remains available. Byline removes the credential's authority on the server; it does not delete the device's saved credential. You can remove that saved entry separately in the device's credential manager.

## Recover a lost or compromised passkey

### Recover your own account

Sign in with your password or another passkey. Open **Account → Passkeys**, remove the lost credential, and complete fresh confirmation. You will be signed out; sign in again and add a replacement if needed.

### Help another administrator

1. Open the target account in **Users** and locate its Passkeys section.
2. Remove the lost or compromised credential. Confirm using **your own** password or passkey, not the target user's credentials.
3. If the user also cannot use their password, use the user's **Set password** control to assign a replacement through your established account-recovery process.
4. Have the user sign in and enroll their own replacement passkey from Account.

Listing and removing another account's passkeys requires `admin.users.managePasskeys`, with the normal super-admin bypass. Access to the Users screen also depends on its usual user-read permission. Setting another user's password is a separate operation requiring `admin.users.changePassword`; ordinary user-update permission does not grant either recovery capability. Only a super-admin may manage another super-admin's passkeys. Nobody can enroll a credential for someone else.

Removal revokes all native sessions and pending passkey-management authorizations for the target account. It preserves the acting administrator's sessions when the accounts differ. Recovery removal is allowed while the target account is disabled, but the account must be enabled before the user can sign in. Another authorized administrator must be able to sign in to use this recovery flow; it is not an unauthenticated recovery endpoint.

**Changing or resetting a password retains enrolled passkeys.** Resetting the password alone does not remediate a compromised passkey; explicitly remove each compromised credential. Account disablement blocks both sign-in methods. Neither password reset nor passkey removal cancels previously authorized [scheduled publications](../11-scheduling/02-scheduled-publication.md#authorization); review those separately when responding to account compromise.

## Upgrade an existing installation

Fresh installations created by the 6.8.0 CLI receive the passkey schema in their baseline. Existing installations apply the new numbered upgrade script for their adapter, after all earlier outstanding scripts and before starting the updated application:

| Adapter | Passkey upgrade | Immediately preceding script |
|---|---|---|
| PostgreSQL | [0014_add-passkeys.sql](https://github.com/Byline-CMS/bylinecms.dev/blob/v6.8.0/packages/db-postgres/sql/0014_add-passkeys.sql) | `0013_add-login-sessions.sql` |
| MySQL | [0009_add-passkeys.sql](https://github.com/Byline-CMS/bylinecms.dev/blob/v6.8.0/packages/db-mysql/sql/0009_add-passkeys.sql) | `0008_add-login-sessions.sql` |

These SQL files are source-repository artifacts from the release tag; the adapter npm packages do not include them. Do not replay the squashed fresh-install baseline against an existing database. The scripts add the user-handle column, credential and verification-attempt tables, and maintenance indexes. They are guarded for reruns. PostgreSQL runs in a transaction and includes the repository's database-owner correction; MySQL commits DDL steps individually.

Update the application-owned server configuration to register `createAuthMaintenanceTasks(adminStore)` and run the scheduler as described above. Upgrading npm packages does not rewrite an existing application's configuration. These tasks are needed for native password-only installations too.

### Custom storage and session providers

Custom `AdminStore` implementations, including test fakes, must provide the required `passkeys` and `authMaintenance` repositories. The built-in adapters already provide them. These are persistence contracts even when passkeys are disabled; do not substitute empty implementations. Preserve the account-lock transactions, atomic single-use attempt claims, and bounded cleanup required by the interfaces.

Passkey support on `SessionProvider` remains optional. A password-only custom provider may omit both `passkeys` and its capability flag. Enabling passkeys requires the complete `PasskeyProvider` implementation, `capabilities.passkeys: true`, matching trust configuration, and request protection. See the [configuration reference](../10-api-reference/01-configuration.md#passkey-configuration). Disabling passkeys on current code does not establish compatibility with older binaries that lack the new credential-removal checks.

## Background cleanup

Byline gradually removes expired authentication records in the background. It retains ended sign-in records for 30 days and removes used or expired passkey verification records after a five-minute grace period. Expired, used, or revoked authority is rejected immediately; cleanup timing does not extend access.

The registered tasks are `auth.maintenance.attempts`, `auth.maintenance.logins`, and `auth.maintenance.legacy-refresh`. They perform bounded work and normally become due every minute. Check the scheduler's last-success and failure information after deployment; registration alone does not prove that a runner is executing them. Cleanup retains revoked credential records and audit entries.

For integrations that call it directly, `refreshTokens.purgeExpired()` now deletes at most 100 legacy rows per call, only where `sid` is null and expiry is at least 30 days old. Refresh tokens belonging to a native login remain until that login is eligible for maintenance cleanup, preserving replay detection while it is active.

## Disable passkeys

Remove all four `BYLINE_PASSKEY_*` settings and restart the reference application or scaffolded host. Leaving even `BYLINE_PASSKEY_ALLOW_HTTP_LOCALHOST=false` defined still activates its configuration parser. In a custom configuration, omit passkey settings from both core and the provider and remove `passkeyRequests`.

Password sign-in remains available and stored credentials are retained. Keep native authentication maintenance running. Restoring the same relying-party configuration allows retained, unrevoked credentials to be used again.

## Implementation references

The storage interfaces live in `packages/admin/src/modules/auth/passkeys-repository.ts` and `auth-maintenance-repository.ts`; native verification and management live in `native-passkey-provider.ts` in the same directory. Host endpoints live in `packages/host-tanstack-start/src/server-fns/auth/passkeys.ts`.

The shared suites in `packages/db-conformance/src/suites/passkeys-persistence.ts`, `passkeys-native.ts`, and `auth-maintenance.ts` exercise both adapters. Host and component tests cover request protection and browser-flow behavior; the [testing guide](../13-testing.md) explains how to run them. Physical-device acceptance remains a separate deployment check.

## Not yet shipped

Mandatory passkeys, passwordless accounts, public registration, automatic enrollment, and browser autofill integration are outside this release. Passkey sign-in does not expand an administrator's permissions or add delegated OAuth/MCP access.
