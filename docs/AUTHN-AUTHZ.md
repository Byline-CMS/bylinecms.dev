# Authentication & Authorization

> Companions:
> - [ACCESS-CONTROL-RECIPES.md](./ACCESS-CONTROL-RECIPES.md) — worked `beforeRead` hook examples (owner-only drafts, multi-tenant scoping, embargo, soft-delete hide, department visibility, self-only).
> - [ROUTING-API.md](./ROUTING-API.md) — server-fn transport that resolves `RequestContext` and passes it down.
> - [RELATIONSHIPS.md](./RELATIONSHIPS.md) — `ReadContext` is the seed for the actor-carrying `RequestContext`.
> - [CLIENT-SDK.md](./CLIENT-SDK.md) — the in-process SDK is where actor threading becomes externally visible.

## Overview

Byline ships an end-to-end authentication and authorization subsystem with three load-bearing properties:

1. **Admin identity is a built-in subsystem, not a collection.** `admin_users`, `admin_roles`, `admin_role_admin_user`, and `admin_permissions` are dedicated tables owned by `@byline/admin` (with the Postgres adapter in `@byline/db-postgres/admin`). Admin users are never localized, versioned, workflowed, or rendered by the collection runtime.
2. **Two auth realms from day one — `AdminAuth` and `UserAuth`.** `Actor = AdminAuth | UserAuth | null`. Today only `AdminAuth` and the `null` (anonymous public) case are used at runtime; `UserAuth` is reserved in the type union so the contract does not have to grow a discriminator later.
3. **Service-layer enforcement, not transport-layer enforcement.** Every gate runs *inside* `@byline/core` / `@byline/admin` services, so the same gate is active no matter which transport (admin server fn, in-process client, future stable HTTP) invokes it. Transport edges only resolve and pass `RequestContext`.

The subsystem is split across two packages by concern:

| Package         | Role                                                                                               |
|-----------------|----------------------------------------------------------------------------------------------------|
| `@byline/auth`  | Leaf package. Actor primitives (`AdminAuth`, `UserAuth`, `Actor`), the `RequestContext` shape, the `AbilityRegistry`, the `SessionProvider` interface, and the `AuthError` factories. No DB, no transport — types and small classes only. |
| `@byline/admin` | Concrete admin subsystem. Admin user / role / permission / account modules (each as `commands.ts` + `repository.ts` + `service.ts` + `dto.ts` + `schemas.ts` + `errors.ts` + `abilities.ts`), the built-in `JwtSessionProvider`, password hashing (argon2id), and the `AdminStore` aggregate. |

Postgres-backed repositories ship as the `@byline/db-postgres/admin` subpath, plugged into `AdminStore`.

## Actors and `RequestContext`

```ts
type Actor = AdminAuth | UserAuth | null

class AdminAuth {
  readonly id: string
  readonly abilities: ReadonlySet<string>
  readonly isSuperAdmin: boolean
  hasAbility(ability: string): boolean
  assertAbility(ability: string): void          // throws AuthError if missing
  assertAbilities(...abilities: string[]): void
}

interface RequestContext {
  actor: Actor
  requestId: string
  locale?: string
  readMode?: 'published' | 'any'
  // populate cache, afterReadFired set, beforeReadCache (inherited from ReadContext)
}
```

`RequestContext` extends `ReadContext` — the same context that already carries the populate cache and the `afterReadFired` guard. Adding `actor` and `requestId` to that seed means every read concern (populate, `afterRead`, `beforeRead`, ability checks) shares one context object per logical request.

Three classes of caller construct `RequestContext`:

- **Admin server functions** call `getAdminRequestContext()` (`packages/host-tanstack-start/src/auth/auth-context.ts`). It reads the session cookie, calls `sessionProvider.verifyAccessToken`, and attaches the resolved `AdminAuth`. No actor → throws.
- **Public readers** (the in-process `@byline/client`) default to `actor: null`, `readMode: 'published'`. Anonymous access is permitted on read paths only when the read mode is `'published'`.
- **Scripts, seeds, and migrations** call `createSuperAdminContext({ id })` from `@byline/auth`. The fact that the caller is acting as super-admin is explicit in the code, not ambient, and every short-circuit on `actor.isSuperAdmin === true` is auditable.

`RequestContext` is what every lifecycle service, populate call, hook, and SDK entry point receives. Auth populates the actor; access control reads it. Transport edges do not enforce.

## Abilities

Abilities are **flat dotted strings** stored as `varchar(128)` in `admin_permissions`. Examples:

```
collections.pages.read
collections.pages.create
collections.pages.update
collections.pages.delete
collections.pages.publish
collections.pages.changeStatus
admin.users.create
admin.roles.update
admin.permissions.read
```

The flat-string choice is deliberate: it is what the role editor renders as a checkbox tree, what `assertAbility` checks, and what `admin_permissions` stores as one row per (role, ability) grant. CASL-style structured `{ subject, action }` pairs were considered and rejected — they complicate the role editor without payoff at this scope.

### The `AbilityRegistry`

`AbilityRegistry` (`packages/auth/src/abilities.ts`) is the single load-bearing abstraction. Every subsystem that wants to gate behaviour behind a permission registers its abilities at `initBylineCore()` time:

```ts
registerAbility({
  key: 'admin.users.create',
  label: 'Create admin users',
  group: 'Admin Users',
  description: 'Create new admin users.',
})
```

Two consumers feed off it:

- **Runtime** — `assertAbility('collections.pages.publish')` is a flat set-membership check on `actor.abilities`. The registry validates keys in dev mode (warns on unregistered keys); the check itself does not consult it.
- **Admin UI** — the role-ability editor enumerates registered abilities, grouped by `group`, as a checkbox tree. No hand-wiring per plugin.

Collections auto-contribute their abilities at registration time:

```
collections.<path>.{ read, create, update, delete }
collections.<path>.{ publish, changeStatus }    // when a workflow is configured
```

`@byline/admin` registers its own abilities (`admin.users.*`, `admin.roles.*`, `admin.permissions.*`) the same way — via `register*Abilities()` exports. Future plugins (media, settings, anything else that wants to gate behaviour) follow the same pattern: register at init time, assert at call sites. The core knows nothing plugin-specific while still rendering a complete admin UI.

## Two-layer access control

**Layer 1 — flat abilities.** Coarse-grained, table-stored, role-editable from the UI. Sufficient for "can this actor call this verb on this collection at all." Asserted at the service-layer entry point.

**Layer 2 — conditional rules in hooks.** Per-collection, in code, with full access to the document and the actor. The hook machinery is where ownership, state-gated, locale-masked, and tenant-scoped rules live:

- `CollectionHooks.beforeRead` — contributes a `QueryPredicate` AND-merged into the SQL query. Owner-only, tenant-scoped, soft-delete-hide.
- `CollectionHooks.afterRead` — observes the materialised document and the actor; can mask fields, redact values, or tag rows.
- `CollectionHooks.beforeUpdate` / workflow transition hooks — gate writes on document state ("publish only if `status === 'in-review'`").

CASL's *ideas* (subject + action + conditions) are useful here; CASL itself is not adopted. CASL rules are code; flat abilities are data. Storing compiled CASL rules in a database and editing them from a UI was rejected as awkward at best.

Worked recipes for Layer 2 — owner-only drafts, multi-tenant scoping, embargo, soft-delete hide, department visibility, self-only — live in [ACCESS-CONTROL-RECIPES.md](./ACCESS-CONTROL-RECIPES.md).

## The enforcement boundary

UI cues (hiding buttons, disabling menu items) are **cosmetic and explicitly untrusted**. An attacker can call the server function directly, drive `@byline/client` from a script, or hit a future HTTP endpoint. The real boundary is the service layer — every caller is forced through it.

Two helpers, one per realm:

| Helper                  | Realm                                  | Location                                                  |
|-------------------------|----------------------------------------|-----------------------------------------------------------|
| `assertActorCanPerform` | Document collections                   | `packages/core/src/auth/assert-actor-can-perform.ts`      |
| `assertAdminActor`      | Admin user / role / permission management | `packages/admin/src/lib/assert-admin-actor.ts`         |

### `assertActorCanPerform` — document collections

Policy:

- No `requestContext` → `ERR_UNAUTHENTICATED`.
- `actor: null` → permitted **only** when `verb === 'read'` and `readMode === 'published'`. Any other null-actor call throws `ERR_UNAUTHENTICATED`.
- Otherwise → `actor.assertAbility('collections.<path>.<verb>')`. Throws `AuthError` on miss.
- `actor.isSuperAdmin === true` short-circuits the ability check.

Call sites:

- Every `document-lifecycle.*` write entry point (`createDocument`, `updateDocument`, `updateDocumentWithPatches`, `changeStatus`, `unpublishDocument`, `deleteDocument`).
- `field-upload.uploadField` — uploads are effectively a write under collection scope, gated on `create` even when `shouldCreateDocument: false`. See [FILE-MEDIA-UPLOADS.md](./FILE-MEDIA-UPLOADS.md).
- `@byline/client` `CollectionHandle` on every read path (`find`, `findById`, `findByPath`, `findOne`, `countByStatus`, `history`, `findByVersion`).
- Every admin webapp document-collection server fn (`packages/host-tanstack-start/src/server-fns/collections/{list,get,history,stats,create,update,delete,status,upload}.ts`). Writes thread `requestContext` into `DocumentLifecycleContext`; reads call `assertActorCanPerform` directly before the adapter call.

### `assertAdminActor` — admin management

Policy:

- Always requires a present `AdminAuth` actor — no anonymous path.
- Asserts the specific module ability: `admin.users.*`, `admin.roles.*`, `admin.permissions.*`.

Called inside every `*Command` in `@byline/admin/admin-{users,roles,permissions,account}`. The transport wrappers (the matching server fns under `packages/host-tanstack-start/src/server-fns/admin-{users,roles,permissions,account}/`) carry no policy — they resolve `RequestContext` and delegate.

### The documented escape hatches

Two intentional bypasses exist, each on a single, well-marked seam:

- **`db.commands.*` / `db.queries.*` direct calls** bypass both helpers. Reserved for seeds, migrations, and internal tooling that need to bootstrap the system without an actor.
- **`_bypassBeforeRead: true`** on `@byline/client` read options skips `beforeRead` predicate application. Reserved for the same class of caller — admin tooling that needs to see everything regardless of scoping rules.

These are deliberate, narrow exits. There is no ambient bypass and no environment variable.

## Sessions — `SessionProvider` interface

Sessions are pluggable behind `SessionProvider` (`packages/auth/src/session-provider.ts`). The interface accommodates Lucia, better-auth, WorkOS, Clerk, institutional SAML/OIDC, or anything else that fits the contract; teams can run Byline end-to-end without reaching for any third-party identity service, because the built-in `JwtSessionProvider` is a fully capable first option, not a stub.

Minimum surface:

```ts
interface SessionProvider {
  signInWithPassword(args: { email: string; password: string; ip: string; userAgent: string }):
    Promise<{ accessToken: string; refreshToken: string; actor: AdminAuth }>
  verifyAccessToken(token: string): Promise<{ actor: AdminAuth }>
  refreshSession(refreshToken: string):
    Promise<{ accessToken: string; refreshToken: string }>
  revokeSession(refreshToken: string): Promise<void>
  resolveActor(adminUserId: string): Promise<AdminAuth>
  readonly capabilities: {
    passwordChange: boolean
    magicLink: boolean
    sso: boolean
  }
}
```

The capability flags are how the admin UI decides which affordances to render — a provider without `passwordChange` hides the password-change form rather than failing the call.

### Built-in `JwtSessionProvider`

Lives at `packages/admin/src/modules/auth/jwt-session-provider.ts` and friends. Behaviour:

- **15-minute access tokens.** Short enough that revocation propagates without a heavy real-time check on every request.
- **30-day refresh tokens** stored in `admin_refresh_tokens` for revocation. DB-backed rather than short-lived-only — short-lived-only would have no way to force-sign-out a compromised account.
- **Rotation on every refresh.** The old refresh token is invalidated when a new pair is issued.
- **Replay detection.** Reusing a rotated refresh token revokes the entire session lineage, on the assumption that a rotation collision means the attacker now has a token the legitimate client also held.
- **argon2id password hashing** (`packages/admin/src/modules/auth/password.ts`). The full PHC string is stored in `admin_users.password`.

`resolveActor(adminUserId)` joins `admin_role_admin_user` → `admin_permissions` → flat ability strings to build the runtime `AdminAuth`.

## Read-side scoping — the `beforeRead` hook

`CollectionHooks.beforeRead` is the query-level access-control surface. Signature:

```ts
beforeRead?: (ctx: {
  collectionPath: string
  requestContext: RequestContext
  readContext: ReadContext
}) => QueryPredicate | void | Promise<QueryPredicate | void>
```

Returns a `QueryPredicate` (or `void` for no scoping) that is **AND-merged** with the caller's `where` and compiled into the same `EXISTS` / `LEFT JOIN LATERAL` SQL machinery the client's existing `where` parser emits.

The predicate language adds `$and` / `$or` combinators to the existing `where` shape. `status` and `path` inside a combinator downshift from EAV-style `EXISTS` filters to direct outer-scope column comparisons via `DocumentColumnFilter` — so `{ $or: [{ status: 'published' }, { authorId: actor.id }] }` ("published, or owned by me") composes correctly.

Wired into:

- Every `@byline/client` `CollectionHandle` read entry point.
- `populateDocuments` — once per target collection per request, before the batch fetch.

A per-`ReadContext` cache (`beforeReadCache`, keyed by `collectionPath`) ensures async hooks don't re-run across populate fanout for the same target collection.

```ts
// Example — owner-only drafts
beforeRead({ requestContext }) {
  if (requestContext.actor?.hasAbility('collections.posts.update.any')) return
  return {
    $or: [
      { status: 'published' },
      { authorId: requestContext.actor?.id ?? '__none__' },
    ],
  }
}
```

Six worked examples in [ACCESS-CONTROL-RECIPES.md](./ACCESS-CONTROL-RECIPES.md). The `client-before-read.integration.test.ts` suite in `packages/client/tests/integration/` wires Recipes 1 and 2 end-to-end and serves as the executable companion.

## Admin UI surface

Route trees under `apps/webapp/src/routes/(byline)/admin/`. The page-level routes are thin shells that call into route factories from `@byline/host-tanstack-start/routes`, so the admin UI is reusable across host installations.

| Area              | Capability                                                                                  |
|-------------------|---------------------------------------------------------------------------------------------|
| `sign-in`         | Password sign-in via `JwtSessionProvider.signInWithPassword`.                               |
| `account/`        | Self-service profile + password change.                                                     |
| `users/`          | List / create / edit / enable / disable admin users; assign roles; set password.            |
| `roles/`          | List / create / edit / reorder admin roles; member assignment.                              |
| `permissions/`    | Read-only inspector — registered abilities, role-ability matrix, who-has-what lookup.       |
| `collections/`    | Per-collection list / create / edit / history / status. Standard CMS surface.               |

The role-ability editor (under `roles/`) is the primary control-plane UI: a checkbox tree driven by `listAbilities()`, grouped by ability `group`. Every checkbox toggle round-trips through `admin-roles.setRoleAbilities` (gated on `admin.permissions.update`).

The `permissions/` inspector is **read-only by design** — it surfaces what is registered and who holds it, but never edits. File-based config stays primary for anything schema-shaped (collections, fields, workflows, registered abilities). Drupal's structural mistake — making every schema-shaped decision live-editable from the UI — fragmented its source of truth between database rows and config files. Byline holds the line: file-based config is primary, the UI is an inspector for registered state, and only genuinely runtime concerns (feature flags, SMTP, branding) are ever live-editable.

UI ability cues — hiding Create / Publish / Delete buttons, disabling menu items — are cosmetic. The `useAbility()` hook and `<RequireAbility>` wrapper exist for UX, not security. The real gates run in the service layer per `assertActorCanPerform` and `assertAdminActor`.

## Data model

```
admin_users
  id                       uuid     pk
  vid                      uuid              -- version id
  given_name               text
  family_name              text
  username                 text     unique
  email                    text     unique
  password                 text              -- argon2id PHC string
  remember_me              boolean
  last_login               timestamptz
  last_login_ip            inet
  failed_login_attempts    int
  is_super_admin           boolean
  is_enabled               boolean
  is_email_verified        boolean
  created_at, updated_at   timestamptz

admin_roles
  id                       uuid     pk
  vid                      uuid
  name                     text
  machine_name             text     unique
  description              text
  order                    int
  created_at, updated_at   timestamptz

admin_role_admin_user
  admin_role_id            uuid     fk → admin_roles
  admin_user_id            uuid     fk → admin_users
  primary key (admin_role_id, admin_user_id)

admin_permissions
  id                       uuid     pk
  admin_role_id            uuid     fk → admin_roles
  ability                  varchar(128)      -- flat dotted string
  created_at, updated_at   timestamptz
  unique (admin_role_id, ability)

admin_refresh_tokens                       -- JwtSessionProvider only
  id, admin_user_id, token_hash, issued_at, expires_at, revoked_at, replaced_by, ...
```

`admin_users.is_super_admin === true` short-circuits all ability checks at runtime — a super-admin's `AdminAuth` carries every registered ability synthetically. The flag is not a substitute for granting abilities to roles; it is the bootstrap and break-glass mechanism.

The seed under `apps/webapp/byline/seeds/admin.ts` creates one super-admin user and one `super-admin` role on a fresh install.

`UserAuth` tables are reserved but not designed. The `Actor` union declares the type so the contract does not have to grow a discriminator later.

## Architectural rules

1. **Service-layer enforcement, not transport-layer enforcement.** Auth gates live inside `@byline/core` / `@byline/admin` services. Transport edges (admin server fns, future HTTP endpoints) only resolve `RequestContext` and pass it down. This keeps the same gate active no matter which transport invokes the service.
2. **Flat abilities are the contract.** Plugins register abilities; the role editor enumerates them; `admin_permissions` stores them as rows. Conditional rules live in hooks, not in the database.
3. **`actor: null` is a first-class case.** Anonymous public readers are explicitly modelled. The null actor is permitted on `read` with `readMode: 'published'` and rejected everywhere else.
4. **Super-admin is explicit in the code, not ambient.** Migration scripts and seeds call `createSuperAdminContext({ id })`; there is no environment variable, no test-mode bypass, no implicit "internal call" exception.
5. **Reads go through `@byline/client`.** Even from the admin webapp. This keeps `beforeRead` / `afterRead` orchestration uniform with future external readers and means access-control predicates apply once, in one place.
6. **The admin UI is an inspector, not a control panel for schema.** File-based configuration is primary. Genuinely runtime settings (feature flags, SMTP) are fine to live-edit; collection schemas, field types, and workflow definitions are not.

## Explicitly deferred

The following are **declared in the contract but not implemented**, kept that way deliberately so the surface does not have to grow a discriminator when they land:

- **`UserAuth` sign-in surface.** The type is in the `Actor` union; the DB tables, sign-in flow, and admin UI wait for a concrete end-user feature.
- **Magic-link / SSO / OIDC providers.** `SessionProvider` accommodates them; built-in adapters wait for real demand.
- **UI-editable conditional rules (CASL-style).** Hooks remain the expression surface. Revisit if real workloads demand role-editable conditional rules.
- **Site-settings storage and editor.** Orthogonal to auth. Decide whether to reuse the collection runtime when the requirement is in hand.

## Code map

| Concern                                  | Location                                                                   |
|------------------------------------------|----------------------------------------------------------------------------|
| Actor primitives                         | `packages/auth/src/actor.ts`                                               |
| `RequestContext` shape                   | `packages/auth/src/context.ts`                                             |
| `AbilityRegistry`                        | `packages/auth/src/abilities.ts`                                           |
| `SessionProvider` interface              | `packages/auth/src/session-provider.ts`                                    |
| `AuthError` factories                    | `packages/auth/src/errors.ts`                                              |
| Document-collection enforcement          | `packages/core/src/auth/assert-actor-can-perform.ts`                       |
| Admin-management enforcement             | `packages/admin/src/lib/assert-admin-actor.ts`                             |
| `beforeRead` orchestration               | `packages/core/src/auth/apply-before-read.ts`                              |
| `QueryPredicate` + combinators           | `packages/core/src/@types/query-predicate.ts`                              |
| Predicate compiler                       | `packages/core/src/query/parse-where.ts`                                   |
| Admin user / role / permission services  | `packages/admin/src/modules/admin-{users,roles,permissions,account}/`      |
| Built-in JWT session provider            | `packages/admin/src/modules/auth/jwt-session-provider.ts`                  |
| Admin store aggregate                    | `packages/admin/src/store.ts`                                              |
| Postgres admin repositories              | `packages/db-postgres/src/modules/admin/` (subpath: `@byline/db-postgres/admin`) |
| Admin schema + migration                 | `packages/db-postgres/src/database/schema/auth.ts`                         |
| Admin server-fn auth context resolver    | `packages/host-tanstack-start/src/auth/auth-context.ts` (`getAdminRequestContext`) |
| Admin server fns (auth)                  | `packages/host-tanstack-start/src/server-fns/auth/`                        |
| Admin server fns (management)            | `packages/host-tanstack-start/src/server-fns/admin-{users,roles,permissions,account}/` |
| Admin route factories                    | `packages/host-tanstack-start/src/routes/create-admin-*-route.tsx`         |
| Admin UI route shells                    | `apps/webapp/src/routes/(byline)/admin/`                                   |
| Super-admin seed                         | `apps/webapp/byline/seeds/admin.ts`                                        |
| Worked `beforeRead` recipes              | `docs/ACCESS-CONTROL-RECIPES.md`                                           |
| Integration test for `beforeRead`        | `packages/client/tests/integration/client-before-read.integration.test.ts` |
