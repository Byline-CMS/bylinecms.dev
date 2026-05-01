# Core Composition — Roadmap

> Companions:
> - [AUTHN-AUTHZ.md](./AUTHN-AUTHZ.md) — the ability-key design that the future `createCommand({ auth: { abilities } })` slot will consume.
> - [ROUTING-API.md](./ROUTING-API.md) — admin server fns are the current call sites that would benefit from a command-tree shape.

> **Status: forward-looking.** This document describes the planned evolution of Byline's dependency-injection and composition story. None of the phases below have shipped — today's setup (described under "Where we are now") is intentionally minimal. The phases are ordered by leverage and by how independent each one is.

## Where we are now

Byline already has the DI infrastructure it would need for richer composition — it just doesn't lean on it yet.

- **`Registry` / `AsyncRegistry`** — a typed DI container in `packages/core/src/lib/registry.ts` with compile-time dependency-graph validation via TypeScript conditional types.
- **`initBylineCore()`** — composes `config`, `collections`, `db`, `storage`, `logger`, plus the `AdminStore` aggregate, into a `BylineCore` instance. Server-side callers retrieve the resolved core via `getBylineCore<AdminStore>()`.
- **Admin modules in `@byline/admin`** — each module ships as `commands.ts` + `repository.ts` + `service.ts` + `dto.ts` + `schemas.ts` + `errors.ts` + `abilities.ts`. Repositories are plugged into `AdminStore` from `@byline/db-postgres/admin`.
- **Hand-wired command contract.** Each command in `@byline/admin` is a plain exported function that runs the same four steps in the same order:

  ```ts
  export async function listAdminUsersCommand(
    context: RequestContext | undefined,
    input: unknown,
    deps: AdminUsersCommandDeps,
  ): Promise<AdminUserListResponse> {
    const parsed = listAdminUsersRequestSchema.parse(input ?? {})              // 1. validate
    assertAdminActor(context, ADMIN_USERS_ABILITIES.read)                       // 2. authorise
    const result = await serviceOf(deps).listUsers(parsed)                      // 3. invoke
    return adminUserListResponseSchema.parse(result)                            // 4. shape
  }
  ```

  The pattern works and is uniform across every module — but the four steps repeat verbatim in every command, and every server-fn call site has to thread `{ store }` through `deps` by hand.

- **One request-context builder.** `getAdminRequestContext()` resolves the admin actor for admin server fns. There is no equivalent yet for a public-user realm or any future agent realm; `RequestContext.actor` is typed as `Actor = AdminAuth | UserAuth | null` so the slot is reserved, but only `AdminAuth | null` is populated at runtime today.

- **Inline env parsing.** `byline/server.config.ts` and seed scripts read `process.env.*` directly. There is no central `loadConfig()` boundary that turns environment into a typed `Config`.

This shape is a deliberate baseline. It keeps the package boundaries decoupled — important when the product is a framework rather than a single app — and avoids speculative abstraction. The phases below add structure where the per-line repetition cost is high enough to justify it.

## Future phases of work

| Phase | Goal                                                                                  | Independent? |
|-------|---------------------------------------------------------------------------------------|--------------|
| 1     | `createCommand({ auth, schemas, handler })` wrapper                                   | Yes          |
| 2     | Module-level registry factories inside `@byline/admin`                                | Builds on 1  |
| 3     | Compose module registries inside `initBylineCore()`; expose a command tree on `BylineCore` | Builds on 2  |
| 4     | Typed request-context builders per actor realm (`AdminAuth`, `UserAuth`, future agent) | Yes          |
| 5     | `loadConfig()` — single env-parsing boundary                                          | Yes          |

Phases 1 → 2 → 3 form one track (command/registry shape); Phases 4 and 5 are independent. The whole roadmap is reversible — none of these phases are load-bearing for shipped functionality.

### Phase 1 — `createCommand` wrapper

Highest per-line leverage. The four-step contract above (validate → authorise → invoke → shape) repeats in every command. A small wrapper inside `@byline/admin` collapses the boilerplate to:

```ts
export const listAdminUsers = createCommand({
  method: 'listAdminUsers',
  auth: { abilities: [ADMIN_USERS_ABILITIES.read] },
  schemas: { input: listAdminUsersRequestSchema, output: adminUserListResponseSchema },
  handler: (ctx, input, { store }) => new AdminUsersService({ repo: store.adminUsers }).listUsers(input),
})
```

The wrapper does the four steps in fixed order; the handler stays focused on the actual work. Three benefits:

- **Halves the line count** of each `commands.ts` file. The current admin-users module has ~10 commands × ~10 lines each in repetitive structure; a wrapper cuts that to ~10 commands × ~5 lines of declaration.
- **Makes the contract inspectable.** The wrapper can log every command call uniformly, emit OpenAPI / JSON-Schema descriptors from the typed `schemas` slot, and — eventually — power a "what's registered" admin inspector view that mirrors the ability registry.
- **No cross-package API change.** Adopting the wrapper is a refactor inside `@byline/admin` only. Server-fn call sites still import the same exported names.

Implementation notes:

- The wrapper takes an **ability expression** or a list of keys — *not* an enumerated `mode: 'admin' | 'user' | 'agent'` field. Byline's `AbilityRegistry` is open-ended; ability keys are contributed by collections at registration time, and the wrapper has to stay agnostic about which realm is asserting them.
- `auth` should support both `assertAdminActor`-style admin gates and the more general `assertActorCanPerform` shape used for collection writes. A discriminator on the auth slot (`{ admin: ... }` vs `{ collection: ... }`) is one option; a single helper that dispatches on the ability key prefix is another. Decided when Phase 1 lands.

The wrapper is the smallest, most reversible step. It can land before any of the registry-tree work and would still pay for itself in line count.

### Phase 2 — Module-level registry factories

Each admin module currently exports loose commands; the integrating app wires `{ store }` into every call. Phase 2 packages each module's wiring as a single factory that lives inside `@byline/admin`:

```ts
// packages/admin/src/modules/admin-users/index.ts
export const createAdminUsersRegistry = (store: AdminStore) =>
  new Registry()
    .add('repo', store.adminUsers)
    .add('service', ({ repo }) => new AdminUsersService({ repo }))
    .add('commands', ({ service }) => ({
      listAdminUsers: createCommand({ ..., handler: service.listAdminUsers }),
      // ...
    }))
```

Same pattern for `admin-roles`, `admin-permissions`, `admin-account`, and any future module. The integrating app composes the registries at startup but no longer touches the wiring inside each module.

This phase depends on Phase 1 — without `createCommand`, every factory still has the four-step contract inline. With Phase 1 in place, the registry factories become a clean transcription.

### Phase 3 — Compose module registries inside `initBylineCore()`

Once each module ships a registry factory, `initBylineCore()` can accept `modules: [...]` and expose a typed command tree on the resolved core:

```ts
const core = await initBylineCore({
  config, collections, db, storage,
  modules: [
    createAdminRegistry(adminStore),    // composes admin-users + admin-roles + ...
    createWorkflowRegistry(...),         // future
  ],
})

const result = await core.admin.adminUsers.commands.listAdminUsers(ctx, input)
```

Server-fn call sites stop importing individual command functions and stop threading `deps` — both are bound at composition time. The current `adminStore?` parameter on `BylineCore<TAdminStore>` retires; the store lives inside the registry tree.

Two design constraints to lock in:

- **Module registries live in their feature package, not in `@byline/core`.** Byline is a framework, not a monolith — `@byline/admin` ships its own composition factory; a future `@byline/workflow` ships its own; the integrating app composes them. `@byline/core` provides the `Registry` primitive and the `initBylineCore` composition point but does not import feature packages directly.
- **The adapter boundary stays.** `IDbAdapter` and `IStorageProvider` remain the contracts that adapter packages implement. Module registries consume those interfaces; they do not wire concrete connection pools or transaction managers themselves. Swapping the DB adapter must remain a single-file change in `byline/server.config.ts`.

### Phase 4 — Per-realm request-context builders

Today's `getAdminRequestContext` returns a `RequestContext` with `actor: AdminAuth`. When the public-user realm arrives (driven by the first feature that needs an authenticated reader — gated content, member-only articles, per-user drafts), the call sites need a parallel `getUserRequestContext` that resolves a `UserAuth` actor. The same applies to a future agent realm if one materialises.

The work is purely additive: each new builder is a sibling function, each returns a typed-discriminated `RequestContext`, and each is invoked at the top of its respective transport layer (admin server fns, public reader endpoints, agent endpoints). No changes to the service-layer enforcement helpers — `assertActorCanPerform` and `assertAdminActor` already dispatch on actor type.

Sequencing: this phase pairs naturally with whatever feature first introduces the second realm. Building it speculatively now would be over-fitting on a single use case.

### Phase 5 — `loadConfig()`

A single boundary where environment variables turn into a typed `Config` object:

```ts
// packages/core/src/config/load-config.ts
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse({
    db: { connectionString: env.BYLINE_DB_URL },
    storage: { /* ... */ },
    auth:    { /* ... */ },
    // ...
  })
}
```

Pure cleanup. The current inline `process.env.*` reads work; they're just scattered. A single boundary catches misconfiguration at startup with a useful error message rather than at the first request that happens to need the missing variable.

Worth doing once one of two things happens:

- The env surface grows past ~10 values (currently smaller — `loadConfig()` would be over-engineered today).
- The first production misconfiguration bites and surfaces the cost of scattered reads.

Until then this is in the "nice to have, no rush" tier.

## Architectural guard rails

Three things to hold the line on across all phases:

1. **Module registries live in feature packages, not in `@byline/core`.** Byline composes; it does not own. A new feature package ships its own registry factory; the integrating app wires it in. `@byline/core` stays unaware of feature-specific concerns.
2. **Auth keys, not auth realms.** The `createCommand` wrapper takes an ability expression or a list of keys, not an enumerated `mode`. The `AbilityRegistry` is the source of truth — collections and plugins contribute their abilities at registration time, and the wrapper stays open to whatever they declare.
3. **Adapter boundary is permanent.** `IDbAdapter` / `IStorageProvider` / `SessionProvider` are the contracts that adapter packages implement. Module registries consume them via interface; they do not wire concrete dependencies (Drizzle pools, argon2, S3 clients, etc.) directly. This is what keeps "swap the adapter" a single-file change in `byline/server.config.ts`.

## Code map

| Concern                              | Location                                                                |
|--------------------------------------|-------------------------------------------------------------------------|
| `Registry` / `AsyncRegistry`         | `packages/core/src/lib/registry.ts`                                     |
| `initBylineCore` composition point   | `packages/core/src/core.ts`                                             |
| Admin module commands (current shape)| `packages/admin/src/modules/admin-{users,roles,permissions,account}/commands.ts` |
| `AdminStore` aggregate               | `packages/admin/src/store.ts`                                           |
| `assertAdminActor` enforcement       | `packages/admin/src/lib/assert-admin-actor.ts`                          |
| `assertActorCanPerform` enforcement  | `packages/core/src/auth/assert-actor-can-perform.ts`                    |
| `AbilityRegistry`                    | `packages/auth/src/abilities.ts`                                        |
| Admin request-context resolver       | `packages/host-tanstack-start/src/auth/auth-context.ts` (`getAdminRequestContext`) |
| Server-fn call sites (would consume command tree) | `packages/host-tanstack-start/src/server-fns/admin-{users,roles,permissions,account}/` |
