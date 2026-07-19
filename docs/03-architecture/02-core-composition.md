---
title: "Core Composition"
path: "core-composition"
summary: "The seams Byline composes at boot: the database, storage, session, and search adapters, the field-level server slots, the initBylineCore() entry point, and the rules that keep those boundaries stable."
---

# Core Composition

Companions:
- [Client Config Registration](../08-admin-ui/02-client-config-registration.md) — the client-side analogue of `initBylineCore()`, and why the admin config registers the way it does.
- [Transactions](./03-transactions.md) — the atomicity guarantees the database adapter must supply, and what the contract requires of a new adapter.
- [Rich Text](../04-collections/07-rich-text.md) — the reference consumer of the field-level adapter slots described here.
- [Authentication & Authorization](../06-auth-and-security/01-authn-authz.md) — where document-collection enforcement happens, which is deliberately not through the command wrapper described here.

## Overview

Byline is a framework rather than a single application, so the way its packages plug together is part of its public surface. This document describes the **seams** — the points where you supply an implementation and Byline composes it at boot — and the rules that keep those seams stable across versions.

Read it if you are wiring Byline into an application, writing an adapter (a database, storage provider, session provider, search driver, or rich-text editor), or trying to understand why `@byline/core` does not import any of the packages that provide those things.

### What composes

Everything you plug in arrives through one call, `initBylineCore()`, in your application's `byline/server.config.ts`:

| Seam | Config key | Contract | Shipped implementations |
|---|---|---|---|
| Database | `db` | `IDbAdapter` | `@byline/db-postgres` |
| File storage | `storage` | `IStorageProvider` | `@byline/storage-local`, `@byline/storage-s3` |
| Sessions | `sessionProvider` | `SessionProvider` | built-in JWT provider in `@byline/admin` |
| Search | `search` | `SearchProvider` | `@byline/search-postgres` |
| Rich text (server) | `fields.richText` | four function slots | `@byline/richtext-lexical/server` |
| Admin store | `adminStore` | `AdminStore` aggregate | `@byline/db-postgres/admin` |
| Lifecycle hooks | `hooks` | `CollectionHooks`, `UploadHooks` | your application |

`@byline/core` declares every one of these as an interface and imports none of the packages that implement them. That is what makes swapping an adapter a single-file change.

## Registering your adapters

`initBylineCore()` is async, composes the dependency graph, validates it, and returns a `BylineCore`. Your `server.config.ts` calls it once and registers the result on the process global; server-side callers then retrieve it with `getBylineCore<AdminStore>()`.

```ts
// apps/webapp/byline/server.config.ts
import { type BylineCore, initBylineCore } from '@byline/core'
import { localStorageProvider } from '@byline/storage-local'
import { postgresSearch } from '@byline/search-postgres'
import {
  lexicalEditorEmbedServer,
  lexicalEditorPopulateServer,
  lexicalEditorToMarkdownServer,
  lexicalEditorToTextServer,
} from '@byline/richtext-lexical/server'

const core = await initBylineCore<AdminStore>({
  serverURL,
  i18n,
  routes,
  collections,
  hooks: serverHooks,
  db,
  adminStore,
  storage: localStorageProvider({ uploadDir: './uploads', baseUrl: '/uploads' }),
  fields: {
    richText: {
      embed: lexicalEditorEmbedServer({ getClient: getAdminBylineClient }),
      populate: lexicalEditorPopulateServer({ getClient: getAdminBylineClient }),
      toMarkdown: lexicalEditorToMarkdownServer(),
      toText: lexicalEditorToTextServer(),
    },
  },
  search: postgresSearch({ pool: db.pool, defaultLocale: i18n.content.defaultLocale }),
})
```

**Composition validates before it does any database work.** `initBylineCore()` fails fast at boot rather than at request time when your configuration is unsatisfiable:

- A collection with a `richText` field set to populate or embed on save, but no matching adapter slot registered.
- A collection that opts into `search`, but no `SearchProvider` registered — indexing would otherwise silently no-op.
- A rich-text field with both relation flags off, which cannot render.
- Missing or incomplete admin interface translation bundles.

Collection abilities are registered automatically. Admin-subsystem abilities are opt-in — you call `registerAdminAbilities(core.abilities)` yourself — so that `@byline/core` never has to depend on `@byline/admin`.

## Field-level adapter slots

A field type that needs both a browser component and server-side behaviour registers them through mirrored slots: `ClientConfig.fields.*` for the React side, `ServerConfig.fields.*` for the server side. Rich text is the reference implementation, and any future field-level adapter should follow its shape.

- **Client** — `ClientConfig.fields.richText.editor`: a render-only React component, registered via `lexicalEditor()` from `@byline/richtext-lexical`.
- **Server, write path** — `fields.richText.embed` (`RichTextEmbedFn`): called once per rich-text leaf the write path finds in an outgoing document, for every field whose effective `embedRelationsOnSave` is true (the default). It walks the editor tree at save time and refreshes embedded relation envelopes — for example composing `document.path` on internal-link nodes.
- **Server, read path** — `fields.richText.populate` (`RichTextPopulateFn`): the mirror of `embed`, called once per rich-text leaf the read pipeline returns, for every field whose effective `populateRelationsOnRead` is true.
- **Server, markdown** — `fields.richText.toMarkdown` (`RichTextToMarkdownFn`): one-way serialisation for the agent-readable export surface (`documentToMarkdown`, `.md` routes, `llms.txt`). Optional; synchronous and read-only.
- **Server, plain text** — `fields.richText.toText` (`RichTextToTextFn`): flattens a rich-text value to indexable plain text for `buildSearchDocument`. Required when any collection's `search.body` includes a rich-text field.

Three properties of this design constrain any adapter you write against it:

1. **Ship two entry points.** A package with both client and server pieces splits them by subpath so consumers of one do not bundle the other. `@byline/richtext-lexical` and `@byline/richtext-lexical/server` are the reference example.
2. **The framework owns the walk.** Your adapter receives one leaf at a time with its context — `value`, `fieldPath`, `collectionPath`, `readContext`, `requestContext`, `readMode`, and `readDocuments`. It does not walk the containing document or fetch target documents itself. `collectRichTextLeaves` and `createRichTextDocumentReader` keep adapters inside the same read pipeline as ordinary SDK reads.
3. **Security travels with the capability.** The `readDocuments` function you are handed asserts the target collection's `read` ability, applies its `beforeRead` predicate, uses the operation's effective source view, and runs the target's `afterRead` hooks. Reaching around it to `IDbAdapter` directly would create a second, weaker read boundary — so don't.

## The database adapter contract

The 4.x `IDbAdapter` contract intentionally breaks adapters written against the older optional-capability shape. A conforming adapter must implement:

- `withTransaction` — see [Transactions](./03-transactions.md).
- `commands.audit` and `queries.audit`.
- `queries.documents.getDocumentSystemFieldsForUpdate` — the transaction-scoped lock and authoritative snapshot.
- `commands.documents.promoteChildrenAndRemoveFromTree` — delete-time tree reconciliation, alongside the ordinary tree placement and removal commands.

Auditability, locked system-field snapshots, and delete-time tree reconciliation are baseline storage semantics in 4.x, not collection-specific extras a typed adapter may omit.

Core also checks these methods **structurally at runtime**, because a plain JavaScript adapter can bypass TypeScript entirely. A missing transaction, audit, or system-field lock fails the attempted audited write with `ERR_AUDIT_UNSUPPORTED`. Tree-enabled configurations validate tree audit and delete-reconciliation support at startup and check again on tree writes. The system activity endpoint throws `ERR_AUDIT_UNSUPPORTED`, and the collection SDK's gated `auditLog()` returns an empty page when an untyped adapter supplies no `queries.audit`. These guards contain failures from invalid runtime objects; they are not an optional tier of the contract.

## Architectural guard rails

Three rules hold the boundaries in place. They are the reason the seams above stay swappable, and they apply to contributions as much as to adapters.

1. **Feature wiring lives in feature packages, not in `@byline/core`.** Byline composes; it does not own. A feature package ships its own composition factory and the integrating application wires it in. Core provides the `Registry` primitive and the `initBylineCore()` composition point, and imports no feature package.
2. **Auth keys, not auth realms.** Commands take an ability expression, never an enumerated mode. The `AbilityRegistry` is the source of truth, and collections and plugins contribute their abilities at registration time, so the enforcement layer stays open to whatever they declare.
3. **The adapter boundary is permanent.** `IDbAdapter`, `IStorageProvider`, `SessionProvider`, and `SearchProvider` are contracts. Feature code consumes them through the interface and never wires concrete dependencies — Drizzle pools, argon2, S3 clients — directly. This is what keeps "swap the adapter" a single-file change in `byline/server.config.ts`. Transaction machinery lives behind this boundary too: the mechanism sits in `@byline/db-postgres` while core declares the contract and owns the lifecycle boundaries.

## Implementation notes

The two pieces below are internal machinery. You do not interact with them to use or extend Byline; they are documented because they shape how the code reads if you work on it.

### The registry

`Registry` and `AsyncRegistry` (`packages/core/src/lib/registry.ts`) are a small typed dependency-injection container whose dependency graph is validated at compile time by TypeScript conditional types. `initBylineCore()` builds one, adds config, collections, the database adapter, and storage as values, adds the logger as a factory, and composes. There is no service-locator lookup at runtime — composition happens once, at boot.

### `createCommand`

Every admin operation in `@byline/admin` is declared with `createCommand` (`packages/admin/src/lib/create-command.ts`), which folds four steps — validate input, authorise, invoke, shape output — into one specification:

```ts
export const listAdminUsersCommand = createCommand({
  method: 'listAdminUsers',
  auth: { ability: ADMIN_USERS_ABILITIES.read },
  schemas: { input: listAdminUsersRequestSchema, output: adminUserListResponseSchema },
  handler: ({ input, deps }) =>
    new AdminUsersService({ repo: deps.store.adminUsers }).listUsers(input),
})
```

The wrapper runs Zod input parse → admin actor resolution → handler → Zod output parse, in that order, and returns a `(context, input, deps) => Promise<Output>` function.

The `auth` slot is a discriminated union. `{ ability: 'admin.users.read' }` is a full gate, delegating to `assertAdminActor` and inheriting the super-admin bypass. `{ authenticated: true }` is an identity gate only, used by `admin-account` self-service commands where the security property is "you may only mutate your own row," enforced structurally by taking the target id from `actor.id`.

Document-collection operations — create, update, delete, status, upload — do **not** flow through `createCommand`. They are gated by `assertActorCanPerform` inside the `document-lifecycle` services in `@byline/core`. See [Authentication & Authorization](../06-auth-and-security/01-authn-authz.md).

## Code map

| Concern                              | Location                                                                |
|--------------------------------------|-------------------------------------------------------------------------|
| `initBylineCore` composition point   | `packages/core/src/core.ts`                                             |
| `ServerConfig` seam declarations     | `packages/core/src/@types/site-config.ts`                               |
| `IDbAdapter` contract                | `packages/core/src/@types/db-types.ts`                                  |
| `Registry` / `AsyncRegistry`         | `packages/core/src/lib/registry.ts`                                     |
| `createCommand` wrapper              | `packages/admin/src/lib/create-command.ts`                             |
| Admin module commands                | `packages/admin/src/modules/admin-{users,roles,permissions,account}/commands.ts` |
| `AdminStore` aggregate               | `packages/admin/src/store.ts`                                           |
| `assertAdminActor` enforcement       | `packages/admin/src/lib/assert-admin-actor.ts`                          |
| `assertActorCanPerform` enforcement  | `packages/core/src/auth/assert-actor-can-perform.ts`                    |
| Rich-text leaf walker + secure reader | `packages/core/src/services/richtext-populate.ts`                        |
| Rich-text adapter context contracts   | `packages/core/src/@types/field-types.ts`                                |
| `AbilityRegistry`                    | `packages/auth/src/abilities.ts`                                        |
| Admin request-context resolver       | `packages/client/src/server/admin-context.ts` (`getAdminRequestContext`, exported from `@byline/client/server`) |
</content>
