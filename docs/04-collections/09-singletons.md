---
title: "Singletons"
path: "singletons"
summary: "How to define, register, edit, and read a named singleton document slot, including its lifecycle, workflow, storage identity, and modelling limits."
---

# Singletons
Companions:
- [Collections](./index.md) — the shared schema, field, workflow, and admin-presentation concepts used by both document-resource kinds.
- [Client SDK](../05-reading-and-delivery/01-client-sdk.md) — request authority, read modes, populate controls, and generated client typing.
- [Authentication and authorization](../07-auth-and-security/01-authn-authz.md) — ability enforcement and the recipe for separating public and private singleton values.
- [Document storage](../03-architecture/01-document-storage.md) — immutable versions and typed field storage beneath a materialised singleton.
- [Internationalization](../08-internationalization/index.md) — locale fallback and copy-to-locale behaviour inherited by singleton documents.

## Overview

A singleton is one named document slot for an installation, intended for content such as site settings or a navigation model that has one installation-wide value. The slot has precise cardinality: registration creates one named slot, and that slot holds zero or one persisted document. The first save materialises the document.

Four rules anchor the model:

1. **The content is an ordinary document.** Immutable versions, localised fields, workflow, history, restore, populate, and uploads use the shared document runtime.
2. **An unsaved slot is normal.** Reads return `null` until the first save, so a front end must render a fallback or an intentional empty state.
3. **Cardinality removes collection operations.** A singleton has no list, create, delete, or duplicate operation. `update()` performs both the first materialising save and every later save.
4. **The internal `path` is not identity.** Storage generates document path metadata because the shared document tables require it, but the singleton path is the registered definition key. The generated document path is neither a public identity nor a URL and is omitted from `SingletonDocument`.

Use a singleton when a value is installation-wide and should be saved, versioned, translated, and published as one unit. Use a multi-document collection when editors need more than one independently authored item.

---

## Quick reference

Each entry is the minimum shape for one task. The **Edit:** line identifies the file you change; the closing link opens the complete contract.

### 1. Declare and register a singleton

Define the schema with `defineSingleton`, then add it to the shared `collections` tuple. Collections and singletons use one path namespace and one definition registry.

**Edit:** `apps/webapp/byline/singletons/site-settings/schema.ts` and `apps/webapp/byline/collections/index.ts`

```ts
import { defineSingleton, SINGLE_STATUS_WORKFLOW } from '@byline/core'

export const SiteSettings = defineSingleton({
  path: 'site-settings',
  label: 'Site settings',
  workflow: SINGLE_STATUS_WORKFLOW,
  fields: [
    { name: 'siteName', label: 'Site name', type: 'text' },
    {
      name: 'siteDescription',
      label: 'Site description',
      type: 'textArea',
      localized: true,
    },
    {
      name: 'defaultImage',
      label: 'Default social image',
      type: 'image',
      optional: true,
      upload: { mimeTypes: ['image/jpeg', 'image/png'], requireSavedDocument: true },
    },
  ],
})
```

```ts
import { SiteSettings } from '../singletons/site-settings/schema.js'

export const collections = [/* other definitions */, SiteSettings] as const
```

Run `pnpm byline:generate` after changing the schema and commit the generated application types.

→ [Definition and registration](#definition-and-registration)

### 2. Add the admin editor and dashboard group

`defineSingletonAdmin` links form presentation to the schema. Its optional `group` names an entry in `AdminConfig.collectionGroups`.

**Edit:** `apps/webapp/byline/singletons/site-settings/admin.ts` and `apps/webapp/byline/admin.config.ts`

```ts
import { defineSingletonAdmin } from '@byline/core'
import { SiteSettings } from './schema.js'

export const SiteSettingsAdmin = defineSingletonAdmin(SiteSettings, {
  group: 'settings',
  layout: { main: ['siteName', 'siteDescription', 'defaultImage'] },
  preview: { url: () => '/' },
})
```

```ts
import type { AdminConfig } from '@byline/core'
import { defineAdminConfig } from '@byline/core'

export const config: AdminConfig = {
  collections,
  collectionGroups: [{ name: 'settings', label: 'Settings' }],
  admin: [/* collection admin configs */, SiteSettingsAdmin],
  // …i18n, routes, fields, blockAdmin, …
}

defineAdminConfig(config)
```

→ [Admin presentation](#admin-presentation)

### 3. Read a singleton from a front end

The public client reads published content and returns `null` for an unmaterialised slot or a slot hidden by `beforeRead`.

**Edit:** a server-side loader or rendering module under `apps/webapp/src/`

```ts
import { getPublicBylineClient } from '@byline/client/server'

export async function getSiteName(): Promise<string> {
  const settings = await getPublicBylineClient().singleton('site-settings').get()
  return settings?.fields.siteName ?? 'Example site'
}
```

→ [Client handle](#client-handle)

### 4. Save a singleton

Use `update()` for both the first and later saves. A seed should check the slot first so it does not overwrite editorial changes.

**Edit:** `apps/webapp/byline/seeds/site-settings.ts`

```ts
import { getSystemBylineClient } from '@byline/client/server'

export async function seedSiteSettings(): Promise<void> {
  const settings = getSystemBylineClient().singleton('site-settings')
  if ((await settings.get({ status: 'any' })) != null) return

  await settings.update({
    siteName: 'Example site',
    siteDescription: 'Default description for search and social previews.',
  })
}
```

Interactive editors should pass the current `versionId` as `expectedVersionId` so a stale form cannot overwrite a newer save.

→ [Client handle](#client-handle)

### 5. Add a save hook

Singleton hooks describe public save operations rather than the internal create-versus-update persistence branch. Branch on `operation.type` when restore or locale copy needs different side effects.

**Edit:** the singleton schema for isomorphic-safe hooks, or the server-only hook registry for hooks that import server modules.

```ts
import { defineSingleton } from '@byline/core'

export const SiteSettings = defineSingleton({
  path: 'site-settings',
  label: 'Site settings',
  fields: [{ name: 'siteName', label: 'Site name', type: 'text' }],
  hooks: {
    beforeSave: ({ data, operation }) => {
      if (operation.type === 'save' && typeof data.siteName === 'string') {
        data.siteName = data.siteName.trim()
      }
    },
  },
})
```

→ [Hooks and save operations](#hooks-and-save-operations)

### 6. Restrict a singleton to authenticated readers

The base gate allows an anonymous actor to read published documents. Return `false` from `beforeRead` to restrict a private singleton further, and keep public values in a different singleton.

**Edit:** the private singleton schema or server-only hook module.

```ts
hooks: {
  beforeRead: ({ requestContext }) =>
    requestContext.actor == null ? false : undefined,
}
```

The complete recipe includes the silent-exposure warning and hook composition rules in [Authentication and authorization](../07-auth-and-security/01-authn-authz.md#10-recipe-split-public-and-private-singleton-values).

→ [Hooks and save operations](#hooks-and-save-operations)

---

## Definition and registration

`defineSingleton()` accepts the shared document members and adds the `singleton: true` discriminant:

```ts
interface SingletonDefinition {
  singleton: true
  path: string
  label: string
  fields: Field[]
  workflow?: WorkflowConfig
  version?: number
  hooks?: SingletonHooks | SingletonHooksLoader
}
```

`path` is the stable slot key used by configuration, generated types, ability names, the client, admin routes, and the storage mapping. It shares a namespace with multi-document collection paths, so two definitions of either kind cannot use the same value. `label` is singular because there is no list or plural resource name.

The shared `collections` tuple is the only definition registry:

```ts
export const collections = [News, Pages, SiteSettings] as const
```

`CollectionDefinition` is the discriminated union of `MultiCollectionDefinition` and `SingletonDefinition`. Code that receives the union narrows with `definition.singleton === true` or `isSingleton(definition)`.

Collection-only options are typed as `?: never` and rejected again at runtime for untyped callers. A singleton cannot set `labels`, `useAsTitle`, `useAsPath`, `orderable`, `tree`, `search`, `listSearch`, `advertiseLocales`, `showStats`, `linksInEditor`, or `buildDocumentPath`. Those options describe a list, siblings, search projection, or public document address, none of which the singleton model has.

Schema fingerprints include the resource kind. Changing a registered path from a collection to a singleton, or the reverse, is therefore not an in-place schema edit. Model it as a deliberate content migration.

## Admin presentation

`defineSingletonAdmin(schema, config)` returns a `SingletonAdminConfig` with `singleton: true` and `slug` copied from `schema.path`. It supports the shared form-composition surface:

- `tabSets`, `rows`, `groups`, and `layout` arrange the form;
- `fields` supplies per-field rendering overrides;
- `group` places the dashboard card in a declared `collectionGroups` section;
- `preview.url` returns a public URL for the singleton's site-wide effect.

There is no collection list, so `columns`, `defaultSort`, `defaultColumns`, `itemView`, `itemViewSort`, `listView`, and `listActions` are invalid. The dashboard card opens the singleton editor directly.

Before the first save, the editor renders an empty form. Controls that require a persisted document remain unavailable: history, locale switching, copy to locale, workflow actions, scheduling, and upload fields with `requireSavedDocument: true`. A successful first save materialises the document and enables those controls. Cancelling returns to the dashboard; there is no delete or duplicate action.

## Client handle

`client.singleton(path)` returns a document-ID-free `SingletonHandle`. Generated application types constrain `path` to registered singleton paths and infer the field shape.

The handle exposes these operation groups:

| Purpose | Methods | Unsaved-slot result |
|---|---|---|
| Current content | `get(options?)` | `null` |
| Save | `update(data, options?)` | Materialises the document |
| Workflow | `changeStatus()`, `unpublish()` | `ERR_NOT_FOUND` |
| Scheduling | `schedulePublish()`, `confirmScheduledPublish()`, `cancelScheduledPublish()` | `ERR_NOT_FOUND` |
| Schedule read | `getScheduledPublish()` | `null` |
| History | `history(options?)` | Empty page |
| Historical read | `findByVersion(versionId, options?)` | `null` |
| Restore | `restoreVersion(sourceVersionId)` | `ERR_NOT_FOUND` |
| Localisation | `copyToLocale(args)` | `ERR_NOT_FOUND` |

`get()` accepts the same selection, populate, locale, missing-locale, status, and lenient reconstruction controls as a collection's `findById()`. The returned `SingletonDocument` has `id`, `versionId`, `status`, timestamps, locale metadata, and `fields`, but no `path`.

`update(data, { locale, expectedVersionId })` writes a new immutable version. When `expectedVersionId` does not match the slot's current version, the save rejects with `ERR_CONFLICT`. The first save needs no document id and maps the newly created document to the registered slot.

Every public method performs the kind-aware ability check before resolving the mapping. Singleton ability keys use `singletons.<path>.read`, `.update`, `.publish`, and `.changeStatus`; collection-only abilities do not apply.

## Hooks and save operations

`SingletonHooks` uses save-oriented names because callers do not choose whether the shared persistence layer creates or updates the backing document:

- `beforeSave` runs inside the locked transaction and may mutate `data`;
- `afterSave` runs after commit, so a failure rejects the call but cannot roll back the persisted version or initial mapping;
- `beforeRead` and `afterRead` use the shared document read contracts;
- `beforeStatusChange`, `afterStatusChange`, `beforeUnpublish`, and `afterUnpublish` use the shared workflow contracts.

Both save hooks receive `singletonPath`, `data`, `originalData`, `locale`, `requestContext`, `isInitialSave`, `operation`, and `documentId`. `afterSave` additionally receives `documentVersionId`; its `documentId` is always present. On the first save, `originalData` and the `beforeSave` `documentId` are `null`.

`SingletonSaveOperation` is a discriminated union:

```ts
type SingletonSaveOperation =
  | { type: 'save' }
  | { type: 'restore'; sourceVersionId: string }
  | {
      type: 'copyToLocale'
      sourceLocale: string
      targetLocale: string
      overwrite: boolean
    }
```

Restore supplies the complete all-locale field tree with `locale: 'all'`. Copy-to-locale supplies the merged target payload and target locale; `originalData` contains the target locale's previous values or `null` when that locale had no values.

Inline hook objects and loaders attached to an isomorphic schema must remain safe for every module graph that imports the schema. Register hooks that import server-only dependencies through `ServerConfig.hooks.collections`, using the singleton path as the registry key. Byline validates that collection definitions receive `CollectionHooks` and singleton definitions receive `SingletonHooks`; lazy loaders are checked on first resolution and then on every cached resolution.

## Workflow choice

Omitting `workflow` gives a singleton `DEFAULT_WORKFLOW`: `draft`, `published`, and `archived`. Use that workflow for an announcement or other installation-wide value that editors must review and publish deliberately. Public `get()` calls return `null` until a published version exists, even after an editor has saved a draft.

Use `SINGLE_STATUS_WORKFLOW` for operational configuration that should become public on every successful save:

```ts
import { defineSingleton, SINGLE_STATUS_WORKFLOW } from '@byline/core'

export const SiteSettings = defineSingleton({
  path: 'site-settings',
  label: 'Site settings',
  workflow: SINGLE_STATUS_WORKFLOW,
  fields,
})
```

Its only status is `published`, so the admin interface hides workflow controls and every save is immediately visible to published reads. Status changes and unpublish reject because no alternative status exists.

Restoring a historical version creates a new immutable version at the definition's configured default status. With `DEFAULT_WORKFLOW` that is `draft`; with `SINGLE_STATUS_WORKFLOW` it is `published`. Restore never mutates the historical version in place.

## Storage and identity

Singleton content uses the ordinary document, version, locale-ledger, typed field-store, and file-store tables. The extra `byline_singleton_documents` table maps the registered collection record to its backing logical document:

```text
byline_singleton_documents
  collection_id  primary key
  document_id    unique
  foreign key (collection_id, document_id)
    → byline_documents (collection_id, id)
```

The primary key enforces at most one mapped document per slot. The composite foreign key proves that the mapped document belongs to the same registered definition. A first save locks the slot, creates the document and initial version, and writes the mapping in one transaction; concurrent first saves cannot produce two live mappings.

The backing document still receives generated `byline_document_paths` metadata because shared storage requires a path row. A singleton forbids `useAsPath`, never accepts a public path parameter, and removes `path` from its client envelope. Code identifies the resource by `site-settings`, the definition path supplied to `client.singleton()`, not by the backing document id or its generated path.

Uploads remain document fields. An `image` or `file` field can upload directly through the shared field service, but an upload configured with `requireSavedDocument: true` remains locked until the first save provides a document id. Historical versions retain their stored file references under the same immutable-media rules as collections.

Populate also uses the shared read pipeline. A singleton may hold relation fields targeting multi-document collections; the target collection's read ability and `beforeRead` predicate still apply. A singleton cannot itself be a relation target in this release.

## Modelling guidance

Choose the model by authoring cardinality and publication boundaries:

| Need | Model |
|---|---|
| Site description, default hero or social image, operational configuration | Singleton |
| Navigation published atomically as one unit | Singleton with an array field |
| Independently authored, individually published menu items | Collection with `tree: true` |
| Anything with more than one instance | Multi-document collection |

`tree: true` belongs only to a multi-document collection, so it is mutually exclusive with a singleton. A collection tree stores independently versioned nodes and a document-grain parent edge. A singleton array stores the whole navigation as one version and publishes it atomically.

A recursive embedded field with `type: 'tree'` is not shipped. Use nested array or group fields only when the required depth is fixed, or use a tree collection when items need independent identity and workflow.

## Not yet shipped

- **Singletons as relation targets.** Relation fields may point from a singleton to a collection, but collection or singleton fields cannot target a singleton.
- **Singleton search indexing.** `search` and `listSearch` are collection-only because there is no singleton result list.
- **An embedded `type: 'tree'` field.** Recursive data inside one document needs a separate field contract and editor.
- **Several instances per tenant or site.** A registered singleton path has one installation-wide slot. Use a collection with a tenant or site key when the cardinality is greater than one.

## Code map

| Concern | Location |
|---|---|
| `SingletonDefinition`, hooks, and `defineSingleton` | `packages/core/src/@types/collection-types.ts` |
| `SingletonAdminConfig` and `defineSingletonAdmin` | `packages/core/src/@types/admin-types.ts` |
| Singleton lifecycle | `packages/core/src/services/singleton-lifecycle/` |
| Mapping adapter contract | `IDbAdapter.queries.singletons` and `.commands.singletons` in `packages/core/src/@types/db-types.ts` |
| Mapping tables | `packages/db-postgres/src/database/schema/index.ts`; `packages/db-mysql/src/database/schema/index.ts` |
| `SingletonHandle` | `packages/client/src/singleton-handle.ts` |
| Admin server functions | `packages/host-tanstack-start/src/server-fns/singletons/` |
| Admin editor and history | `packages/host-tanstack-start/src/admin-shell/singletons/` |
| Worked application example | `apps/webapp/byline/singletons/site-settings/` and `apps/webapp/byline/seeds/site-settings.ts` |
