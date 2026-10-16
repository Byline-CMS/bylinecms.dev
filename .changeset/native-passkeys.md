---
'@byline/auth': minor
'@byline/core': minor
'@byline/admin': minor
'@byline/host-tanstack-start': minor
'@byline/db-postgres': minor
'@byline/db-mysql': minor
'@byline/cli': minor
'@byline/i18n': minor
'@byline/ui': minor
---

Add optional passkey sign-in for admin users, alongside password sign-in, and background cleanup of expired authentication records.

**Passkeys.** Admins can add passkeys from their Account page, sign in with one from the sign-in page, and rename or remove them. Adding, removing or confirming an action with a passkey requires fresh proof with the account's password or one of its own passkeys. Removing a passkey signs that account out everywhere. An admin with the new `admin.users.managePasskeys` ability can review and remove another user's passkeys for account recovery; only a super-admin can manage another super-admin's passkeys. Nobody can create a passkey for someone else. Each recovery removal, whether it succeeds, is denied or fails, is recorded in the audit log. Password sign-in is unchanged and stays available. Passkeys stay off until the site configures its trust settings, described below.

**Cleanup.** Byline now automatically cleans up expired authentication records in the background, retaining ended sign-in records for 30 days. Registering the new tasks is part of the upgrade below.

## Compatibility

- **Node.js `>=22.22.2` is now required** by every published package and by the CLI's preflight check, because Byline's own dependencies (Vite 8, Vitest 5, jsdom) need it. If you run Node 24, use 24.15 or later.
- **Custom `AdminStore` implementations must add `passkeys` and `authMaintenance`.** The built-in PostgreSQL and MySQL adapters provide both. Both are required even when passkeys stay off.
- **`refreshTokens.purgeExpired()` now deletes only legacy refresh tokens:** rows without a login session (`sid IS NULL`) that expired at least 30 days ago, at most 100 per call. Tokens that belong to a login session are kept until the new cleanup task removes the whole ended sign-in, so a replayed old token is still detected as reuse.

## Upgrading an existing installation

1. **Apply the database upgrade script** before starting the updated application. The scripts are not part of the npm packages; take them from this release's Git tag: `packages/db-postgres/sql/0014_add-passkeys.sql` for PostgreSQL, or `packages/db-mysql/sql/0009_add-passkeys.sql` for MySQL. Apply any earlier scripts you have not yet applied first, in filename order. Both scripts are safe to re-run, and the PostgreSQL script includes the ownership guard. New installations created with `byline init` use the updated baseline and need no script.
2. **Register the cleanup tasks.** Add `...createAuthMaintenanceTasks(adminStore)` (from `@byline/admin/auth`) to `recurringTasks` in `byline/server.config.ts`. Upgrading the packages alone does not change an existing application's configuration.
3. **To enable passkeys** (optional), follow the updated CLI templates: build a `passkeys` trust object with `rpId`, `rpName` and exact `origins`, and pass it to `JwtSessionProvider`. Then add `passkeys` and `passkeyRequests` to the server config, where `passkeyRequests` takes `createPasskeyRequestLimiter(adminStore.signInRateLimits, signingSecret)` and your client-IP resolver. The templates read `BYLINE_PASSKEY_RP_ID`, `BYLINE_PASSKEY_RP_NAME` and `BYLINE_PASSKEY_ORIGINS`. Set all of them or none; a partial configuration fails at boot. Passkeys require HTTPS, except on `localhost` during development with `BYLINE_PASSKEY_ALLOW_HTTP_LOCALHOST=true`. A passkey belongs to its relying-party ID, so changing your site's domain later invalidates existing passkeys.
4. Grant `admin.users.managePasskeys` to any role that should handle passkey recovery.
