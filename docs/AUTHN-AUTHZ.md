---
title: "Authentication & Authorization"
path: "authn-authz"
summary: "How actors, abilities, and request context flow through Byline — plus six worked beforeRead recipes for row-level access control on document reads and populate."
---

# Authentication & Authorization

Companions:
- [COLLECTIONS.md](./COLLECTIONS.md) — lifecycle hooks (including `beforeRead` / `afterRead`) live on the collection schema; this doc is the reference for the auth subsystem the hooks plug into.
- [ROUTING-API.md](./ROUTING-API.md) — server-fn transport that resolves `RequestContext` and passes it down.
- [RELATIONSHIPS.md](./RELATIONSHIPS.md) — `ReadContext` is the seed for the actor-carrying `RequestContext`; populate threads `beforeRead` through to populated target collections.
- [CLIENT-SDK.md](./CLIENT-SDK.md) — the in-process SDK is where actor threading becomes externally visible.

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

---

## Quick reference

Each entry is the minimal shape for one task. The "Edit" line tells you which file you actually change; the link at the end points at the deeper architecture section.

### 1. Register a new ability

Abilities are flat dotted strings. Subsystems register them once at boot so the role-ability editor can enumerate them as a checkbox tree.

**Edit:** the registering module — e.g. `packages/admin/src/modules/admin-users/abilities.ts` for built-in admin abilities, or `apps/webapp/byline/server.config.ts` after `initBylineCore()` returns for app-level additions.

```ts
import type { AbilityRegistry } from '@byline/auth'

export function registerMyPluginAbilities(registry: AbilityRegistry) {
  registry.register({
    key: 'plugins.myThing.read',
    label: 'Read my-thing',
    group: 'My Plugin',
    description: 'View my-thing records.',
  })
  registry.register({
    key: 'plugins.myThing.update',
    label: 'Update my-thing',
    group: 'My Plugin',
    description: 'Edit my-thing records.',
  })
}
```

Collection abilities (`collections.<path>.{read,create,update,delete,publish,changeStatus}`) are auto-registered by `initBylineCore()` — only plugins outside the collection runtime need to register manually.

→ [Abilities](#abilities)

### 2. Assert an ability at a service-layer call site

Service-layer enforcement is the real boundary. UI cues are cosmetic. Every write entry point and every read entry point on `@byline/client` already routes through these helpers — you only call them directly when authoring a *new* service.

**Edit:** the new service file — e.g. `packages/core/src/services/<your-service>.ts` (collection scope) or `packages/admin/src/modules/<module>/commands.ts` (admin scope).

```ts
// Collection-scope service — gates `verb` on `collections.<path>.<verb>`.
import { assertActorCanPerform } from '@byline/core/auth'

await assertActorCanPerform(requestContext, collectionPath, 'update')
```

```ts
// Admin-scope command — always requires AdminAuth, asserts the named ability.
import { assertAdminActor } from '@byline/admin'

const actor = assertAdminActor(requestContext, 'admin.users.create')
```

→ [The enforcement boundary](#the-enforcement-boundary)

### 3. Resolve `RequestContext` in a script or seed

Seeds, migrations, and one-off scripts need a `RequestContext` to call `@byline/client` or any service-layer entry point. Use `createSuperAdminContext` — the super-admin path is *explicit* in the code, never ambient.

**Edit:** `apps/webapp/byline/seeds/<your-seed>.ts` (or any script that imports `byline/server.config.ts`).

```ts
import { createSuperAdminContext } from '@byline/auth'
import { getBylineClient } from '@byline/core'

const context = createSuperAdminContext({ id: 'seed:bootstrap' })
const client = getBylineClient({ requestContext: context })

await client.collection('pages').create({ title: 'Hello world' })
```

Inside admin server functions, use `getAdminRequestContext()` instead — see [Actors and `RequestContext`](#actors-and-requestcontext).

→ [Actors and `RequestContext`](#actors-and-requestcontext)

### 4. Recipe — owner-only drafts

Anyone with `read` sees published documents. Authors additionally see their own drafts. Editors with a broader ability see everything.

**Edit:** the collection schema — e.g. `apps/webapp/byline/collections/posts/schema.ts`.

```ts
import { defineCollection } from '@byline/core'

export const Posts = defineCollection({
  path: 'posts',
  fields: [/* … includes authorId */],
  hooks: {
    beforeRead: ({ requestContext }) => {
      if (requestContext.actor?.hasAbility('collections.posts.read.any')) return
      return {
        $or: [
          { status: 'published' },
          { status: 'draft', authorId: requestContext.actor?.id ?? '__none__' },
        ],
      }
    },
  },
})
```

The fallback `'__none__'` collapses cleanly when `actor` is absent — anonymous readers get the published-only branch.

→ [Read-side scoping — `beforeRead`](#read-side-scoping--the-beforeread-hook)

### 5. Recipe — multi-tenant scoping

Every document belongs to a tenant. Every read clamps to the actor's tenant — full stop, no ability needed. Deny-by-default.

**Edit:** the collection schema.

```ts
hooks: {
  beforeRead: ({ requestContext }) => ({
    tenantId: requestContext.actor?.tenantId ?? '__none__',
  }),
}
```

Anonymous readers see nothing, because no tenant matches `'__none__'`. If a tenant has a public storefront, expose it through a separate collection or a dedicated `published-and-public` flag rather than relaxing this predicate — tenant scoping should never have a forgotten escape hatch.

→ [Read-side scoping — `beforeRead`](#read-side-scoping--the-beforeread-hook)

### 6. Recipe — embargo / scheduled publish

Documents go live at a specific timestamp. Non-editors must not see them before then; editors should see them in preview.

**Edit:** the collection schema.

```ts
hooks: {
  beforeRead: ({ requestContext }) => {
    if (requestContext.actor?.hasAbility('collections.posts.read.embargoed')) return
    return { publishAt: { $lte: new Date().toISOString() } }
  },
}
```

The predicate compares against `publishAt` at query time, so each request reads "now" — caching layers above this need to be cache-key-aware of time, or the embargo lifts late.

→ [Read-side scoping — `beforeRead`](#read-side-scoping--the-beforeread-hook)

### 7. Recipe — soft-delete hide

Documents are soft-deleted by setting `deletedAt` rather than being removed from the table. Most readers never see them; an admin "trash bin" view opts in via an ability.

**Edit:** the collection schema.

```ts
hooks: {
  beforeRead: ({ requestContext }) => {
    if (requestContext.actor?.hasAbility('collections.posts.read.deleted')) return
    return { deletedAt: null }
  },
}
```

Pair with a `delete` collection method that performs the soft-delete write rather than a hard delete; otherwise the predicate has nothing to scope.

→ [Read-side scoping — `beforeRead`](#read-side-scoping--the-beforeread-hook)

### 8. Recipe — department / workspace visibility

Each document is tagged with a department. Users may belong to multiple departments and see documents from any of theirs.

**Edit:** the collection schema.

```ts
hooks: {
  beforeRead: ({ requestContext }) => ({
    departmentId: { $in: requestContext.actor?.departmentIds ?? [] },
  }),
}
```

When `departmentIds` is empty, `$in: []` returns no rows — deny by default. If the actor's department list is loaded asynchronously, make the hook `async`; the read context caches the predicate per `(collectionPath, actor)` so the lookup runs once per read regardless of populate fanout.

→ [Read-side scoping — `beforeRead`](#read-side-scoping--the-beforeread-hook)

### 9. Recipe — self-only on user-like collections

A `profiles` collection (or similar user-shaped data) where ordinary users may only see their own row, but staff with a broader ability see all rows.

**Edit:** the collection schema.

```ts
hooks: {
  beforeRead: ({ requestContext }) => {
    if (requestContext.actor?.hasAbility('collections.profiles.read.any')) return
    return { id: requestContext.actor?.profileId ?? '__none__' }
  },
}
```

The reserved `id` key resolves to the logical document id. If your user model links profiles by a separate foreign key (e.g. `userId` rather than `profileId === actor.id`), filter on that field instead.

→ [Read-side scoping — `beforeRead`](#read-side-scoping--the-beforeread-hook)

### 10. Mask or redact a field on read (`afterRead`)

Field-level visibility — masking, hashing, omitting — lives in `afterRead`. The hook receives the materialised document and can mutate `doc.fields` in place; mutations propagate through the response.

**Edit:** the collection schema.

```ts
hooks: {
  afterRead: ({ doc, requestContext }) => {
    if (requestContext.actor?.hasAbility('collections.users.read.pii')) return
    if (doc.fields.email) {
      doc.fields.email = doc.fields.email.replace(/^([^@]).*@/, '$1***@')
    }
  },
}
```

`afterRead` fires after populate on the source document, so hooks see the fully populated tree. See [COLLECTIONS.md — Lifecycle hooks](./COLLECTIONS.md#lifecycle-hooks) for the full hook contract.

→ [Field-level redaction with `afterRead`](#field-level-redaction-with-afterread)

### 11. Bypass `beforeRead` (escape hatch)

Admin tooling, seeds, and migrations sometimes need to see everything regardless of scoping. The `_bypassBeforeRead: true` option on `@byline/client` read options is the deliberate, narrow exit.

**Edit:** the script or admin tool calling the SDK.

```ts
const allDocs = await client.collection('posts').find({
  where: { status: 'draft' },
  _bypassBeforeRead: true,   // skip the beforeRead scoping predicate
})
```

Use only from internal tooling. Never inside application code paths — the whole point of `beforeRead` is to apply uniformly.

→ [The documented escape hatches](#the-documented-escape-hatches)

### 12. Plug in a different `SessionProvider`

Sessions are pluggable behind `SessionProvider`. The built-in `JwtSessionProvider` is fully featured (15-min access, 30-day refresh, rotation, replay detection, argon2id), but Lucia, better-auth, WorkOS, Clerk, or institutional SSO can drop in by implementing the interface.

**Edit:** `apps/webapp/byline/server.config.ts`.

```ts
import { initBylineCore } from '@byline/core'
import { MyCustomSessionProvider } from '@my-org/byline-session-mycustom'

const sessionProvider = new MyCustomSessionProvider({ /* … */ })

const core = await initBylineCore<AdminStore>({
  // …db, collections, storage, adminStore, …
  sessionProvider,
})
```

The provider's `capabilities` flags (`passwordChange`, `magicLink`, `sso`) drive which affordances the admin UI renders.

→ [Sessions — `SessionProvider`](#sessions--sessionprovider-interface)

---

## Architecture

### Actors and `RequestContext`

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

### Abilities

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

**The `AbilityRegistry`.** `AbilityRegistry` (`packages/auth/src/abilities.ts`) is the single load-bearing abstraction. Every subsystem that wants to gate behaviour behind a permission registers its abilities at `initBylineCore()` time. Two consumers feed off it:

- **Runtime** — `assertAbility('collections.pages.publish')` is a flat set-membership check on `actor.abilities`. The registry validates keys in dev mode (warns on unregistered keys); the check itself does not consult it.
- **Admin UI** — the role-ability editor enumerates registered abilities, grouped by `group`, as a checkbox tree. No hand-wiring per plugin.

Collections auto-contribute their abilities at registration time:

```
collections.<path>.{ read, create, update, delete }
collections.<path>.{ publish, changeStatus }    // when a workflow is configured
```

`@byline/admin` registers its own abilities (`admin.users.*`, `admin.roles.*`, `admin.permissions.*`) the same way — via `register*Abilities()` exports. Future plugins follow the same pattern: register at init time, assert at call sites. The core knows nothing plugin-specific while still rendering a complete admin UI.

### Two-layer access control

**Layer 1 — flat abilities.** Coarse-grained, table-stored, role-editable from the UI. Sufficient for "can this actor call this verb on this collection at all." Asserted at the service-layer entry point.

**Layer 2 — conditional rules in hooks.** Per-collection, in code, with full access to the document and the actor. The hook machinery is where ownership, state-gated, locale-masked, and tenant-scoped rules live:

- `CollectionHooks.beforeRead` — contributes a `QueryPredicate` AND-merged into the SQL query. Owner-only, tenant-scoped, soft-delete-hide.
- `CollectionHooks.afterRead` — observes the materialised document and the actor; can mask fields, redact values, or tag rows.
- `CollectionHooks.beforeUpdate` / workflow transition hooks — gate writes on document state ("publish only if `status === 'in-review'`").

CASL's *ideas* (subject + action + conditions) are useful here; CASL itself is not adopted. CASL rules are code; flat abilities are data. Storing compiled CASL rules in a database and editing them from a UI was rejected as awkward at best.

The six Quick Reference recipes above cover the common Layer-2 patterns end-to-end. The deeper mechanics of the hook itself are documented in [Read-side scoping](#read-side-scoping--the-beforeread-hook).

### The enforcement boundary

UI cues (hiding buttons, disabling menu items) are **cosmetic and explicitly untrusted**. An attacker can call the server function directly, drive `@byline/client` from a script, or hit a future HTTP endpoint. The real boundary is the service layer — every caller is forced through it.

Two helpers, one per realm:

| Helper                  | Realm                                     | Location                                                  |
|-------------------------|-------------------------------------------|-----------------------------------------------------------|
| `assertActorCanPerform` | Document collections                      | `packages/core/src/auth/assert-actor-can-perform.ts`      |
| `assertAdminActor`      | Admin user / role / permission management | `packages/admin/src/lib/assert-admin-actor.ts`            |

**`assertActorCanPerform` — document collections.** Policy:

- No `requestContext` → `ERR_UNAUTHENTICATED`.
- `actor: null` → permitted **only** when `verb === 'read'` and `readMode === 'published'`. Any other null-actor call throws `ERR_UNAUTHENTICATED`.
- Otherwise → `actor.assertAbility('collections.<path>.<verb>')`. Throws `AuthError` on miss.
- `actor.isSuperAdmin === true` short-circuits the ability check.

Call sites:

- Every `document-lifecycle.*` write entry point (`createDocument`, `updateDocument`, `updateDocumentWithPatches`, `changeStatus`, `unpublishDocument`, `deleteDocument`, `restoreDocumentVersion`, `duplicateDocument`, `copyToLocale`).
- `field-upload.uploadField` — uploads are effectively a write under collection scope, gated on `create` even when `shouldCreateDocument: false`. See [FILE-MEDIA-UPLOADS.md](./FILE-MEDIA-UPLOADS.md).
- `@byline/client` `CollectionHandle` on every read path (`find`, `findById`, `findByPath`, `findOne`, `countByStatus`, `history`, `findByVersion`).
- Every admin webapp document-collection server fn (`packages/host-tanstack-start/src/server-fns/collections/{list,get,history,stats,create,update,delete,status,upload,restore-version,duplicate,copy-to-locale}.ts`). Writes thread `requestContext` into `DocumentLifecycleContext`; reads call `assertActorCanPerform` directly before the adapter call.

**`assertAdminActor` — admin management.** Policy:

- Always requires a present `AdminAuth` actor — no anonymous path.
- Asserts the specific module ability: `admin.users.*`, `admin.roles.*`, `admin.permissions.*`.

Called inside every `*Command` in `@byline/admin/admin-{users,roles,permissions,account}`. The transport wrappers (the matching server fns under `packages/host-tanstack-start/src/server-fns/admin-{users,roles,permissions,account}/`) carry no policy — they resolve `RequestContext` and delegate.

### The documented escape hatches

Two intentional bypasses exist, each on a single, well-marked seam:

- **`db.commands.*` / `db.queries.*` direct calls** bypass both helpers. Reserved for seeds, migrations, and internal tooling that need to bootstrap the system without an actor.
- **`_bypassBeforeRead: true`** on `@byline/client` read options skips `beforeRead` predicate application. Reserved for the same class of caller — admin tooling that needs to see everything regardless of scoping rules.

These are deliberate, narrow exits. There is no ambient bypass and no environment variable.

### Sessions — `SessionProvider` interface

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

**Built-in `JwtSessionProvider`** (`packages/admin/src/modules/auth/jwt-session-provider.ts` and friends):

- **15-minute access tokens.** Short enough that revocation propagates without a heavy real-time check on every request.
- **30-day refresh tokens** stored in `admin_refresh_tokens` for revocation. DB-backed rather than short-lived-only — short-lived-only would have no way to force-sign-out a compromised account.
- **Rotation on every refresh.** The old refresh token is invalidated when a new pair is issued.
- **Replay detection.** Reusing a rotated refresh token revokes the entire session lineage, on the assumption that a rotation collision means the attacker now has a token the legitimate client also held.
- **argon2id password hashing** (`packages/admin/src/modules/auth/password.ts`). The full PHC string is stored in `admin_users.password`.

`resolveActor(adminUserId)` joins `admin_role_admin_user` → `admin_permissions` → flat ability strings to build the runtime `AdminAuth`.

### Read-side scoping — the `beforeRead` hook

`CollectionHooks.beforeRead` is the query-level access-control surface.

```ts
beforeRead?: (ctx: {
  collectionPath: string
  requestContext: RequestContext
  readContext: ReadContext
}) => QueryPredicate | void | Promise<QueryPredicate | void>
```

The hook fires once per `findDocuments` call (and once per populate batch, per target collection), receives the actor and read context, and returns a `QueryPredicate`. The predicate is compiled into the same `EXISTS` / `LEFT JOIN LATERAL` SQL the client's existing `where` parser already emits, then **AND**ed onto whatever the caller passed in `where`. Callers never see the scope — it is invisible, query-level, and applies even when no `where` was specified. Returning `void` (or `undefined`) means "no scoping for this actor" — typically the admin / superuser path.

The predicate language is the same `WhereClause` shape callers already use, plus `$and` / `$or` for explicit combinators. Field names resolve through `field-store-map`, so any field type already filterable via client `where` is filterable from a hook. `status` and `path` inside a combinator — or inside a nested relation sub-clause — downshift to a direct outer-scope column comparison via `DocumentColumnFilter` (the adapter wires `status` to `td${depth}.status` inside a relation hop and `path` to a `pathProjection` subquery against `byline_document_paths`).

Wired into:

- Every `@byline/client` `CollectionHandle` read entry point.
- `populateDocuments` — once per target collection per request, before the batch fetch.

A per-`ReadContext` cache (`beforeReadCache`, keyed by `collectionPath`) ensures async hooks don't re-run across populate fanout for the same target collection.

**Composition rules:**

- **Hook predicate AND user `where`.** The compiler merges them with implicit AND. A user passing `where: { status: 'draft' }` against Recipe 1 (owner-only drafts) sees only their own drafts — both clauses apply.
- **`void` means "no scoping".** Use it for the superuser / unconditional-read branch. Do not return an empty object `{}` for the same purpose; treat empty objects as always-true predicates and prefer explicit early-return for readability.
- **Deny via sentinel, not by throwing.** When the actor cannot read anything in a collection, return a predicate that yields no rows (`{ id: '__none__' }`) rather than throwing. Throwing collapses list endpoints; sentinel predicates produce the natural empty result.
- **Bypass is explicit.** Admin tooling, migrations, and seeds pass `_bypassBeforeRead: true` on the read options to skip the hook. This is a deliberate escape hatch and should never be used inside application code.

**What `beforeRead` is *not* for:**

- **Field-level redaction.** Use `afterRead` to mutate `doc.fields` — see [the next section](#field-level-redaction-with-afterread). `beforeRead` is row-level only.
- **Computed-field filters.** The predicate compiles against EAV store columns and reserved document keys (`status`, `path`, `id`, system timestamps). Synthesise a real field if you need to filter on something derived.
- **Write-side checks.** `assertActorCanPerform` already gates every write path. Don't try to enforce mutation rules from a read hook.

The `client-before-read.integration.test.ts` suite in `packages/client/tests/integration/` wires the owner-only-drafts and multi-tenant recipes end-to-end and serves as the executable companion.

### Field-level redaction with `afterRead`

`afterRead` is the *materialised-document* hook. It fires once per document on every read path that flows through `@byline/client` or `populateDocuments`. The hook receives the document and the request context; mutations to `doc.fields` propagate back through the response.

```ts
afterRead?: (ctx: {
  doc: ClientDocument
  collectionPath: string
  requestContext: RequestContext
  readContext: ReadContext
}) => void | Promise<void>
```

Typical patterns:

- **Mask** — replace a value with a placeholder (`email` → `j***@example.com`).
- **Redact** — delete the key entirely.
- **Hash** — replace with a deterministic non-reversible value.
- **Tag** — add a synthetic field marking the row's visibility class.

`afterRead` runs after populate on the source document, so hooks observe the fully populated tree. Hooks that perform their own reads must thread `readContext` back through (`client.collection(…).find({ _readContext: readContext })`) so visited-set / read-budget / `afterReadFired` machinery stays consistent.

See [COLLECTIONS.md — Lifecycle hooks](./COLLECTIONS.md#lifecycle-hooks) for the broader hook surface (create / update / delete / status-change / unpublish), and Quick Reference recipe 10 for a worked masking example.

### Admin UI surface

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

### Data model

:::note[Table names]
Tables below are shown unprefixed for readability. Live names carry the
`byline_` prefix (`byline_admin_users`, `byline_admin_roles`, …) per
the Postgres adapter's namespacing convention — see
`packages/db-postgres/src/database/schema/auth.ts`.
:::

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
  preferred_locale         varchar(16)       -- nullable; admin interface
                                             -- language for this editor.
                                             -- See docs/I18N.md
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

### Architectural rules

1. **Service-layer enforcement, not transport-layer enforcement.** Auth gates live inside `@byline/core` / `@byline/admin` services. Transport edges (admin server fns, future HTTP endpoints) only resolve `RequestContext` and pass it down. This keeps the same gate active no matter which transport invokes the service.
2. **Flat abilities are the contract.** Plugins register abilities; the role editor enumerates them; `admin_permissions` stores them as rows. Conditional rules live in hooks, not in the database.
3. **`actor: null` is a first-class case.** Anonymous public readers are explicitly modelled. The null actor is permitted on `read` with `readMode: 'published'` and rejected everywhere else.
4. **Super-admin is explicit in the code, not ambient.** Migration scripts and seeds call `createSuperAdminContext({ id })`; there is no environment variable, no test-mode bypass, no implicit "internal call" exception.
5. **Reads go through `@byline/client`.** Even from the admin webapp. This keeps `beforeRead` / `afterRead` orchestration uniform with future external readers and means access-control predicates apply once, in one place.
6. **The admin UI is an inspector, not a control panel for schema.** File-based configuration is primary. Genuinely runtime settings (feature flags, SMTP) are fine to live-edit; collection schemas, field types, and workflow definitions are not.

### Explicitly deferred

The following are **declared in the contract but not implemented**, kept that way deliberately so the surface does not have to grow a discriminator when they land:

- **`UserAuth` sign-in surface.** The type is in the `Actor` union; the DB tables, sign-in flow, and admin UI wait for a concrete end-user feature.
- **Magic-link / SSO / OIDC providers.** `SessionProvider` accommodates them; built-in adapters wait for real demand.
- **UI-editable conditional rules (CASL-style).** Hooks remain the expression surface. Revisit if real workloads demand role-editable conditional rules.
- **Site-settings storage and editor.** Orthogonal to auth. Decide whether to reuse the collection runtime when the requirement is in hand.

---

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
| Integration test for `beforeRead`        | `packages/client/tests/integration/client-before-read.integration.test.ts` |
