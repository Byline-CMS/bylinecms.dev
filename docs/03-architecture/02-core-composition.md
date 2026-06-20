---
title: "Core Composition"
path: "core-composition"
summary: "How Byline's core packages compose: the typed registry/DI container, the initBylineCore() composition point, field-level server adapter slots, and the createCommand wrapper that gives admin operations a uniform validate → authorise → invoke → shape shape. Plus the guard rails that keep Byline a framework rather than a monolith."
---

# Core Composition

Byline is a framework, not a single application, so how its packages compose
matters as much as what each one does. This document covers the composition
machinery — the dependency-injection container, the server-side entry point, the
field-level adapter slots, and the command wrapper — and the architectural rules
that keep the package boundaries clean.

## The composition machinery

- **`Registry` / `AsyncRegistry`** — a typed DI container
  (`packages/core/src/lib/registry.ts`) with compile-time dependency-graph
  validation via TypeScript conditional types.
- **`initBylineCore()`** — the server-side entry point. It composes `config`,
  `collections`, `db`, `storage`, `logger`, and the `AdminStore` aggregate into a
  `BylineCore` instance. Server-side callers retrieve the resolved core via
  `getBylineCore<AdminStore>()`.
- **Admin modules in `@byline/admin`** — each module ships as `commands.ts` +
  `repository.ts` + `service.ts` + `dto.ts` + `schemas.ts` + `errors.ts` +
  `abilities.ts`. Repositories are plugged into `AdminStore` from
  `@byline/db-postgres/admin`.

This keeps the package boundaries decoupled — important when the product is a
framework rather than a single app — and avoids speculative abstraction.

## Field-level server adapter slots — `ServerConfig.fields.*`

An adapter package can register a server-side function alongside its client-side
React component, via mirrored slots on `ClientConfig.fields.*` and
`ServerConfig.fields.*`. The richtext adapter is the reference user of this
pattern:

- **Client side** — `ClientConfig.fields.richText.editor: RichTextEditorComponent`.
  A render-only React component, registered via `lexicalEditor()` from
  `@byline/richtext-lexical`.
- **Server side, write path** — `ServerConfig.fields.richText.embed: RichTextEmbedFn`.
  A pure function called once per rich-text leaf the write path discovers in an
  outgoing document, registered via `lexicalEditorEmbedServer()` from
  `@byline/richtext-lexical/server`.
- **Server side, read path** — `ServerConfig.fields.richText.populate: RichTextPopulateFn`.
  The mirror of the embed function; called once per rich-text leaf the read
  pipeline discovers in a returned document, registered via
  `lexicalEditorPopulateServer()`.

Two consequences shape any future field-level adapter:

1. **The subpath split is the right shape.** An adapter package with both client
   and server pieces ships two entry points so consumers of one don't bundle the
   other. `@byline/richtext-lexical` (UI) and `@byline/richtext-lexical/server`
   are the reference example.
2. **The framework owns the walker.** Field-level server adapters receive context
   per leaf (`{ value, fieldPath, collectionPath, readContext }`) — they don't
   walk the document tree themselves. `collectRichTextLeaves`
   (`packages/core/src/services/richtext-populate.ts`) is the per-field-type
   walker; a future adapter gets its own walker but slots into the same place in
   the read pipeline (between relation populate and user-land `afterRead`).

## `createCommand` — a uniform command shape

Every admin operation in `@byline/admin` is declared with `createCommand`
(`packages/admin/src/lib/create-command.ts`), which folds the four standard steps
— validate input → authorise → invoke → shape output — into a single
specification:

```ts
export const listAdminUsersCommand = createCommand({
  method: 'listAdminUsers',
  auth: { ability: ADMIN_USERS_ABILITIES.read },
  schemas: { input: listAdminUsersRequestSchema, output: adminUserListResponseSchema },
  handler: ({ input, deps }) =>
    new AdminUsersService({ repo: deps.store.adminUsers }).listUsers(input),
})
```

The wrapper runs the four steps in fixed order — Zod-parse input → resolve admin
actor → invoke handler → Zod-parse output — and returns a function with the
`(context, input, deps) => Promise<Output>` signature the server fns and tests
already expect.

**The `auth` slot is a discriminated union** with two variants:

- `{ ability: 'admin.users.read' }` — a full admin gate. Delegates to
  `assertAdminActor`, which requires an `AdminAuth` actor holding the named
  ability, and inherits the super-admin bypass from `AdminAuth.assertAbility`.
- `{ authenticated: true }` — an identity gate only. Delegates to
  `requireAdminActor` with no ability check. Used by `admin-account`
  self-service commands, where the security property is "you may only mutate your
  own row," enforced structurally by sourcing the target id from `actor.id`.

**The `handler` slot takes an args object** — `{ context, input, deps, actor }` —
so a handler cherry-picks what it needs without positional ordering. `actor` is
already narrowed to `AdminAuth` by the auth step, so commands that perform
self-checks (e.g. `disableAdminUser`, `deleteAdminUser`) read it directly.

Document-collection operations (create / update / delete / status / upload) are a
separate enforcement path: they are gated by `assertActorCanPerform` inside the
`document-lifecycle` services in `@byline/core`, and do not flow through
`createCommand`. See [Authentication & Authorization](../06-auth-and-security/01-authn-authz.md).

## Architectural guard rails

Three rules hold the line across the codebase:

1. **Feature wiring lives in feature packages, not in `@byline/core`.** Byline
   composes; it does not own. A feature package ships its own composition
   factory; the integrating app wires it in. `@byline/core` provides the
   `Registry` primitive and the `initBylineCore` composition point but does not
   import feature packages directly.
2. **Auth keys, not auth realms.** `createCommand` takes an ability expression,
   not an enumerated `mode`. The `AbilityRegistry` is the source of truth —
   collections and plugins contribute their abilities at registration time, and
   the wrapper stays open to whatever they declare.
3. **The adapter boundary is permanent.** `IDbAdapter` / `IStorageProvider` /
   `SessionProvider` are the contracts adapter packages implement. Feature code
   consumes them via interface; it never wires concrete dependencies (Drizzle
   pools, argon2, S3 clients) directly. This is what keeps "swap the adapter" a
   single-file change in `byline/server.config.ts`. Transactions live behind this
   boundary too: the request-scoped `withTransaction` capability is an *adapter*
   concern — the machinery sits in `@byline/db-postgres`, core only declares the
   optional `IDbAdapter.withTransaction` capability, and a non-transactional
   (e.g. HTTP-gateway serverless) adapter must reject it loudly rather than
   degrade silently. See [Transactions](./03-transactions.md).

## Code map

| Concern                              | Location                                                                |
|--------------------------------------|-------------------------------------------------------------------------|
| `Registry` / `AsyncRegistry`         | `packages/core/src/lib/registry.ts`                                     |
| `initBylineCore` composition point   | `packages/core/src/core.ts`                                             |
| `createCommand` wrapper              | `packages/admin/src/lib/create-command.ts`                             |
| Admin module commands                | `packages/admin/src/modules/admin-{users,roles,permissions,account}/commands.ts` |
| `AdminStore` aggregate               | `packages/admin/src/store.ts`                                           |
| `assertAdminActor` enforcement       | `packages/admin/src/lib/assert-admin-actor.ts`                          |
| `assertActorCanPerform` enforcement  | `packages/core/src/auth/assert-actor-can-perform.ts`                    |
| `AbilityRegistry`                    | `packages/auth/src/abilities.ts`                                        |
| Admin request-context resolver       | `packages/host-tanstack-start/src/auth/auth-context.ts` (`getAdminRequestContext`) |
