---
title: "Configuration"
path: "configuration"
summary: "A tour of the application-owned Byline files: which configuration belongs on the server, in the admin module graph, in isomorphic schemas, and behind the public client-safe facade."
---

# Configuration

Companions:
- [Configuration API reference](../10-api-reference/01-configuration.md) — every `BaseConfig`, `AdminConfig`, and `ServerConfig` property, including defaults and runtime requirements.
- [Collections](../04-collections/index.md) — how the collection tuple divides each content type into an isomorphic schema and an admin presentation config.
- [Core composition](../03-architecture/02-core-composition.md) — how `initBylineCore()` validates and composes the server-side adapters registered here.
- [Admin-config registration](../09-admin-ui/02-admin-config-registration.md) — why the admin config is registered from both the eager and lazy `_byline` route graphs.

Byline configuration is application-owned code that tells the CMS what content exists, how editors work with it, and which server implementations provide storage, authentication, search, and rich text. In the reference application, these files live under `apps/webapp/byline`.

This split is slightly more involved than a single monolithic configuration file, but it gives each runtime a focused, type-checked surface and keeps server-only and admin-only dependencies out of the wrong bundles.

The important rule is that this directory crosses four different runtime boundaries. A value that belongs in one boundary can break builds, leak server code, or make scripts unusable when it is imported from another.

## Configuration boundaries

| Boundary | What belongs there | What must stay out |
|---|---|---|
| Isomorphic schema | Plain collection and field definitions, serializable adapter settings, isomorphic-safe functions | React, CSS modules, Node-only modules, browser globals |
| Server bootstrap | Database, storage, sessions, search, server-only hooks, rich-text server adapters | React components and admin presentation |
| Admin module graph | Collection presentation, field widgets, block presentation, editor components | Database adapters, secrets, Node-only modules |
| Public client facade | Locale and route data needed by the host frontend | Admin translations, editor code, server configuration |

The same collection schemas are imported by the server bootstrap and the browser admin. They are therefore **isomorphic**, not merely server-safe: every reachable schema import must work in both environments.

## Files at a glance

### Files you normally edit

| File or directory | Boundary | Purpose |
|---|---|---|
| `collections/<name>/schema.ts` | Isomorphic schema | Defines one collection's fields, workflow, search projection, paths, hooks, and structural options. |
| `collections/<name>/admin.tsx` | Admin module graph | Defines columns, layouts, preview URLs, custom list views, and per-field UI overrides for that collection. |
| `collections/index.ts` | Isomorphic schema | Exports the single canonical collection tuple consumed by code generation, the server, and the admin. |
| `collections/server-hooks.ts` | Server bootstrap | Registers collection and upload hooks whose modules import server-only code. |
| `blocks/*.ts` | Isomorphic schema | Defines reusable block schemas. |
| `blocks/*.admin.tsx` | Admin module graph | Defines block-scoped field presentation. |
| `server.config.ts` | Server bootstrap | Calls `initBylineCore()` with the database, storage, admin store, session provider, search provider, server hooks, and rich-text server adapters. |
| `admin.config.ts` | Admin module graph | Calls `defineAdminConfig()` with collection admin configs, block admin configs, field editors, routes, and i18n. |
| `locales.ts` | Public client safe | Declares the host's admin-interface and content locale sets as dependency-free data. |
| `i18n.ts` | Shared configuration | Assembles locale sets and admin translation bundles for the server and admin configs. Do not import it into public browser code. |
| `routes.ts` | Public client safe | Resolves the admin, API, and sign-in mount paths once for both configs and the host frontend. |
| `public.ts` | Public client safe | Re-exports the small set of Byline route and locale values that public host code may import. |

### Tooling and contract files

| File or directory | Purpose |
|---|---|
| `load-env.ts` | Loads `.env.local` and `.env` for Node scripts that do not run through Vite. Import it before `server.config.ts`. |
| `seed.ts`, `seed-admin.ts`, `seed-docs.ts` | Initialize the server config and run application-owned seed routines. They are operational entry points, not configuration APIs. |
| `seeds/` | Contains the reusable seed implementations invoked by the entry points. |
| `scripts/` | Contains code generation, documentation import, and maintenance commands. |
| `collection-types.contract.ts` | Proves at compile time that generated collection types exactly match the canonical collection tuple. |
| `registered-client-types.test.node.ts` | Verifies that generated declaration merging types the unparameterized client and server client getters. |
| `async-hooks.browser.ts` | Supplies the browser no-op used by the Vite alias for `node:async_hooks`. Application configuration does not import it directly. |
| `generated/collection-types.ts` | Generated collection type projection. Run `pnpm byline:generate`; never edit it by hand. |

## How configuration loads

### Server startup

`apps/webapp/src/server.ts` imports `byline/server.config.ts` as a side effect. The module constructs the selected adapters, calls `initBylineCore()`, and waits for configuration validation and collection reconciliation before the server handles requests.

```text
src/server.ts
  -> byline/server.config.ts
       -> collections/index.ts
       -> collections/server-hooks.ts
       -> i18n.ts + routes.ts
       -> database / storage / auth / search adapters
       -> initBylineCore()
```

Node scripts use the same bootstrap after loading environment variables:

```ts
import './load-env.js'
import './server.config.js'

import { getSystemBylineClient } from '@byline/client/server'

const client = getSystemBylineClient()
```

`initBylineCore()` is asynchronous. The scaffolded `server.config.ts` uses top-level `await`, so any module that imports it continues only after the core has initialized.

### Admin registration

`admin.config.ts` is not imported by the public application root. The `_byline` route loads it from two complementary locations:

- `route.tsx` dynamically imports it from `beforeLoad`, which protects child loaders.
- `route.lazy.tsx` imports it for initial hydration and component rendering.

Both paths call `defineAdminConfig()` against their own Vite module graph. Keeping those imports under `_byline/*` prevents admin and editor code from entering public bundles.

### Public application code

Public browser code imports `byline/public.ts`, not `admin.config.ts`, `server.config.ts`, or `i18n.ts`:

```ts
import { contentLocales, routes } from '../../byline/public.js'

const docsUrl = `${routes.admin}/collections/docs`
const supportedContentLocales = contentLocales.map((locale) => locale.code)
```

The facade is intentionally small. Add a public export only when the public host genuinely needs the value and its complete import graph is safe for the browser.

## Configure the server

The reference server config composes one installation-wide runtime:

```ts
const core = await initBylineCore<AdminStore>({
  i18n,
  routes,
  collections,
  hooks: serverHooks,
  db,
  adminStore,
  storage: localStorageProvider({ uploadDir: './uploads', baseUrl: '/uploads' }),
  sessionProvider,
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

`initBylineCore()` validates the combined configuration before it registers the replacement singleton. For example, search-enabled collections require a search provider, relation-bearing rich-text modes require their matching server adapters, and every configured admin locale requires translations.

The complete property contract is in the [Configuration API reference](../10-api-reference/01-configuration.md#serverconfig).

## Configure the admin

The admin config registers presentation and browser-side adapters over the same schema tuple:

```ts
export const config: AdminConfig = {
  i18n,
  routes,
  collections,
  admin: [DocsAdmin, NewsAdmin, PagesAdmin, MediaAdmin, NewsCategoriesAdmin],
  blockAdmin: [QuoteBlockAdmin, PhotoBlockAdmin, FAQBlockAdmin],
  fields: {
    richText: { editor: LexicalRichTextAi },
  },
}

defineAdminConfig(config)
```

The server and admin configs share `i18n`, `routes`, and `collections`. They do not extend each other: server-only adapters belong only on `ServerConfig`, while React-bearing presentation belongs only on `AdminConfig`. The host application's public configuration owns its canonical site origin; Byline configuration does not duplicate it.

The complete property contract is in the [Configuration API reference](../10-api-reference/01-configuration.md#adminconfig).

### Configure the sign-in Home link

The scaffolded sign-in route needs no site-origin configuration for an
integrated host. `createSignInRoute()` defaults its Home link to `/`, so a
signed-out editor can return to the public root:

```ts
import { createSignInRoute } from '@byline/host-tanstack-start/routes'

export const Route = createSignInRoute('/_byline/sign-in')
```

Pass a client-safe `homeUrl` when the public home is not the current origin, or
when the host wants the link to use its canonical absolute URL:

```ts
export const Route = createSignInRoute('/_byline/sign-in', {
  homeUrl: getPublicConfig().serverUrl,
})
```

These values have separate ownership. `/` is Byline's same-origin navigation
default. The canonical site origin belongs to the host's public configuration
because metadata, sitemaps, feeds, and exports consume it. A future remote SDK
will require a separate transport `baseURL` or `apiURL`. An absolute `homeUrl`
only changes navigation; it does not transfer host-only admin or preview
cookies to another origin.

## Add a collection

Create the schema first and keep it isomorphic:

```ts
// apps/webapp/byline/collections/articles/schema.ts
import { defineCollection } from '@byline/core'

export const Articles = defineCollection({
  path: 'articles',
  labels: { singular: 'Article', plural: 'Articles' },
  useAsTitle: 'title',
  useAsPath: 'title',
  fields: [
    { name: 'title', type: 'text', localized: true },
    { name: 'content', type: 'richText', localized: true },
  ],
})
```

Then add the admin presentation:

```ts
// apps/webapp/byline/collections/articles/admin.tsx
import { defineAdmin } from '@byline/core'

import { Articles } from './schema.js'

export const ArticlesAdmin = defineAdmin(Articles, {
  columns: [
    { fieldName: 'title', label: 'Title', sortable: true },
    { fieldName: 'status', label: 'Status' },
  ],
  layout: { main: ['title', 'content'] },
})
```

Finally, add `Articles` to `collections/index.ts` and `ArticlesAdmin` to the `admin` array in `admin.config.ts`. Run `pnpm byline:generate` after changing the schema, and commit the generated type projection.

The [Collections API reference](../10-api-reference/02-collections.md) lists every collection and admin property. The [Fields API reference](../10-api-reference/03-fields.md) lists every built-in field type.

## Common boundary mistakes

### Importing admin config from a frontend route

This pulls admin collection presentation, React components, and editor extensions into the frontend public graph (your website). You can safely import route and locale data, if needed - from `byline/public.ts` instead.

### Importing server-only code from a schema

The schema also enters the browser admin bundle. Register hooks that depend on Node, secrets, server clients, or backend SDKs through `collections/server-hooks.ts` and `ServerConfig.hooks`.

### Importing `i18n.ts` from public browser code

`i18n.ts` assembles admin translation bundles. Public code should import the dependency-free locale arrays through `public.ts`.

### Changing only `routes.ts`

The route config changes the canonical URLs consumed by Byline; it does not rename the host application's physical TanStack route files. Use the CLI setup flow when moving an existing admin or sign-in mount so both sides stay synchronized.

## Next

Use the [Configuration API reference](../10-api-reference/01-configuration.md) when you need an exact property or function signature. Continue to [Collections](../04-collections/index.md) when you are ready to model a content type, or to the [Client SDK](../05-reading-and-delivery/01-client-sdk.md) when you are ready to query it.
