# Future Architecture — Core Composition Signposts

> **Status:** working note, not a committed plan. Captured after the
> admin-store refactor (Option A) to record signposts drawn from the Modulus
> Learning codebase for how Byline's own DI / composition story might
> evolve.

## Context

Byline and Modulus both use the same `Registry` / `AsyncRegistry` typed DI
container (near-identical files, ~380 lines each, same public API). The
infrastructure to do full-DI composition exists in `@byline/core` today —
the difference is how heavily each codebase leans on it.

- **Modulus:** one `initModulusCore()` composes a nested registry tree
  covering every module (admin, app, agent), returns a command tree
  (`core.admin.adminUsers.commands.*`), and the consuming Next.js app has
  a single thin `core-adapter.ts` that memoises the instance plus typed
  request-context builders per actor realm.
- **Byline:** `initBylineCore()` registers only `config`, `collections`,
  `db`, `storage`, `logger`. Admin modules live in a separate
  `@byline/admin` package with hand-wired services and loose command
  functions (`setAdminUserPasswordCommand(ctx, input, { store })`).
  Server fns import each command and thread deps at the call site.

Both shapes work. Modulus's scales better once the admin surface grows
past a handful of commands; Byline's keeps the packages more decoupled,
which matters when the product is a framework rather than an app.

## What Modulus does differently

### 1. Command tree on the composed core

`initModulusCore()` returns:

```ts
{
  app:   { session: { refreshTokens, ... }, ... },
  admin: { adminUsers: { listAdminUsers, setPassword, ... }, ... },
  agent: { ... },
}
```

Call sites look like:

```ts
const core = await getCoreInstance()
const ctx = await getCoreRequestContext()
const result = await core.app.session.refreshTokens(ctx, { refreshToken })
```

No threading of `{ store }` or `{ deps }` at the call site — the commands
bind their deps at composition time.

### 2. Nested registries per module

`@modulus-learning/core/src/modules/admin/index.ts`:

```ts
export const createAdminRegistry = () =>
  new Registry()
    .addNested('account',    createAccountRegistry())
    .addNested('adminRoles', createAdminRoleRegistry())
    .addNested('adminUsers', createAdminUserRegistry())
    .addNested('reports',    createAdminReportRegistry())
    ...
```

Each module registry wires `queries + mutations + service + commands`.
The app never sees the service or the repositories — it gets the commands
object out the top.

### 3. Declarative command wrapper

Every Modulus command is one `createCommand(...)` call:

```ts
@cached get listAdminUsers() {
  return this.utils.createCommand({
    method: 'listAdminUsers',
    auth: { mode: 'admin', abilities: ['admin-users:list'] },
    schemas: { input: listAdminUsersRequestSchema, output: adminUserListResponseSchema },
    handler: this.service.listAdminUsers.bind(this.service),
  })
}
```

The wrapper runs the four-step contract:

1. `schema.parse(input)` — validated
2. `assertActor(ability)` — authorised
3. `handler(ctx, input)` — invoked
4. `output.parse(result)` — shaped

Byline's admin commands today do the same four steps by hand in every
function (see `packages/admin/src/modules/admin-users/commands.ts`). A
wrapper halves that file and makes the contract inspectable.

### 4. Typed request-context builders per actor realm

Modulus's `core-adapter.ts` has `getCoreRequestContext`,
`getCoreUserRequestContext`, `getCoreAdminRequestContext`,
`getCoreAgentRequestContext` — each returns a typed discriminated
`RequestContext`. Byline has `getAdminRequestContext` only; the
client-realm will need the same treatment when the public-user / agent
realms arrive.

### 5. Centralised env parsing in `loadConfig()`

`loadConfig()` is the single boundary where environment variables turn
into a typed `Config`. Byline currently reads `process.env.*` inline in
`byline.server.config.ts` and seed scripts.

## Signposts for Byline

### Short version

1. **Add a `createCommand({ auth, schemas, handler })` wrapper** — biggest
   per-line leverage, no cross-package API changes, reversible.
2. **Package module registries inside `@byline/admin`** — one factory
   per module (e.g. `createAdminUsersRegistry()`) wiring queries /
   service / commands. Still instantiated by the app, but from a single
   factory per module.
3. **Compose module registries inside `initBylineCore()`** — the app
   passes `modules: [createAdminRegistry(), ...]` and gets back
   `bylineCore.admin.adminUsers.commands.*`. At this point the
   `adminStore?` config input added in the current refactor can be
   deleted — the store lives inside the registry.
4. **Typed request-context builders per actor realm** — pairs naturally
   with introducing the public-user realm from the `@byline/client`
   Phase-4 ambitions.
5. **`loadConfig()` for env parsing** — pure cleanup. Worth doing once
   the env surface grows (~10+ values) or the first prod
   misconfiguration bites.

### What *not* to copy

- **Modulus is a monolith; Byline is a framework.** Module registries
  need to live in the feature package (`@byline/admin`, future
  `@byline/workflow`) and be composed by the integration app — not all
  inside `@byline/core`. The current `.addNested(...)` pattern supports
  that, but it means the composition point has to accept registries
  *from* feature packages as first-class inputs.
- **Don't hardcode `auth: { mode: 'admin' | 'user' | 'agent' }`.**
  Byline's `AbilityRegistry` is open-ended; ability keys are
  contributed by collections at registration time. The `createCommand`
  wrapper should take an ability expression or a list of keys, not an
  enumerated realm.
- **Keep argon2 out of `@byline/core`.** Modulus pulls `argon2` directly
  into the admin service. Byline already separated this into
  `@byline/admin/auth`; don't let command-tree composition accidentally
  drag it back in via a transitive import.
- **Adapter boundary stays.** Modulus assumes one DB (Drizzle + Postgres)
  and wires `dbPool` / `TXManager` directly in the registry. Byline's
  equivalent slots need to stay behind the `IDbAdapter` interface so
  swapping the adapter remains a single-file change in
  `byline.server.config.ts`.

## Suggested order of work

1. `createCommand` wrapper in `@byline/admin` — no cross-package API
   change; refactors the existing command functions one at a time.
2. Module-level registry factories (`createAdminUsersRegistry()` etc.)
   inside `@byline/admin`. Still hand-composed by the app for now, but
   from a single factory each.
3. Extend `initBylineCore()` to accept `modules: [...]` and compose a
   command tree onto `BylineCore.admin`, `BylineCore.app`, etc. At this
   point the generic `adminStore?` parameter can retire.
4. Request-context builders per realm — add when the second actor
   realm arrives.
5. `loadConfig()` — when env surface grows or a misconfiguration bites.

## Related

- Current admin-store shape — see commit for Option A (generic
  `BylineCore<TAdminStore>` + `bylineCore.adminStore`).
- `packages/core/src/lib/registry.ts` — the DI primitive that would host
  all of the above.
- `AUTHN-AUTHZ-ANALYSIS.md` — the ability-key design that the
  `createCommand` `auth: { abilities: [...] }` slot needs to consume.
