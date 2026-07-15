---
title: "Upgrading from 3.21 to 4.0"
path: "upgrading-to-v4"
summary: "Application migration guide for Byline 4.0: package alignment, route configuration, server-only lifecycle hooks, generated types, request contexts, and release validation."
---

# Upgrading from 3.21 to 4.0

Byline 4.0 hardens boundaries that a 3.21 application could accidentally cross:
server lifecycle code can no longer rely on a dynamic import inside an
isomorphic schema as a browser boundary, request-scoped reads bind to one stable
authority, and database adapters must provide the complete transaction and
audit contract.

For an application using the published Postgres and TanStack Start packages,
the main migration is application wiring. Existing documents and uploads do not
need to be rewritten. Byline 4.0.0 adds no Byline-owned database or search-index
schema migration over 3.21.0.

## Migration at a glance

1. Update every published `@byline/*` package to major 4 together.
2. Preview the v4 CLI's assessment, but review application-owned files manually.
3. Make route configuration explicit, including `routes.signIn`.
4. Move server-only collection and upload hooks into `ServerConfig.hooks`.
5. Install the TanStack Start client-bundle hook boundary.
6. Rename the app's typed client boundary to `clients.server.ts` and update imports.
7. Regenerate collection types and address type errors with generated types and
   operation-specific overlays.
8. Review request-context, tree, search, delete, and custom-adapter behavior.
9. Run static, integration, production-build, and focused end-to-end gates.

:::warning[Do not mix Byline majors]
Update all registry-backed `@byline/*` dependencies in one change. A mixture of
3.x and 4.x packages can duplicate core configuration state and combine
incompatible contracts. Local `workspace:*` Byline packages may keep that
specifier, but their manifests must themselves resolve to compatible v4
packages.
:::

## 1. Prepare the upgrade

Use a branch with a clean working tree. Back up the production database and the
upload store before deploying even though v4 does not require a data migration.
This keeps rollback independent of the application change.

From the application directory, ask the v4 CLI to report what it would change:

```sh
pnpm dlx @byline/cli@4 init --force --dry-run
```

The CLI recognizes generated 3.21 predecessors and can install missing
canonical files. It deliberately does not overwrite divergent Vite, route,
schema, or application configuration. Treat its output as an audit, not as proof
that a bespoke application is migrated. `byline setup` is not an upgrade
command; it only provisions and seeds a database for an already-wired app.

Change every published `@byline/*` dependency range to `^4.0.0`, then install
with the application's package manager. Keep the lockfile in the same commit as
the manifest changes.

## 2. Resolve routes once, including sign-in

`RoutesConfig` is now the resolved three-path shape: `admin`, `api`, and
`signIn`. Export a canonical client-safe value from `byline/routes.ts`:

```ts
import { resolveRoutes } from '@byline/core'

export const routes = resolveRoutes({
  admin: '/admin',
  api: '/api',
  signIn: '/sign-in',
})
```

Paths are root-relative and may contain multiple segments. They may not overlap:
the sign-in route must sit outside both the admin and API trees. Unsafe,
protocol-relative, encoded, query-bearing, or fragment-bearing configuration is
rejected at boot.

The physical TanStack route tree must match the configured paths. For custom or
nested mounts, use the CLI's route diff as the reference and regenerate
`src/routeTree.gen.ts` through TanStack Router; never edit that generated file
by hand.

Keep both client-config registration points under the pathless `_byline` route:

- `route.tsx` dynamically imports `byline/admin.config` from `beforeLoad`, so
  child loaders have config during SSR and navigation.
- `route.lazy.tsx` imports `byline/admin.config` for initial hydration and
  component rendering.

Legacy `signInPath` route-factory input and `SignInForm.callbackUrl` remain as
deprecated compatibility paths. New code should read `routes.signIn` and pass
the validated `redirectTo` form prop. Redirects are now limited to safe
root-relative destinations inside the configured admin tree.

## 3. Move server-only lifecycle hooks out of schemas

A collection schema is isomorphic: the server bootstrap, type generator, admin
configuration, and browser build can all reach it. In 3.21, applications often
used this shape:

```ts
export const Articles = defineCollection({
  path: 'articles',
  hooks: () => import('./hooks.js'),
  // …
})
```

A dynamic import creates a lazy chunk; it does not make that chunk server-only.
Remove definition-attached collection or upload hook loaders whenever their
implementation imports Node APIs, caches, search clients, storage SDKs, secrets,
or other server-only application code.

Create one server-only registry. Registry imports may follow any application
directory layout:

```ts
// byline/collections/server-hooks.ts
import type { ServerHooksConfig } from '@byline/core'

export const serverHooks = {
  collections: {
    articles: () => import('./content-types/articles/hooks.js'),
    categories: () => import('./taxonomies/categories/hooks.js'),
  },
  uploads: {
    'media.image': () => import('./uploads/media/hooks.js'),
    'publications.cover': () =>
      import('./content-types/publications/cover-hooks.js'),
    'publications.files.filesGroup.publicationFile': () =>
      import('./content-types/publications/file-hooks.js'),
  },
} satisfies ServerHooksConfig
```

Import it only from the server bootstrap and pass it to core:

```ts
// byline/server.config.ts
import { serverHooks } from './collections/server-hooks.js'

const core = await initBylineCore({
  // …serverURL, i18n, routes, collections, db, adapters…
  hooks: serverHooks,
})
```

Then remove the corresponding `hooks` property from each collection definition
and upload block. A registry entry cannot replace a definition-authored hook;
leaving both in place fails at boot instead of choosing one silently.

### Upload registry keys

Upload keys are
`<collection path>.<canonical schema field path>`. They describe the schema,
not a particular form instance:

- Arrays and groups contribute their field names, but runtime indexes do not:
  `publications.files.filesGroup.publicationFile` matches
  `files[2].filesGroup.publicationFile`.
- A blocks field is followed by the block type:
  `pages.content.hero.backgroundImage`.
- Collection paths, field names, and block types must be non-empty and
  dot-free.
- Upload-capable leaf names must be unique within one collection. This retains
  the current upload transport's unambiguous leaf selector even when fields are
  nested.
- Unknown collections, paths ending at non-upload fields, and incorrect block
  segments fail during initialization.

Inline field validation/change hooks such as `beforeValidate` and
`beforeChange` belong on the schema and may remain there. Definition-attached
collection or upload hooks may also remain when their complete import graph is
genuinely isomorphic-safe. Prefer the registry for post-commit cache, search,
webhook, and file-processing work.

See [Collections → Server-only hook registry](../04-collections/index.md#server-only-hook-registry)
for composition and side-effect failure patterns.

## 4. Add the production client-bundle boundary

TanStack Start applications should install the v4 host plugin in
`vite.config.ts`:

```ts
import { bylineClientHookBoundary } from '@byline/host-tanstack-start/vite'

export default defineConfig({
  plugins: [
    // …application plugins…
    bylineClientHookBoundary(),
    tanstackStart(),
    viteReact(),
  ],
})
```

The plugin inspects the emitted client bundle and fails a production build when
server lifecycle modules under `byline/collections` are reachable. It supports
nested collection directories and the `hooks.ts` / `*-hooks.ts` conventions,
plus shared lifecycle and side-effect modules. Keep server hook implementations
under `byline/collections` and follow those names so the boundary can classify
them.

This gate complements source-graph tests: a production optimizer can remove an
accidental import that a development server would still evaluate. Applications
with stricter architecture tests should also assert that `collections/index.ts`
and `byline/public.ts` cannot statically reach the registry, typed server
clients, hook modules, or server cache implementations.

## 5. Rename the typed server-client boundary

The canonical app-owned file is now `byline/clients.server.ts`. The plural name
reflects that it types and re-exports four host-owned clients: admin, public,
system, and viewer.

Rename the 3.21 file and update every app import:

```text
byline/client.server.ts  →  byline/clients.server.ts
```

For example:

```ts
import { getViewerBylineClient } from '~/clients.server'
import { getSystemBylineClient } from '../../clients.server.js'
```

The rename is an application-scaffold clarification, not a new runtime client.
The file remains the single app-owned type assertion joining the host's runtime
client getters to `BylineCollections`; browser modules must not import it.

## 6. Regenerate and consume canonical collection types

Run the generator after the schema and registry edits:

```sh
pnpm byline:generate
pnpm byline:generate:check
```

Commit `byline/generated/collection-types.ts`. Keep
`byline/collection-types.contract.ts` in the TypeScript project; it proves that
the generated ordinary and all-locale field maps still exactly match the
runtime collection tuple.

Application read contracts should import canonical fields and blocks from the
generated file. Direct `CollectionFieldData<typeof Schema>` aliases remain
useful inside schema-local helpers, but should not become a second app-wide type
source.

Registry-backed clients infer the ordinary generated field shape:

```ts
const result = await getPublicBylineClient().collection('news').find()
```

Use a generic only when the operation changes that shape. A selective read can
use `Pick`; populated relations use `WithPopulated` or `WithPopulatedMany`:

```ts
import type { WithPopulated } from '@byline/client'
import type { MediaFields, NewsFields } from '~/generated/collection-types.js'

type NewsCardFields = WithPopulated<
  Pick<NewsFields, 'title' | 'summary' | 'featureImage'>,
  'featureImage',
  MediaFields
>

const result = await client.collection('news').find<NewsCardFields>({
  select: ['title', 'summary', 'featureImage'],
  populate: { featureImage: '*' },
})
```

Do not hand-edit generated types to silence a migration error. Fix the schema,
the operation overlay, or the collection tuple and regenerate.

## 7. Review request-scoped read contexts

The v4 read pipeline binds a shared `ReadContext` to one immutable request
authority. This prevents authorization predicates, embargo cutoffs, preview
state, and recursion state from leaking across actors or requests.

The TanStack host's admin, public, and viewer client factories now resolve one
stable `RequestContext` per HTTP request. Applications using those factories do
not need extra memoization.

Custom hosts and direct `createBylineClient` factories must satisfy the same
contract: every resolution within one logical request returns the same context
instance and `requestId`. A factory that creates a new request context on each
call will fail when two reads share a `ReadContext`:

```text
ReadContext cannot be reused across request authorities
```

Inside `beforeRead` or `afterRead`, pass `ctx.readContext` verbatim to a nested
client read as `_readContext`. Never create a replacement to avoid recursion
guards, and never reuse a context across top-level HTTP requests. The old public
`readContext.beforeReadCache` property is deprecated and ignored for security;
do not inspect or mutate it.

`beforeRead` predicates are now compiled in strict security mode. Invalid or
unsupported predicates fail closed. Return `undefined` for no additional
scoping, or `{ id: { $in: [] } }` when the actor should see no rows.

## 8. Review changed runtime behavior

These changes usually require test updates rather than application wiring:

- **Tree reads:** status and `beforeRead` visibility are enforced at each edge.
  A hidden or unpublished ancestor stops traversal instead of compacting a
  visible descendant past it. Tree hydration shares one read context across the
  operation.
- **Tree mutations:** exact no-op place/remove calls do not emit another
  `afterTreeChange`. Pass `{ reconcile: true }` only when deliberately retrying
  an idempotent post-commit side effect.
- **Document delete:** the database delete, audit rows, and tree child promotion
  commit atomically. Post-commit storage or hook failures are reported as a
  committed result with side-effect failures rather than pretending the delete
  rolled back.
- **Authorized search:** when ability or row-level scoping removes provider
  results, `total` is the authorized count for the returned page and facets are
  omitted rather than leaking provider-wide aggregates.
- **Admin item presentation:** `CollectionAdminConfig.itemView` is the new name
  for `picker`. The `picker` alias still works in v4 but is deprecated; rename it
  while touching collection admin configs.
- **Redirects:** sign-in callbacks are normalized and constrained to the
  configured admin tree. Tests that expected an external or protocol-relative
  callback to survive must now expect the safe admin fallback.

If lifecycle hooks start independent cache invalidation and search
reconciliation, native `Promise.all` remains the simplest pattern. It starts
both effects but reports only the first rejection. Use the advanced
`Promise.allSettled` aggregation pattern in the collections documentation only
when operators need every simultaneous failure reported.

## 9. Custom database adapters and hosts

Applications using `@byline/db-postgres` receive the new adapter behavior by
updating the package. A custom `IDbAdapter` must implement the complete v4
accountability contract:

- `withTransaction`
- `commands.audit` and `queries.audit`
- transaction-scoped `getDocumentSystemFieldsForUpdate`
- the updated tree mutation return values and collection identifiers
- `promoteChildrenAndRemoveFromTree`

These are required capabilities, not optional feature negotiation. See
[Transactions](../03-architecture/03-transactions.md) for the contract and
atomicity requirements.

A non-TanStack host must also provide request-stable `RequestContext`
resolution and its own equivalent client/server module boundary. The
`ServerConfig.hooks` registry itself is framework-independent.

## 10. Validate before deployment

Run the application's equivalent of these gates from its workspace root:

```sh
pnpm byline:generate:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Then rerun the CLI as a read-only installation audit:

```sh
cd apps/webapp
pnpm dlx @byline/cli@4 doctor
pnpm dlx @byline/cli@4 init --force --dry-run
```

`doctor` reports structural phase state; it does not replace the build or
application tests. Review any CLI note about a divergent file manually.

At minimum, exercise these end-to-end paths against a production-like database
and storage provider:

- hard-load the admin dashboard and every collection list;
- hard-load a tree collection, move/reorder a node, and verify its public
  hierarchical route;
- sign out, request a protected admin URL, sign in, and verify the callback;
- load public pages anonymously and with admin preview enabled;
- create, edit, publish, unpublish, and delete one representative document;
- verify cache invalidation and search reconciliation after each relevant
  lifecycle event;
- upload a top-level field and every distinct nested upload shape, including an
  array/group field, then save and reload the document;
- inspect server logs and the browser console for hook-boundary, request-context,
  authorization, and hydration errors.

The production build is a required migration gate: it is what proves that no
server lifecycle module entered the emitted browser bundle.

## Rollback

Deploy the v4 package set and matching application wiring as one release. Since
4.0.0 adds no database schema migration over 3.21.0, rollback is normally the
inverse application deployment: restore the previous lockfile/build and its
3.21 configuration together. Restore database or object-store backups only if
the application itself performed unrelated data changes during the deployment.

