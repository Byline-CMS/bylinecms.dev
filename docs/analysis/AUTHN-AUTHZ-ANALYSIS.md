# Authentication & Authorization — Analysis

> Last updated: 2026-04-25
> Status: **in flight.** The strategic analysis and phased plan below
> are the originating design from 2026-04-23; most of the plumbing has
> since shipped, and as of the latest pass enforcement is now live on
> every documented entry point. See the **Phase status** table
> immediately below. The remaining outstanding tracks are **Phase 7**
> (`beforeRead` hook + query-level filtering) and the bulk of **Phase
> 8** (registered-collections / who-has-what inspector views).
>
> Companion to [PHASES-OF-WORK.md](./PHASES-OF-WORK.md).
> Related:
> - [RELATIONSHIPS-ANALYSIS.md](./RELATIONSHIPS-ANALYSIS.md) —
>   `ReadContext` is the seed for the actor-carrying `RequestContext`
>   described below.
> - [CLIENT-IN-PROCESS-SDK-ANALYSIS.md](./CLIENT-IN-PROCESS-SDK-ANALYSIS.md) —
>   the client SDK is where actor threading becomes externally visible.

## Phase status (as of 2026-04-25)

| Phase | Title | Status | Where it lives |
|---|---|---|---|
| 0 | Package scaffold, actor primitives, context threading | **shipped** | `packages/auth/src/{actor,context,index}.ts`; `createSuperAdminContext` in `context.ts` |
| 1 | Ability registry + collection auto-registration | **shipped** | `packages/auth/src/abilities.ts` (`AbilityRegistry`); `@byline/admin` modules each export a `register*Abilities()` |
| 2 | Admin users / roles / permissions schema + services | **shipped** | `packages/db-postgres/src/database/schema/auth.ts` + migration; repositories under `packages/db-postgres/src/modules/admin/`; services under `packages/admin/src/modules/admin-{users,roles,permissions}/`; `seedSuperAdmin` wired into `apps/webapp/byline/seeds/admin.ts` |
| 3 | `SessionProvider` interface + built-in JWT provider | **shipped** | `packages/auth/src/session-provider.ts`; `packages/admin/src/modules/auth/{jwt-session-provider,password,refresh-tokens-repository,resolve-actor}.ts` |
| 4 | Enforcement at the service-layer boundary | **shipped** | Two enforcement helpers, one per realm. **Document collections:** `assertActorCanPerform` (`packages/core/src/auth/assert-actor-can-perform.ts`) — no-context → `ERR_UNAUTHENTICATED`; `actor: null` → only `verb === 'read'` and `readMode === 'published'`; otherwise `actor.assertAbility(...)`. Applied at every `document-lifecycle.*` entry point (create, update, updateWithPatches, changeStatus, unpublish, delete), at `document-upload`, at `@byline/client` `CollectionHandle`, and at every admin document server fn under `apps/webapp/src/modules/admin/collections/*` (writes via `DocumentLifecycleContext.requestContext`, reads via direct `assertActorCanPerform` before the adapter call). **Admin user / role / permission management:** `assertAdminActor` (`packages/admin/src/lib/assert-admin-actor.ts`) — always requires a present `AdminAuth` actor (no anonymous path) and asserts the specific module ability (`admin.users.*`, `admin.roles.*`, `admin.permissions.*`). Called inside every `*Command` in `@byline/admin/admin-{users,roles,permissions}`. Direct `db.commands.*` / `db.queries.*` calls intentionally bypass both helpers — the documented escape hatch for seeds, migrations, and internal tooling. |
| 5 | Admin server-fn auth middleware | **shipped** | `apps/webapp/src/lib/auth-context.ts` (`getAdminRequestContext`); sign-in / sign-out / current-user server fns under `apps/webapp/src/modules/admin/auth/`; sign-in route at `routes/{-$lng}/(byline)/sign-in.tsx` |
| 6 | Admin UI: sign-in, admin users, admin roles, role-ability editor | **shipped** | route trees under `apps/webapp/src/routes/{-$lng}/(byline)/admin/{users,roles,permissions,account}/`; components under `apps/webapp/src/modules/admin/admin-{users,roles,permissions}/components/` |
| 7 | `beforeRead` hook + query-level filtering | **outstanding** | not started; `afterRead` exists but `beforeRead` does not |
| 8 | Read-only inspector view | **partial** | the role-ability editor at `admin-permissions/components/inspector.tsx` lands one piece; the registered-collections panel and who-has-what matrix are not built |

The strategic analysis below (§§1–8) records the original design rationale and is preserved verbatim; references to "Phase 4" inside individual sections refer to the table above. Where wording in the original sections suggests work has not yet started, defer to the table.

## Context

Byline currently has **no authentication or authorization**. Every
admin server function is effectively open, `@byline/client` has no
notion of an actor, and item 3 on the phases-of-work roadmap
("access control (read-side)") is marked as unblocked by `afterRead`
but deliberately un-scoped, waiting for a concrete access model to
design against. This document is that access model, at the
strategic-decision layer — before any phased implementation plan.

Two reference implementations informed this analysis:

- **Modulus Learning** (`app.modulus-learning.org`) — the more
  mature of the two. Dedicated `admin_users` / `admin_roles` /
  `admin_role_admin_user` / `admin_permissions` tables in
  `packages/core`, a thin `AdminAuth` / `UserAuth` class pair
  carrying `{ id, abilities[] }` with `assertAbility` / `hasAbility`
  helpers, and discrete session services
  (`password-sign-in`, `token-issuer`, `token-refresh`,
  `token-verifier`). A mature admin UI for admin users, roles, and
  sessions lives in `apps/gradebook`.
- **Infonomic** (`infonomic.io`) — a slightly more conventional
  arrangement of the same pattern: `apps/api` carries the model and
  control plane, `apps/webapp` the admin UI. Same two-realm split
  (`admin/*` vs `app/*`), same ability-string contract.

Neither follows the Payload CMS "bend a collection into a users
table" approach. Byline will not either — see §1.

## Guiding principles

1. **Admin identity is a built-in subsystem, not a collection.**
2. **Two auth realms from day one, even if only one ships first.**
3. **Ability registration is the plugin contract — the single
   load-bearing abstraction.**
4. **Flat abilities as the baseline; CASL-style conditional rules
   expressed selectively through hooks.**
5. **Actor threads through the system via an extended
   `RequestContext`.**
6. **Admin UI covers site/user/role management; collections and
   plugins get a read-only inspector view. File-based config stays
   primary.**
7. **Session/token handling is pluggable behind a `SessionProvider`
   interface. Byline ships a JWT implementation mirroring Modulus;
   adapters for Lucia, better-auth, WorkOS, Clerk, or institutional
   SSO/IdPs are possible without fork.**
8. **The real enforcement boundary is the service layer, not the
   UI or the transport. UI ability cues are cosmetic.**

Each is unpacked below.

---

## 1. Admin identity is a built-in subsystem, not a collection

Admin users have constraints that make them a bad fit for the
collection runtime:

- Password hashing, salts, reset flows
- Sessions, refresh tokens, last-login, IP and failure tracking
- Lockout and enablement state
- A super-admin bypass flag
- Never localized, never versioned, never workflowed, never part of
  a document tree

Folding admin identity into the collection machinery (the Payload
approach) forces the collection system to grow concerns that do not
belong to it, and dilutes both sides of the contract. Byline's
`CollectionDefinition` is data-shape-only and should stay that way.

**Decision.** Dedicated `admin_users` / `admin_roles` /
`admin_role_admin_user` / `admin_permissions` tables owned by core
(likely in a new `@byline/auth` package, or a module inside
`@byline/core` — see "Package shape" below). Same shape as
Modulus. Admin user / role CRUD is a first-class built-in module,
not a registrable collection.

## 2. Two auth realms from day one

Modulus' and Infonomic's split between `AdminAuth` (CMS admins) and
`UserAuth` (end-user / app identity) is worth carrying forward even
if Byline ships only the admin realm first.

Rationale:

- The Client API already anticipates unauthenticated public readers
  (`status: 'published'` is the default for `@byline/client`).
  `UserAuth` is the natural hook for "logged-in reader with
  entitlements" — gated content, member-only articles, per-user
  drafts-in-progress.
- Retrofitting a second realm into a system that assumed one actor
  type is substantially harder than reserving the namespace up
  front. Every hook signature, every `RequestContext`, every SDK
  option has to grow a discriminator later.
- Even if there is no end-user sign-in surface in v1, the `actor`
  slot on `RequestContext` can simply be `null` (public) or
  `AdminAuth` without foreclosing the third case.

**Decision.** Model `Actor = AdminAuth | UserAuth | null` from day
one. Ship `AdminAuth` first; leave `UserAuth` as a declared but
unimplemented type until an end-user sign-in surface is needed.

## 3. Ability registration as the plugin contract

This is the most load-bearing idea in the analysis.

Make `registerAbility({ key, label, group, description })` a
framework primitive invoked at `initBylineCore()` time. Every
subsystem that wants to gate behaviour behind a permission
registers its abilities into a central registry. The registry then
feeds two consumers:

- **Runtime.** `AdminAuth.assertAbility('collections.pages.publish')`
  and friends consult the registry only to validate keys in dev;
  the check itself is a flat set membership.
- **Admin UI.** The role editor enumerates the registered abilities,
  grouped by `group`, as a checkbox tree. No hand-wiring per
  plugin.

Collections are the canonical example: for each registered
collection, the core auto-registers
`collections.<path>.{read, create, update, delete, publish, changeStatus}`.
Workflow, media, uploads, site settings, and any future plugin each
contribute their own ability groups.

Why this matters: it is the **single pattern that lets Byline's
core know nothing about plugin-specific permissions while still
rendering a complete admin UI for them**. Without it, every plugin
ships its own permissions model and the admin UI grows a special
case per plugin. With it, the core contract is "register your
abilities; the rest is free."

Open questions (for the phased plan):

- Shape of the ability key: flat dotted strings, or a structured
  `{ subject, action }` pair? Flat strings are simpler to store as
  `admin_permissions.ability varchar(128)` (Modulus' choice).
  Structured pairs are more CASL-shaped but harder to render as a
  UI row.
- Whether plugins can register *abilities that don't map to a
  collection* (yes — e.g. `media.manage`, `settings.edit`,
  `users.impersonate`). The registry must be general, not
  collection-specific.

## 4. Flat abilities as the baseline; CASL ideas, not CASL itself

CASL's real value is **subject-level conditional rules** — "update
an article only if `article.authorId === actor.id`", "publish only
if `status === 'in-review'`", "read only if `document.locale ∈
actor.allowedLocales`". Those rules genuinely matter for a CMS.

But adopting CASL as the core model costs the clean "abilities as
rows in a UI-editable table" story. CASL rules are code; roles are
data. Storing compiled CASL rules in a database and editing them
from an admin UI is awkward at best.

**Decision.** Two-layer model:

- **Layer 1 — flat ability strings.** The registered contract. What
  plugins register, what the role-editor UI lists, what
  `admin_permissions` stores as rows, what
  `AdminAuth.assertAbility()` checks. Coarse-grained and
  straightforward. Sufficient for most permission decisions.
- **Layer 2 — conditional rules, expressed in hooks.** Collection
  `beforeRead` / `beforeUpdate` / workflow-transition hooks are the
  right place for ownership, state, and locale-gated checks —
  per-collection, in code, with full access to the document and the
  actor. The hook machinery already exists.

Steal CASL's ideas (subject + action + conditions) selectively;
don't adopt its runtime. Revisit if real workloads demand
UI-editable conditional rules — but assume they don't until
evidence says otherwise.

## 5. Actor threading — extend `ReadContext` to `RequestContext`

The `ReadContext` built for the `afterRead` hook is the right seed.
Generalize it:

```ts
interface RequestContext {
  actor: AdminAuth | UserAuth | null
  requestId: string
  locale?: string
  readMode?: 'published' | 'any'
  // existing ReadContext fields (afterReadFired, populate cache, ...)
}
```

Every server function, lifecycle service, populate call, hook, and
client SDK entry point receives this context. Auth is simply what
populates `actor`; access control is what reads it in hooks.

This also cleanly answers "how does the client SDK express actor?"
Callers construct a context and pass it in. Migration scripts and
seed scripts pass an implicit super-admin context. Public web reads
pass `actor: null` with `readMode: 'published'`.

The existing guard in `ReadContext` (the `afterReadFired` set that
stops A→B→A re-firing during populate) carries over unchanged.

## 6. Admin UI — site/user/role management + read-only inspector

Modulus' admin module layout (`session`, `admin-users`,
`admin-roles`, `account`) covers roughly 80% of what Byline needs
for a v1 admin-auth UI. Byline should adopt the same shape:

- Sign in / sign out, password reset, account self-service
- Admin-user list, create, edit, disable, delete
- Admin-role list, create, edit; role-member assignment
- Role-ability editor (checkbox tree driven by the registered
  abilities)

What Byline adds over Modulus, for this project's scope:

- A **read-only inspector view** for collections and plugins —
  listing what is registered, which abilities each contributes,
  the schema hash/version, and who currently holds the abilities.
- A **site-settings surface** for genuinely runtime concerns —
  site name, default locale, SMTP, feature flags. Not schema.

Drupal's structural error was not "admin UI for settings." It was
making every schema-shaped decision live-editable from the UI,
which fragments the source of truth between database rows and
config files. Byline holds the line:

- File-based configuration is primary for anything schema-shaped
  (collections, fields, workflows, admin config).
- The UI is an **inspector** for registered state, not a control
  panel.
- Genuinely runtime settings (feature flags, SMTP, branding) are
  fine to edit in the UI.

## 7. `SessionProvider` interface — pluggable transport

Modulus' session layer is cleanly separated into
`password-sign-in`, `token-issuer`, `token-refresh`,
`token-verifier` — excellent internal boundaries, but it is still
bespoke JWT. Byline has a choice:

- **(a) Ship Modulus-shaped JWT as the one implementation.** Fast;
  matches the existing reference code; one fewer abstraction.
- **(b) Define a `SessionProvider` interface; ship a built-in JWT
  implementation behind it.** Positions the project for teams with
  existing SSO/IdP needs — Lucia, better-auth, WorkOS, Clerk,
  institutional SAML/OIDC. One more abstraction layer to maintain.

**Decision: (b).** Byline's stated priority is institutional and
community use, and those users often arrive with existing identity
infrastructure. The abstraction cost is bounded (a narrow interface
around sign-in, issue, refresh, verify, revoke), and the built-in
JWT implementation is the reference that demonstrates the
contract.

This is philosophically in some tension with Byline's "own your
data, avoid lock-in" posture — pluggability here quietly allows
integration with proprietary identity services. The mitigation is
that the **built-in JWT provider is always a fully capable first
option**, not a stub. A team can run Byline end-to-end without
reaching for any third-party identity service.

## 8. Enforcement boundary — service layer, not UI, not transport

UI cues (hiding buttons, disabling menu items, showing "requires
X ability" warnings) are **cosmetic and explicitly untrusted**. An
attacker can always call the server function directly, bypass the
client entirely, or drive `@byline/client` from a script. The real
boundary has to be somewhere every caller is forced to pass
through.

**Primary boundary: the service layer — `document-lifecycle` for
writes, `IDocumentQueries` for reads.** Every mutation path already
funnels through `document-lifecycle` (admin server fns call it;
`@byline/client.create/update/delete/changeStatus` call it; future
HTTP endpoints would call it). Enforcing there covers all four
transports with one assertion site. Every read path funnels through
`IDocumentQueries.findDocuments` / `getDocumentsByDocumentIds`, and
those are where ability-driven query predicates attach.

Concretely — three assertion points, each with a defined job:

| Point | Job | Mechanism |
|---|---|---|
| **Service-layer entry** (`document-lifecycle.*`, `IDocumentQueries.*`) | Coarse "can this actor call this at all" | `actor.assertAbility('collections.<path>.<verb>')` |
| **`beforeRead` hook** (to ship) | Query-scoping — add WHERE clauses based on abilities/actor | Hook contributes SQL predicates to `findDocuments` |
| **`afterRead` / `beforeUpdate` hooks** (afterRead shipped) | Row-level / field-level conditional rules — ownership, state gates, locale masks | Hook sees full doc + actor, mutates or rejects |

Transport edges (admin server fns, future HTTP endpoints) **do
not enforce**. Their job is to **populate `RequestContext.actor`**
from the session and pass it down. This keeps enforcement
transport-agnostic and makes the SDK path and the HTTP path
structurally identical.

`@byline/client` from a migration script constructs a super-admin
context explicitly. No ambient bypass, no environment variable —
the caller has to state "I am acting as super-admin" in code, and
that fact is auditable.

---

## Collection / plugin contract — implications

If the above is adopted, the existing `CollectionDefinition` and
`CollectionAdminConfig` pick up a small number of new responsibilities:

- `CollectionDefinition` stays data-shape-only. Abilities derive
  automatically from `path` and the configured workflow states.
- `CollectionAdminConfig` may optionally grow an `access` section
  declaring per-verb ability overrides or per-field read masks, but
  the **zero-config default is "a registered collection means you
  get its CRUD-plus-workflow abilities for free, gated by
  `collections.<path>.*`."**
- `CollectionHooks.beforeRead` / `beforeUpdate` / workflow
  transition hooks become the expression surface for conditional
  rules (Layer 2).
- Field-level masking is an `afterRead` application, now that the
  actor is on `RequestContext`.

Plugins that are not collections (media, uploads, settings, future
plugins) follow the same pattern: register their abilities at init
time; assert them at call sites.

## Data model (first cut)

Shape follows Modulus, with minor naming adjustments to fit Byline
conventions:

- `admin_users` — `id`, `vid`, `given_name`, `family_name`,
  `username`, `email`, `password`, `remember_me`, `last_login`,
  `last_login_ip`, `failed_login_attempts`, `is_super_admin`,
  `is_enabled`, `is_email_verified`, timestamps.
- `admin_roles` — `id`, `vid`, `name`, `machine_name`,
  `description`, `order`, timestamps.
- `admin_role_admin_user` — join table.
- `admin_permissions` — `id`, `admin_role_id`, `ability varchar(128)`,
  timestamps. One row per (role, ability) grant.
- Session state — shape depends on the chosen `SessionProvider`
  implementation. The built-in JWT provider likely needs a
  `admin_refresh_tokens` table for revocation.

End-user (`UserAuth`) tables are reserved but not designed in this
pass.

## Package shape

**Decision: new `@byline/auth` package.** The registry pattern in
`packages/core/src/lib/registry.ts` makes the abstraction cost
genuinely low: core stays auth-agnostic and receives the auth
subsystem at `initBylineCore()` time, the same way it receives DB
and storage adapters today. `@byline/core` does not grow another
responsibility; auth can evolve (session providers, SSO adapters,
future UserAuth) without reshaping core.

## Relationship to other in-flight work

- **Stable HTTP transport** (item 4 on PHASES-OF-WORK) remains
  deferred. Auth lands in the in-process SDK and admin server-fn
  surface first; whenever the HTTP boundary gets designed, it will
  inherit the `RequestContext` / `Actor` contract already in place.
- **UI extraction to `packages/ui`.** Identified as the logical
  phase *after* auth — extracting `ui/fields` and `ui/forms` once
  `RequestContext` and actor-aware rendering patterns are stable
  avoids re-threading the component tree twice.
- **`hasMany` and richtext document links.** Unaffected by auth
  decisions; can interleave with the auth phases if priorities
  shift.

## Open-question resolutions

Questions raised during the strategic pass, now resolved by the
phased plan below (or explicitly deferred):

| # | Question | Resolution |
|---|---|---|
| 1 | `@byline/auth` as a new package vs core module | **New `@byline/auth` package.** See "Package shape" above. |
| 2 | Ability key shape — flat dotted strings vs structured `{ subject, action }` | **Flat dotted strings** (`collections.pages.publish`, `media.manage`). Stored as `varchar(128)`. Structured pairs complicate the role editor without payoff at this scope. |
| 3 | Ship `UserAuth` in the same phase as `AdminAuth` or defer | **Defer.** `Actor` union declares `UserAuth` in Phase 0 but the DB, sign-in surface, and UI wait until a concrete end-user feature asks for it. |
| 4 | Refresh-token storage strategy for the built-in JWT provider | **DB-backed revocation.** `admin_refresh_tokens` table, short-lived access (15 min), longer refresh (30d), rotated on each use. Short-lived-only is rejected — no way to force-sign-out a compromised account. |
| 5 | Minimum `SessionProvider` surface | **Five methods required:** `signInWithPassword`, `verifyAccessToken`, `refreshSession`, `revokeSession`, and `resolveActor`. Capability flags (`supportsPasswordChange`, `supportsMagicLink`, `supportsSSO`, …) declared per-provider and consulted by the UI when rendering affordances. |
| 6 | Site-settings storage — reuse collection runtime or dedicated table | **Still open; explicitly deferred.** Orthogonal to auth. Decide when the settings requirement is in hand. |

---

## Implementation phases

Phases are sized so each produces a testable, integrable artefact.
Earlier phases build the plumbing; enforcement only turns on at
Phase 4. Admin UI lands at Phase 6.

### Phase 0 — Package scaffold, actor primitives, context threading

**Goal.** Establish the types and the request-scoped context that
every later phase depends on, without yet writing any DB or
enforcement.

Deliverables:

- `@byline/auth` package scaffolded (Rslib build, conventions
  mirroring `@byline/core`).
- `Actor = AdminAuth | UserAuth | null` types. `AdminAuth` fully
  modelled: `id`, `abilities: Set<string>`, `isSuperAdmin`,
  `assertAbility`, `hasAbility`, `assertAbilities`. `UserAuth`
  declared but stubbed.
- `RequestContext` extends the existing `ReadContext`: adds
  `actor`, `requestId`; keeps `afterReadFired`, populate cache,
  `readMode`.
- `createSuperAdminContext({ id })` helper for scripts and tests.
- `RequestContext` threaded through `document-lifecycle` and
  `IDocumentQueries` signatures — plumbing only, no assertions.
- Unit tests for `AdminAuth` ability checks.

### Phase 1 — Ability registry + collection auto-registration

**Goal.** Make "register an ability" a framework primitive.
Collections auto-contribute their CRUD-plus-workflow abilities.

Deliverables:

- `registerAbility({ key, label, group, description })` on
  `BylineCore`.
- `listAbilities()` / `getAbilitiesByGroup()` for UI consumption.
- Collection registrar auto-calls `registerAbility` for each
  registered collection:
  `collections.<path>.{read, create, update, delete}` plus
  `publish` and `changeStatus` when a workflow is configured.
- Dev-mode validation: `assertAbility` warns on unregistered keys.
- Unit tests + contract test asserting every declared collection
  emits its expected ability set.

### Phase 2 — Admin users / roles / permissions schema + services

**Goal.** Data model and service-layer CRUD for the admin identity
graph. No sessions, no HTTP, no UI.

Deliverables:

- Drizzle schemas matching the Modulus shape: `admin_users`,
  `admin_roles`, `admin_role_admin_user`, `admin_permissions`.
  Migration committed.
- Repositories + services in `@byline/auth` for admin-user CRUD,
  role CRUD, role-ability grant/revoke, user-role assignment.
- Password hashing (argon2id; `password` column stores the full
  PHC string).
- Seed script: one super-admin user + one `super-admin` role with
  `is_super_admin` flag set.
- `resolveActor({ adminUserId })` joins roles → permissions →
  abilities to build an `AdminAuth`.
- Integration tests against the real Postgres container.

### Phase 3 — `SessionProvider` interface + built-in JWT provider

**Goal.** A transport-agnostic session contract with one
fully-featured reference implementation.

`SessionProvider` minimum surface:

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

Deliverables:

- Interface in `@byline/auth`.
- Built-in `JwtSessionProvider`: 15-minute access tokens,
  30-day refresh tokens stored in `admin_refresh_tokens` for
  revocation, rotation on every refresh, replay detection.
- `initBylineCore()` accepts a `sessionProvider`, defaulting to
  `JwtSessionProvider`.
- Integration tests: sign in, verify, refresh, revoke,
  replay-attack on rotated refresh token.

### Phase 4 — Enforcement at the service-layer boundary

**Goal.** Turn enforcement on. This is the load-bearing phase —
review carefully.

Deliverables:

- `document-lifecycle.createDocument` / `updateDocument` /
  `deleteDocument` / `changeStatus` / `unpublishDocument` each
  call `context.actor?.assertAbility('collections.<path>.<verb>')`
  as their first step.
- `IDocumentQueries.findDocuments` /
  `getDocumentsByDocumentIds` / `findByPath` assert
  `collections.<path>.read`.
- `actor: null` permitted **only** when `readMode === 'published'`.
  Any other null-actor call throws `ERR_UNAUTHENTICATED`.
- Super-admin bypass: `actor.isSuperAdmin === true` short-circuits
  all ability checks.
- All seeds, migration scripts, and existing tests updated to
  pass a super-admin context.
- Integration tests: positive and negative cases per verb per
  collection.

At the end of this phase, Byline is authz-enforced end-to-end
through the SDK — no UI yet, but no unauthorized mutation path
either.

### Phase 5 — Admin server-fn auth middleware

**Goal.** Bridge the HTTP surface (admin server fns) into the
actor/context machinery.

Deliverables:

- TanStack Start middleware that reads session cookie or
  `Authorization` header, calls
  `sessionProvider.verifyAccessToken`, and attaches an
  `AdminAuth` to the request.
- `getRequestContext()` helper invoked at the top of every admin
  server fn, producing the `RequestContext` consumed downstream.
- Sign-in / sign-out / refresh server fns.
- Existing admin server fns under
  `apps/webapp/src/modules/admin/collections/*` refactored to
  acquire context and pass it into lifecycle services.
- Integration test: sign in → create document → ability check
  succeeds; under-privileged role → rejection.

### Phase 6 — Admin UI: sign-in, admin users, admin roles

**Goal.** The first user-visible milestone. UI ability cues are
cosmetic; Phase 4 is already doing the real work.

Deliverables:

- Sign-in page, sign-out, session expiry handling, password
  change (account self-service).
- Admin-users list / create / edit / enable-disable.
- Admin-roles list / create / edit; member assignment.
- Role-ability editor: checkbox tree driven by `listAbilities()`,
  grouped by ability `group`.
- UI-level ability cues: hide or disable Create / Publish /
  Delete buttons based on `actor.hasAbility(...)`. A helper
  `useAbility()` hook or `<RequireAbility>` wrapper, documented
  at the source as a UX affordance, not a security boundary.

### Phase 7 — `beforeRead` hook + query-level filtering

**Goal.** Let collections contribute WHERE-clause predicates based
on the actor — the read-side access-control track that was item 3
on PHASES-OF-WORK.

Deliverables:

- `CollectionHooks.beforeRead` signature:
  `({ context, collectionPath }) => QueryPredicate | void`.
- Predicate compiler translating structured predicates into the
  same `EXISTS` / `LEFT JOIN LATERAL` machinery used by
  field-level `where`.
- Applied uniformly at `IDocumentQueries.findDocuments` and
  threaded through populate.
- Documentation + one worked example on a test collection (e.g.
  "only own drafts").

### Phase 8 — Read-only inspector view

**Goal.** The "collections & plugins" admin panel. Read-only by
design — file-based config stays primary.

Deliverables:

- Admin page listing registered collections: path, schema hash /
  version, workflow states, registered abilities, row counts.
- Registered-plugins page: each plugin's name, version,
  contributed abilities.
- Who-has-what matrix: for a selected ability, which roles grant
  it and which admin users hold those roles.
- All views strictly read-only — no edit affordances.

### Explicitly deferred (not in this plan)

- `UserAuth` sign-in surface — wait for a concrete end-user
  feature. Types reserved in Phase 0; DB and UI wait.
- Site-settings storage and editor — orthogonal to auth. Decide
  whether to reuse the collection runtime when the requirement is
  in hand.
- Magic-link / SSO / OIDC providers — `SessionProvider` interface
  accommodates them; actual adapters wait for real demand.
- UI-editable conditional rules (CASL-style). Hooks remain the
  expression surface.
- **Pulling admin document reads through `CollectionHandle`.** Note
  this is specifically about the admin webapp's reads of *CMS
  documents* — the four server fns under
  `apps/webapp/src/modules/admin/collections/*` (`list`, `get`,
  `history`, `stats`). It is **not** about admin-user /
  admin-role / admin-permission management; those are already
  fully enforced through `assertAdminActor` inside every `*Command`
  in `@byline/admin` and have nothing to do with `CollectionHandle`.

  Phase 4 closed out by adding direct `assertActorCanPerform` calls
  to those four document-read server fns. That works, but it
  skips the rest of the `CollectionHandle` read pipeline —
  `populateDocuments` is invoked by hand in `get.ts`, the
  `afterRead` hook is **never** fired on admin document reads,
  and any future read concern (Phase 7 `beforeRead` predicate
  compilation, mask-on-read, redaction, audit logging) will have
  to be wired in twice. Migrating those four server fns to
  `bylineClient.collection(path).find(...)` / `findById(...)` etc.
  is the structurally clean fix. Deferred because (a) the
  migration is non-trivial — the published-vs-current "live" badge
  in `list.ts`, the `_publishedVersion` block in `get.ts`, the
  `populate: '*'` API-preview path, and the version-history
  endpoint each need a `CollectionHandle` option or a co-located
  escape hatch — and (b) Phase 7 is the natural trigger for it:
  once `beforeRead` lands, the admin document-read path needs the
  same predicate compiler the client uses, at which point this
  migration becomes the obvious answer rather than a parallel
  track. Tackle alongside or immediately after Phase 7.

### Sequencing notes

- Phases 0–3 have no user-visible surface; they are the
  scaffolding.
- Phase 4 is the load-bearing phase — enforcement actually turns
  on. Review carefully.
- Phases 5–6 land the usable admin experience.
- Phases 7–8 are refinements that can slot around other in-flight
  tracks (`hasMany`, richtext document links) once the core is in
  place.
- **UI extraction to `packages/ui`** is deliberately sequenced
  *after* this plan: extracting `ui/fields` and `ui/forms` is
  cleaner once `RequestContext`, actor-aware rendering, and
  ability cues have stabilised.

## Progress log

| Date | Change |
|------|--------|
| 2026-04-23 | Initial strategic analysis captured. |
| 2026-04-23 | Enforcement boundary decision added (§8). Open questions resolved. Phased plan (0–8) appended. |
| 2026-04-25 | Phase status table added at top. Phases 0–3, 5–6 shipped; Phase 8 partial (role-ability editor only). Phases 4 and 7 remain outstanding; service-layer enforcement (Phase 4) is the next auth work item. |
| 2026-04-25 | Phase 4 closed out for the document-collection realm. Service-layer enforcement was already shipped on the write path (`document-lifecycle`, `document-upload`) and on the public client read path (`CollectionHandle`); this pass added the four missing read assertions on the admin webapp's *document-collection* server fns (`list`, `get`, `history`, `stats`) so admin document reads now go through the same gate. (The admin user/role/permission management area was already fully enforced via `assertAdminActor` in every `*Command`, and is unaffected by this pass.) Outstanding tracks are now Phase 7 (`beforeRead` hook + query-level filtering) and the bulk of Phase 8 (inspector views). |
