---
title: "Configuration API"
path: "configuration-reference"
summary: "Exact BaseConfig, AdminConfig, ServerConfig, BylineCore, document-resource registry, database error classification, getter, and server-client contracts."
---

# Configuration API

Companions:
- [Configuration](../01-getting-started/03-configuration.md) — which application files own these objects and which runtime imports each one.
- [Collections API](./02-collections.md) — the collection tuple and the server/client presentation registries configured here.
- [Core composition](../03-architecture/02-core-composition.md) — initialization order, validation, adapters, and package boundaries.
- [Admin-config registration](../09-admin-ui/02-admin-config-registration.md) — the dual admin registration path used by the TanStack Start host.

This is the exact application-facing configuration surface from `@byline/core` and the request-bound client getter surface from `@byline/client/server`. Use it when wiring `byline/server.config.ts`, `byline/admin.config.ts`, or server-side application reads.

## `BaseConfig`

`BaseConfig` contains the configuration shared by the server and admin. The server and admin configs extend it independently.

```ts
interface BaseConfig {
  i18n: I18nConfig
  collections: readonly CollectionDefinition[]
  routes?: RoutesConfigInput
}
```

| Property | Required | Description |
|---|---|---|
| `i18n` | Yes | Admin-interface locales, content locales, display labels, and admin translation bundles. |
| `collections` | Yes | Canonical readonly document-resource tuple containing `MultiCollectionDefinition` and `SingletonDefinition` values. Collections and singletons share this registry and path namespace; the server and admin must receive the same definitions. |
| `routes` | No | Partial admin, API, and sign-in mount paths. `resolveRoutes()` supplies and validates defaults. |

### `i18n`

```ts
interface I18nConfig {
  admin: {
    defaultLocale: string
    locales: string[]
    localeDefinitions?: ReadonlyArray<{ code: string; nativeName: string }>
  }
  content: {
    defaultLocale: string
    locales: string[]
    localeDefinitions?: ReadonlyArray<{ code: string; nativeName: string }>
  }
  translations?: TranslationBundleShape
}
```

| Property | Required | Description |
|---|---|---|
| `admin.defaultLocale` | Yes | Fallback locale for the admin interface. It must be present in `admin.locales` when that list is non-empty. |
| `admin.locales` | Yes | Permitted admin-interface locale codes. Every declared code requires at least one registered translation namespace. |
| `admin.localeDefinitions` | No | Display labels used by the admin language switcher. Missing codes fall back through `Intl.DisplayNames`, then the raw code. |
| `content.defaultLocale` | Yes | Source locale assigned to newly created documents and the default locale for reads that do not specify one. Existing documents retain their own `sourceLocale`. |
| `content.locales` | Yes | Content locales the installation can author and serve. |
| `content.localeDefinitions` | No | Host-authored display labels for public content-language affordances. Byline stores and exposes them but does not render them itself. |
| `translations` | Conditional | Locale → namespace → key → ICU message string. Required at boot when `admin.locales` is non-empty. |

The complete behavioral model is in [Internationalization](../08-internationalization/index.md).

### `RoutesConfigInput`

```ts
interface RoutesConfigInput {
  admin?: string
  api?: string
  signIn?: string
}
```

| Property | Default | Description |
|---|---|---|
| `admin` | `/admin` | Root of the Byline admin route tree. |
| `api` | `/api` | Root reserved for Byline API-facing routes. |
| `signIn` | `/sign-in` | Sign-in route outside both the admin and API trees. |

`resolveRoutes(input?)` normalizes repeated and missing slashes, rejects query/hash/encoded/unsafe paths, rejects `.` and `..` segments, requires non-overlapping route trees, and returns a frozen `RoutesConfig` with all three keys.

```ts
import { resolveRoutes } from '@byline/core'

export const routes = resolveRoutes({
  admin: '/cms',
  api: '/api',
  signIn: '/cms-sign-in',
})
```

Changing this object does not rename the physical host route files. [Routing and API](../05-reading-and-delivery/02-routing-and-api.md) documents that coordination boundary.

### `createSignInRoute(path, options?)`

The TanStack Start host adapter exposes the sign-in route factory from
`@byline/host-tanstack-start/routes`:

```ts
interface CreateSignInRouteOptions {
  homeUrl?: string
}

function createSignInRoute(
  path: string,
  options?: CreateSignInRouteOptions
): Route
```

| Option | Default | Description |
|---|---|---|
| `homeUrl` | `/` | Client-safe destination for the sign-in form's Home link. Use the default for an integrated same-origin host. Pass an absolute host-owned URL when navigation must target another origin. |

The route preserves and validates the `callbackUrl` search parameter used to
return a newly authenticated editor to the requested admin page. `homeUrl` is
independent of that redirect and is not part of `BaseConfig`, `AdminConfig`, or
`ServerConfig`. An absolute value changes only the Home destination; it does
not transfer Byline's host-only session or preview cookies across origins.

## `AdminConfig`

`AdminConfig` extends `BaseConfig` with admin presentation and browser-side adapter slots. It may contain React component references and must remain outside public route bundles.

```ts
interface AdminConfig extends BaseConfig {
  admin?: AdminResourceConfig[]
  collectionGroups?: CollectionGroupDefinition[]
  blockAdmin?: BlockAdminConfig[]
  slugifier?: SlugifierFn
  fields?: {
    richText?: { editor: RichTextEditorComponent }
  }
}

type AdminResourceConfig<T = any> =
  | CollectionAdminConfig<T>
  | SingletonAdminConfig<T>
```

| Property | Default | Description |
|---|---|---|
| `admin` | `[]` | `CollectionAdminConfig` and `SingletonAdminConfig` values registered by `defineAdmin()` or `defineSingletonAdmin()`. Each `slug` and `singleton` discriminant must match its definition. |
| `collectionGroups` | `[]` | Ordered registry of dashboard resource groups, each `{ name, label }`. Array order is display order. Either admin-config kind joins a group through `group`. Omit for a flat dashboard. |
| `blockAdmin` | `[]` | Site-wide block presentation configs registered by `defineBlockAdmin()`, keyed by `blockType`. |
| `slugifier` | `slugify` | Client copy used by the admin path widget for live previews. Register the same pure synchronous function on `ServerConfig.slugifier`. |
| `fields.richText.editor` | None | React editor component used for rich-text fields unless a per-field admin config overrides it. Rich-text fields in the admin require a registered editor. |

```ts
import { type AdminConfig, defineAdminConfig } from '@byline/core'

export const config: AdminConfig = {
  i18n,
  routes,
  collections,
  admin: [DocsAdmin, NewsAdmin, PagesAdmin],
  collectionGroups: [{ name: 'media', label: 'Media' }],
  blockAdmin: [QuoteBlockAdmin, PhotoBlockAdmin],
  fields: { richText: { editor: LexicalRichTextAi } },
}

defineAdminConfig(config)
```

### `defineAdminConfig(config)`

```ts
function defineAdminConfig(config: AdminConfig): ResolvedAdminConfig
```

Validates collection, collection-admin, and block-admin registrations; resolves `routes`; registers the admin singleton in the current module graph; and returns the resolved object.

### `getAdminConfig()`

```ts
function getAdminConfig(): ResolvedAdminConfig
```

Returns the registered admin config. During server-side rendering, if only a server config is available, it returns a compatible fallback containing shared i18n, routes, collections, and the server slugifier, plus `admin: []`. It throws when neither config exists.

## `ServerConfig`

`ServerConfig<TAdminStore>` extends `BaseConfig` with server-only implementations. `initBylineCore()` is the normal registration entry point.

```ts
interface ServerConfig<TAdminStore = unknown> extends BaseConfig {
  db: IDbAdapter
  hooks?: ServerHooksConfig
  storage?: IStorageProvider
  slugifier?: SlugifierFn
  uploads?: { filenameSlugifier?: FilenameSlugifierFn }
  sessionProvider?: SessionProvider
  adminStore?: TAdminStore
  fields?: {
    richText?: {
      populate?: RichTextPopulateFn
      embed?: RichTextEmbedFn
      toMarkdown?: RichTextToMarkdownFn
      toText?: RichTextToTextFn
    }
  }
  search?: SearchProvider
  scheduledPublication?: { enabled: boolean }
  recurringTasks?: readonly RecurringTaskDefinition[]
}
```

| Property | Requirement or default | Description |
|---|---|---|
| `db` | Required | Database adapter implementing typed storage, transactions, audit operations, collection bootstrap, and tree operations when used. |
| `hooks` | Optional | Server-only collection and upload hook registry attached after configuration validation. |
| `storage` | Conditional | Installation-wide upload storage fallback. Required when an upload field has no `upload.storage` override. |
| `slugifier` | `slugify` | Authoritative document-path slugifier. Must be pure, synchronous, and identical to the client copy when customized. |
| `uploads.filenameSlugifier` | `slugifyFilename` | Server-only transformation for the human-readable base name of every uploaded file before hooks and provider key composition. |
| `sessionProvider` | Optional in the type | Authentication session implementation. Admin sign-in, refresh, verification, and revocation require one. |
| `adminStore` | Optional | Adapter-built admin repositories surfaced on `BylineCore.adminStore`. Required by the built-in admin user, role, permission, and JWT session facilities. |
| `fields.richText.embed` | Conditional | Write-time rich-text relation embedder. Required when a rich-text field effectively enables `embedRelationsOnSave`. |
| `fields.richText.populate` | Conditional | Read-time rich-text relation refresher. Required when a rich-text field effectively enables `populateRelationsOnRead`. |
| `fields.richText.toMarkdown` | Optional | Synchronous one-way serializer used by markdown document export, `.md` routes, and `llms.txt`. |
| `fields.richText.toText` | Conditional | Plain-text extractor required when a collection search body includes a rich-text field. |
| `search` | Conditional | Search provider required when any collection declares `search`. |
| `scheduledPublication` | Disabled | Set `{ enabled: true }` to register the built-in `documents.publish-scheduled` recurring task and expose the feature to host/admin integrations. The database adapter must implement both scheduler and document-schedule capabilities. Registration is inert: `initBylineCore()` does not start a timer. |
| `recurringTasks` | `[]` | Definitions created with `defineRecurringTask()`. Registration does not start a timer. When this list is non-empty, `db` must implement the optional scheduler capability; `initBylineCore()` validates and snapshots the definitions for the scheduler runner. |

The host owns execution lifetime. A long-running server may call `startBylineScheduler(core)` from `@byline/core/scheduler`; an externally orchestrated installation may call `runDueTasks(core)` instead. Importing server configuration from a seed, migration, or maintenance script therefore never acquires a lease or keeps that process alive. Scheduled publication remains optional convenience: ordinary `CollectionHandle.changeStatus()` publication neither requires nor consults a schedule row.

### `ServerHooksConfig`

```ts
interface ServerHooksConfig {
  collections?: Record<
    string,
    CollectionHooks | CollectionHooksLoader | SingletonHooks | SingletonHooksLoader
  >
  uploads?: Record<string, UploadHooks | UploadHooksLoader>
}
```

| Property | Key | Description |
|---|---|---|
| `collections` | Document-resource path, such as `docs` or `site-settings` | Collection or singleton hooks attached after initialization validates the registry. The registry name remains `collections` because both kinds use the canonical definition tuple. |
| `uploads` | `<collectionPath>.<canonical schema path>` | Field-scoped upload hooks. Array indexes are omitted; a block type segment follows a blocks field. |

```ts
export const serverHooks: ServerHooksConfig = {
  collections: {
    docs: () => import('./docs/hooks.js'),
    'site-settings': () => import('./site-settings/hooks.js'),
  },
  uploads: {
    'media.image': () => import('./media/upload-hooks.js'),
  },
}
```

Use this registry when the hook module imports Node-only packages, secrets, storage SDKs, or server clients. A loader attached directly to an isomorphic schema remains reachable from the browser graph.

Inline hook objects are family-checked during startup attachment: collection-only hooks cannot attach to a `singleton: true` definition, and `beforeSave` or `afterSave` cannot attach to a multi-document definition. A loader stays lazy, so Byline checks its hook family on first lifecycle resolution, caches the imported object by loader identity, and repeats the family check on every later resolution. Reusing one loader across different resource kinds therefore cannot bypass the discriminant check.

### `initBylineCore(config, pinoLogger?)`

```ts
async function initBylineCore<TAdminStore = unknown>(
  config: ServerConfig<TAdminStore>,
  pinoLogger?: pino.Logger
): Promise<BylineCore<TAdminStore>>
```

This is the recommended server entry point. It:

1. resolves and validates configuration;
2. validates rich-text, search, translations, tree and scheduler capabilities, recurring tasks, and collection definitions;
3. composes the configured services and logger;
4. reconciles collection records and schema versions;
5. ensures counter sequences and backfills legacy source locales where supported;
6. registers collection abilities; and
7. commits the server config, logger, and core singletons only after initialization succeeds.

### `defineServerConfig(config)`

```ts
function defineServerConfig<TAdminStore = unknown>(
  config: ServerConfig<TAdminStore>
): ResolvedServerConfig<TAdminStore>
```

Validates, resolves routes, attaches configured hooks, and registers only the server-config singleton. It does not compose a `BylineCore`, reconcile collections, or register the logger and abilities. Application bootstraps should normally use `initBylineCore()`.

### `getServerConfig()`

```ts
function getServerConfig(): ResolvedServerConfig
```

Returns the registered server config. It throws in a browser or before server configuration has completed.

## `BylineCore`

`initBylineCore()` returns and globally registers the composed runtime.

| Property or method | Type | Description |
|---|---|---|
| `config` | `ResolvedServerConfig<TAdminStore>` | Resolved server configuration. |
| `collections` | `readonly CollectionDefinition[]` | Canonical configured collection tuple. |
| `db` | `IDbAdapter` | Configured database adapter. |
| `storage` | `IStorageProvider \| undefined` | Installation-wide storage provider. |
| `logger` | `BylineLogger` | Structured runtime logger. |
| `collectionRecords` | `Map<string, CollectionRecord>` | Boot-reconciled collection IDs, versions, and fingerprints by path. |
| `getCollectionRecord(path)` | `CollectionRecord` | Throwing cached lookup for one registered collection. |
| `abilities` | `AbilityRegistry` | Collection and application ability registry. |
| `registerAbility(descriptor)` | `void` | Adds an application or plugin ability. |
| `listAbilities()` | `AbilityDescriptor[]` | Returns every registered ability. |
| `getAbilitiesByGroup()` | `Map<string, AbilityDescriptor[]>` | Groups registered abilities for admin presentation. |
| `sessionProvider` | `SessionProvider \| undefined` | Configured session provider. |
| `adminStore` | `TAdminStore \| undefined` | Configured admin-store aggregate. |
| `recurringTasks` | `readonly RecurringTaskDefinition[]` | Frozen, validated recurring-task definitions. Empty when none are registered; storing them on core does not start a scheduler. |

### `getBylineCore<TAdminStore>()`

```ts
function getBylineCore<TAdminStore = unknown>(): BylineCore<TAdminStore>
```

Returns the core registered by `initBylineCore()`. It throws in the browser or before initialization completes.

## Database error classification

```ts
const DbErrorCodes = {
  UNIQUE_VIOLATION: 'DB_UNIQUE_VIOLATION',
  FOREIGN_KEY_VIOLATION: 'DB_FOREIGN_KEY_VIOLATION',
  UNKNOWN: 'DB_UNKNOWN',
} as const

type DbErrorCode = (typeof DbErrorCodes)[keyof typeof DbErrorCodes]
```

`IDbAdapter.classifyError(error)` returns a `DbErrorClassification` with one `DbErrorCode` and an optional `constraint`. Canonical adapters classify named foreign-key failures as `DB_FOREIGN_KEY_VIOLATION`; earlier versions classified those failures as `DB_UNKNOWN`.

Downstream exhaustive branches over `DbErrorCode` must add the new member:

```ts
switch (classification.code) {
  case DbErrorCodes.FOREIGN_KEY_VIOLATION:
    return reportReferenceFailure(classification.constraint)
  // …UNIQUE_VIOLATION and UNKNOWN…
}
```

## Configuration lookup helpers

| Function | Return | Behavior |
|---|---|---|
| `getCollectionDefinition(path)` | `CollectionDefinition \| null` | Reads the current server config, or admin config when no server config exists, and finds either definition kind by path. |
| `getCollectionAdminConfig(slug)` | `CollectionAdminConfig \| null` | Finds a multi-document admin config by slug. Returns `null` for an absent config and for a singleton config. |
| `getSingletonAdminConfig(slug)` | `SingletonAdminConfig \| null` | Finds a singleton admin config by slug. Returns `null` for an absent config and for a multi-document config. |
| `orderByContentLocale(codes)` | `string[]` | Returns a sorted copy using configured content-locale order, with unknown codes alphabetized at the end. It never filters codes. |

`getCollectionDefinition(path)` previously returned only the multi-document branch. Code that reads collection-only members must now narrow the union:

```ts
const definition = getCollectionDefinition(path)
if (definition == null || definition.singleton === true) return null
return definition.labels.plural
```

## Server client getters

The `@byline/client/server` subpath is server-only. Its browser export condition throws.

| Function | Request authority | Use |
|---|---|---|
| `getPublicBylineClient()` | Anonymous published reader | Feeds, sitemaps, third-party endpoints, and public reads where preview must never apply. |
| `getViewerBylineClient()` | Anonymous by default; admin actor when a preview cookie and valid admin session both resolve | Public pages that support editorial preview. The call still needs `status: 'any'` when `isPreviewActive()` is true. |
| `getAdminBylineClient()` | Authenticated admin actor resolved from the current request | Admin server functions and request-bound admin reads/writes. |
| `getSystemBylineClient()` | Stable super-admin system actor | Seeds, migrations, maintenance jobs, and background lifecycle work outside an HTTP request. |
| `isPreviewActive()` | — | Resolves `true` only when the preview cookie and a valid admin session are both present. |

```ts
import { getViewerBylineClient, isPreviewActive } from '@byline/client/server'

const preview = await isPreviewActive()
const page = await getViewerBylineClient().collection('pages').findByPath('about', {
  status: preview ? 'any' : 'published',
})
```

All getters cache the client instance but resolve request authority per operation. Generated `Register` augmentation types every getter with the application's collection paths and field shapes.
