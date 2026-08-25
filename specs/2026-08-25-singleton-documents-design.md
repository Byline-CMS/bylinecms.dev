# Singleton Documents Design

Date: 2026-08-25
Status: proposed; not implemented

## Decision

Byline should support the concept Payload CMS calls a **Global** as a first-class
**singleton document**.

A singleton is one named document slot for an installation. It uses the same
field schema, relationships, localization, immutable content versions,
workflow, history, field hooks, and storage machinery as a collection document,
but its cardinality and operations are different:

- the slot has zero or one persisted logical document;
- the first update materializes that document;
- subsequent updates create normal immutable versions of the same document;
- it can be read, updated, published, scheduled, and restored;
- it cannot be listed, created as a second record, duplicated, reordered,
  searched as a collection, or deleted through the supported API;
- its dashboard link opens the editor directly, without a collection list or a
  document id in the URL.

This is a new resource kind over Byline's document model, not a separate
persistence or lifecycle system.

The public term is **singleton**, not **global**. “Singleton” states the actual
invariant. “Global” is ambiguous in a TypeScript application and becomes
misleading when Byline later supports site- or tenant-scoped resources.
Migration documentation should say explicitly that a Payload Global maps to a
Byline singleton.

## Background

[Payload Globals](https://payloadcms.com/docs/configuration/globals) are
single-document schemas commonly used for header navigation, site-wide alerts,
localized strings, and site settings. Payload exposes read and update
operations, but no create or delete operation. Globals may also use fields,
access control, hooks, localization, versions, drafts, and custom admin
presentation.

Byline has no cardinality-constrained document kind today. An application can
approximate one with a collection and a convention such as “always call
`findOne()`,” but that convention leaves important behavior wrong:

- another caller can create a second document;
- the SDK advertises list, create, delete, duplicate, reorder, and search
  operations that should not exist;
- permissions include misleading create and delete abilities;
- the dashboard opens a list view and displays collection statistics;
- every caller must choose a row, usually through an unstable id or ordering
  convention;
- the first-write race has no database-backed cardinality guarantee.

The concept therefore needs a specification and a first-class API even though
most of its implementation should reuse collections.

## Goals

1. Represent one installation-wide editable document under a stable schema
   path.
2. Reuse Byline's current fields, relationships, localization, versioning,
   workflows, history, storage restoration, and schema fingerprinting.
3. Enforce at most one persisted logical document per singleton definition in
   both canonical database adapters.
4. Make the valid operations obvious in TypeScript, authorization, server
   functions, and the admin interface.
5. Preserve Byline's schema/admin split and generated-type guarantees.
6. Support both editorial content, which benefits from draft/publish workflow,
   and operational settings, which normally use `SINGLE_STATUS_WORKFLOW`.
7. Make a Payload-to-Byline migration direct without reproducing Payload's
   separate global storage and API subsystem.

## Non-goals

- A key/value settings service or arbitrary untyped JSON store.
- Storage for secrets. Credentials, API keys, signing keys, and deployment
  endpoints remain deployment configuration.
- Multiple singleton instances per tenant, workspace, site, or locale. A
  multi-site application should use a normal collection keyed by site until a
  separately specified scoping model exists.
- A stable public REST or GraphQL API. Byline's current delivery boundary
  remains the in-process client and host-adapter server functions.
- Making a singleton a relationship target in the first release. A singleton
  may contain relationships to collections.
- In-place conversion between an existing collection and a singleton.
- A built-in frontend cache. Hosts continue to invalidate their own caches from
  lifecycle hooks.
- Document locking beyond Byline's existing optimistic-concurrency behavior.
- A recursively nested field type. An embedded `type: 'tree'` field is a
  follow-up feature, with multi-level navigation as its primary initial use
  case.

## Resource model

### A singleton is a discriminated collection definition

Singletons remain in Byline's existing `collections` tuple. The public
`CollectionDefinition` type becomes a discriminated union over a shared
document-definition base:

```ts
type CollectionDefinition = MultiCollectionDefinition | SingletonDefinition

interface MultiCollectionDefinition extends DocumentDefinitionBase {
  singleton?: false
  labels: { singular: string; plural: string }
  // Existing collection-only options and hooks.
}

interface SingletonDefinition extends DocumentDefinitionBase {
  singleton: true
  label: string
  // Collection-only options are absent or `never`.
}
```

This is one configuration and bootstrap pipeline, not parallel collection and
singleton subsystems. Code that needs resource-kind behavior narrows once on
`definition.singleton === true`. `defineCollection()` continues returning a
multi-document definition, while `defineSingleton()` is thin authoring sugar
that adds the `singleton: true` discriminant and preserves literal field and
path types. Authors do not need to write the discriminator themselves.

`SingletonDefinition` supports:

- `path`;
- one `label`;
- `fields`;
- `workflow`;
- singleton lifecycle hooks;
- schema `version`;
- the field-level upload and rich-text facilities reachable from `fields`.

The first release does not support collection-only configuration:

- `labels.plural`;
- `useAsTitle` or `useAsPath`;
- `listSearch` or `search`;
- `showStats`;
- `orderable` or `tree`;
- `linksInEditor`;
- `advertiseLocales`;
- `buildDocumentPath`.

The union must make these exclusions visible at the definition site rather
than relying only on runtime validation. Runtime validation still rejects
untyped JavaScript or cast values carrying an invalid combination.

The admin-side preview callback remains available because a settings or
navigation singleton may affect a real public page such as `/` even though the
singleton itself has no public document path.

The `tree` exclusion above refers to `MultiCollectionDefinition.tree`, which
links multiple logical documents into an ordered hierarchy. It does not rule
out a future embedded `type: 'tree'` field whose recursively nested nodes are
values owned by one document. A singleton and collection-level `tree: true`
are mutually exclusive because a singleton can contain only one logical
document.

### Registration

Singletons are registered in the existing server-safe collection tuple. That
keeps startup validation, schema fingerprinting, hook attachment, ability
registration, and admin route generation on one pipeline.

```ts
// byline/singletons/site-settings/schema.ts
import { defineSingleton } from '@byline/core'

export const SiteSettings = defineSingleton({
  path: 'site-settings',
  label: 'Site settings',
  fields: [
    { name: 'name', label: 'Site name', type: 'text', required: true },
    {
      name: 'summary',
      label: 'Site description',
      type: 'textArea',
      localized: true,
      required: true,
      validation: { minLength: 50, maxLength: 300 },
    },
    {
      name: 'heroImage',
      label: 'Default hero image',
      type: 'relation',
      targetCollection: 'media',
    },
  ],
})
```

```ts
// byline/collections/index.ts
import { News } from './news/schema.js'
import { SiteSettings } from './site-settings/schema.js'

export const collections = [News, SiteSettings] as const
```

```ts
// byline/server.config.ts
await initBylineCore({
  collections,
  // ...
})
```

`BaseConfig.collections` remains the only definition registry.
`AdminConfig.admin` becomes a discriminated union of multi-collection and
singleton presentation entries. `ServerHooksConfig.collections` remains the
one server-only hook registry; hook attachment validates the hook family
against the targeted definition's discriminant. Typed helpers such as
`defineSingletonAdmin()` and `defineSingletonHooks()` improve authoring without
creating additional configuration properties.

Paths are already unique inside the one tuple, so a multi-collection and a
singleton cannot both be called `settings`. Generated types and the client
derive separate path registries by filtering this tuple at generation time;
that public API distinction does not require separate runtime registration.

### Schema fingerprinting

Singleton definitions are reconciled at startup through the existing
collection-schema registry and version mechanism. The stored registration must
record `kind: 'singleton'`, and `kind` participates in the fingerprint.

Changing a registered path from collection to singleton, or singleton to
collection, throws at startup even if the rest of the fingerprint matches. It
requires an explicit data migration because the cardinality and supported
operations change.

The existing `byline_collections` table may continue to hold both kinds. Its
name is a physical compatibility detail; it represents registered document
schemas after this feature lands.

## Cardinality and persistence

### Persisted mapping

Do not enforce singleton identity through an ordinary document path or a
well-known generated UUID. Paths are locale-bearing system metadata and can be
re-anchored; schema paths can be renamed; neither should be the cardinality
authority.

Add an adapter-owned mapping table:

```sql
byline_singleton_documents
  collection_id  -- primary key
  document_id    -- unique

  foreign key (collection_id, document_id)
    references byline_documents(collection_id, id) on delete cascade
```

The primary key makes the singleton slot unique for a registered schema. The
document id points at the one normal logical document whose versions and field
rows carry the content. PostgreSQL and MySQL use equivalent constraints and the
shared database conformance suite pins their behavior. The composite foreign
key also proves that the mapped document belongs to the registered schema; it
requires a supporting unique constraint on
`byline_documents(collection_id, id)`. The document row already references the
schema registration, so the composite foreign key also prevents orphaned
registration ids without adding a second cascade path.

The dedicated table keeps singleton identity out of every ordinary document
row and gives the slot an explicit adapter-owned representation. It is not
strictly a table-only migration: the current PostgreSQL and MySQL schemas make
`byline_documents.id` the sole primary key, so the composite foreign key also
requires the supporting unique key above on the existing documents table. The
design accepts that index migration to retain the database-level ownership
proof. It still avoids adding a nullable singleton marker column to the hot
table and leaves room for a separately specified scoped-slot key in the
future.

The singleton document may retain an internal generated path because current
document storage expects path metadata. That value is not an identity, is not
editable, and is omitted from the singleton client envelope.

### First update

The slot exists conceptually as soon as the definition is registered, but no
content document is created at bootstrap. This avoids persisting an invalid
empty version when the schema has required fields.

`updateSingleton` is an upsert from the caller's perspective:

1. Assert the singleton's `update` ability.
2. Start an adapter transaction.
3. Lock the registered schema row as the mutex for this singleton slot. Locking
   the registration row works even when the mapping row does not exist yet.
4. Read `byline_singleton_documents` by `collection_id`.
5. If a mapping exists, run the normal document update pipeline against that
   document id.
6. Otherwise, run the normal document create pipeline and insert the mapping in
   the same transaction.
7. Commit the content version and mapping together.

The lock prevents two concurrent first saves from producing competing logical
documents. The mapping constraints remain the final database invariant.

The internal create path must not assert a public `create` ability. From the
singleton API's perspective the operation is always “update this named slot,”
including its first materialization.

### Deletion

The supported singleton API has no delete operation. Archiving or unpublishing
a version remains available through workflow operations; restoring a historical
version remains available through history.

Low-level adapter commands are internal tooling and can bypass lifecycle
invariants, as they already can for collections. If tooling hard-deletes a
mapped document, foreign-key policy should remove the mapping. A later update
can then materialize a replacement. That recovery behavior is not an
application-level delete contract.

## Lifecycle semantics

### Versioning and workflow

Every singleton save writes an immutable document version. Byline does not add
a Payload-style `versions: false` mode.

The workflow default remains Byline's normal `draft -> published -> archived`
workflow. This is appropriate for navigation, homepage presentation, default
metadata, announcements, and other public content where an editor should be
able to prepare changes without changing the live site.

Operational settings that should take effect on every save opt into the
existing `SINGLE_STATUS_WORKFLOW` explicitly:

```ts
export const ContactRouting = defineSingleton({
  path: 'contact-routing',
  label: 'Contact routing',
  workflow: SINGLE_STATUS_WORKFLOW,
  fields: [/* ... */],
})
```

Published reads retain Byline's existing behavior: a new draft can be current
for editors while public reads continue to resolve the most recent published
version. Scheduled publication, unpublish, history, and restore operate on the
mapped document after its first save.

### Localization

A singleton is one logical document with localized fields, not one document per
locale. Locale resolution, fallback, all-locale reads, locale copy, and locale
merge behavior reuse the document lifecycle.

The first save must still occur in the installation's current default content
locale. Later saves in another locale update the same mapped logical document.
Because cardinality comes from the mapping table rather than paths or locale
rows, changing the configured default locale cannot create a second singleton.

`advertiseLocales` is omitted in the first release because a singleton has no
public route to advertise. If a future delivery API needs singleton-specific
locale availability, it should be specified directly rather than inherited
accidentally from routed collection documents.

### Hooks

Expose singleton lifecycle hooks in terms of the public singleton operation,
not the internal create/update branch:

- `beforeSave`;
- `afterSave`;
- `beforeRead`;
- `afterRead`;
- `beforeStatusChange` and `afterStatusChange`;
- `beforeUnpublish` and `afterUnpublish`.

`beforeSave` and `afterSave` fire on every save, including the first. Their
contexts include `isInitialSave`, `data`, `originalData` (`null` initially), the
singleton path, locale, and request context. `beforeSave` receives the existing
document id or `null`; `afterSave` receives the persisted document and version
ids. Restoring a historical version is a save with an operation discriminator,
so it passes through the same hook pair. Scheduled publication passes through
the status-change hooks. `afterSave` is the direct home for host cache
invalidation that a Payload `afterChange` hook commonly performs.

`beforeRead` uses one contract for both resource kinds. Widen Byline's existing
`BeforeReadHookFn` return type from `QueryPredicate | void` to
`QueryPredicate | false | void`. `false` normalizes to an always-false
predicate, so collection reads return no rows and singleton `get()` returns
`null`; it does not throw an authorization error. `void` applies no additional
restriction, and a predicate is combined with the caller's query as it is
today. Multiple hooks combine with logical AND, so one `false` result cannot be
overridden by a later hook. The same contract lets collections express “deny
all rows” without constructing `{ id: { $in: [] } }`, while a singleton can
normally use the clearer `false` branch. `true` is unnecessary and is not part
of the contract. `afterRead` remains the field-redaction boundary.

The shared read-hook signature does not force singleton writes into collection
create/update hooks. `SingletonHooks` exposes the save-oriented hooks above;
`MultiCollectionHooks` retains create, update, delete, and tree hooks. Both use
the common read and workflow hook slots, and the `CollectionDefinition`
discriminant selects the valid family.

Public-cache invalidation is not automatic. A host commonly invalidates a
preview/editor cache after every save and a public cache only after the
published view changes. Status and publication hooks make that distinction
possible.

## Client and generated types

### Generated registries

Code generation emits singleton field registries alongside collection
registries:

```ts
declare module '@byline/generated-types' {
  export interface SingletonFieldsByPath {
    'site-settings': SiteSettingsFields
  }

  export interface SingletonFieldsAllLocalesByPath {
    'site-settings': SiteSettingsFieldsAllLocales
  }
}

declare module '@byline/client' {
  interface Register {
    collections: import('@byline/generated-types').CollectionFieldsByPath
    singletons: import('@byline/generated-types').SingletonFieldsByPath
  }
}
```

Code generation reads the one runtime tuple and emits two public registries:
definitions with `singleton: true` populate the singleton maps; all remaining
definitions populate the collection maps. The application compile-time
contract checks that filtered result against both generated registries.
Application code continues to import generated field types from
`@byline/generated-types`, never by generated-file path.

### Client surface

The in-process API is deliberately narrow:

```ts
const settings = await client.singleton('site-settings').get({
  locale: 'th',
  status: 'published',
  populate: { heroImage: ['title', 'image'] },
})

await client.singleton('site-settings').update(nextSettings, {
  locale: 'th',
  expectedVersionId: settings?.versionId,
})
```

`get()` returns `SingletonDocument<TFields> | null`. `null` means the slot has
not been saved yet, no version matches the requested read mode, the requested
locale is omitted under the chosen missing-locale policy, or read scoping hides
the singleton. The envelope includes the logical document id, version id,
status, fields, locale metadata, and timestamps, but not a document `path`.

The singleton handle also exposes the applicable workflow, scheduling,
history, and restore operations. It does not expose:

- `find`, `findOne`, `findById`, or `findByPath`;
- `create` or `delete`;
- `duplicate`;
- collection count, list, order, tree, or search operations;
- bulk reindex.

`client.collection(path)` rejects a singleton path at runtime, and
`client.singleton(path)` rejects a collection path. Generated path types make
both mistakes compile-time errors in an application with current generated
types.

## Authorization

The shared definition tuple does not imply a shared public ability namespace.
Abilities describe operations available to administrators, so Byline retains a
distinct `singletons` namespace and omits operations that do not exist. The one
bootstrap pass branches on the definition discriminant when registering them;
there is no separate ability registry or startup pipeline.

Each singleton contributes a purpose-specific ability group:

```text
singletons.<path>.read
singletons.<path>.update
singletons.<path>.publish
singletons.<path>.changeStatus
```

There is no `create`, `delete`, or `reindex` ability. Initial materialization
requires `update`. Schedule operations continue to require update,
`changeStatus`, and `publish` in the same combinations used by collections.
History reads use `read` until Byline specifies a separate history ability
uniformly for all document kinds.

Anonymous published reads follow the existing Byline public-read rule. A
private operational singleton must deny anonymous reads in `beforeRead` and be
loaded by an authenticated server or system client. The server-side assertion,
not dashboard visibility, remains the authority.

## Admin configuration and routes

Singleton presentation keeps the schema/admin split:

```tsx
// byline/singletons/site-settings/admin.tsx
import { defineSingletonAdmin } from '@byline/core'

import { SiteSettings } from './schema.js'

export const SiteSettingsAdmin = defineSingletonAdmin(SiteSettings, {
  group: 'administration',
  tabSets: [
    {
      name: 'settings',
      tabs: [
        { name: 'site', label: 'Site', fields: ['name', 'summary', 'heroImage'] },
      ],
    },
  ],
  layout: { main: ['settings'] },
  preview: { url: () => '/' },
})
```

The resulting discriminated entry is registered in the existing admin tuple:

```ts
export const admin = [NewsAdmin, SiteSettingsAdmin] as const
```

`AdminConfig.admin` accepts
`MultiCollectionAdminConfig | SingletonAdminConfig`. The singleton member
shares field overrides, rows, groups, tab sets, layout, preview, and the
dashboard `group` option with multi-collection admin config. It has no columns,
default sort, item view, list view, or list actions.

For compatibility with the dashboard grouping feature,
`SingletonAdminConfig.group` references the existing
`AdminConfig.collectionGroups` registry in the first release. The involved
types and documentation should be generalized to “dashboard resources,” while
the existing property name remains compatible.

A readable singleton appears as a dashboard card in its configured group. The
card has no count or workflow-stat tiles. Its link opens:

```text
<admin>/singletons/<singleton>
```

The route resolves the mapped document id server-side. If none exists, it
renders the same form in initial state; the first Save calls singleton update.
After materialization, the form reuses the collection document editor,
workflow controls, locale control, preview link, dirty-state handling, and
field components with these differences:

- no path widget;
- no delete or duplicate action;
- no return-to-list state;
- no list breadcrumbs;
- history uses `<admin>/singletons/<singleton>/history` and resolves the id
  internally;
- an upload field with `requireSavedDocument: true` remains gated until the
  first save, exactly as on a collection create form.

The dashboard filters singleton cards by `singletons.<path>.read` before
grouping. An update-only role remains unusable in the admin because it cannot
load the current value; this matches the existing collection rule.

## Validation

Startup validation rejects:

1. duplicate paths in the shared `collections` tuple;
2. an admin entry whose kind does not match its definition;
3. an admin entry with no matching definition;
4. a singleton definition carrying a collection-only option;
5. `tree`, `orderable`, search, list-search, path, title, link-target, or locale
   advertising configuration on a singleton;
6. a relationship whose `targetCollection` resolves only to a singleton;
7. an in-place kind change for a previously stored schema registration;
8. a server hook family that does not match its target definition;
9. an unknown dashboard group reference.

As with collections, validation completes before the resolved configuration is
registered globally.

## Modeling guidance

Use a singleton when all of the following are true:

- application code knows the resource by a stable schema name;
- there must be at most one value for the installation;
- editors should change it at runtime;
- it benefits from schema validation, permissions, localization, version
  history, or publication workflow.

Use a normal collection when editors can create or remove instances, when the
application selects a record by key, or when the number of records may grow.
For example, one fixed header navigation can be a singleton; arbitrarily named
menus are a collection. A fixed header and footer can be two singletons when
their schemas or permissions differ.

A multi-level main menu is a strong use case for a singleton containing a
future embedded `type: 'tree'` field. Each node can contain a label, an internal
document relationship or external URL, and child nodes. The whole hierarchy is
then edited, versioned, previewed, and published atomically. This differs from
a `tree: true` collection, where each menu item is an independently versioned
logical document and the hierarchy is document metadata.

Use deployment configuration when a value changes with the environment or is a
secret. Do not put database credentials, API secrets, SMTP credentials, or
hostnames that participate in trust decisions into a singleton.

Prefer several cohesive singletons to one giant settings object when the fields
have different audiences, permissions, publication cadence, or cache effects.
Public branding, a site-wide announcement, and private contact routing are
usually three resources rather than three tabs in one resource.

## Payload migration mapping

| Payload concept | Byline concept |
|---|---|
| `GlobalConfig.slug` | `SingletonDefinition.path` |
| `fields` | the same Byline field schema used by collections |
| named field tabs that create nested data | Byline `group` fields for data plus admin `tabSets` for presentation |
| `payload.findGlobal({ slug })` | `client.singleton(path).get()` |
| `payload.updateGlobal({ slug, data })` | `client.singleton(path).update(data)` |
| global `read` / `update` access | singleton abilities plus `beforeRead` for row visibility |
| `afterChange` | singleton `afterSave` and, when public output changed, publication/status hooks |
| localized fields | the mapped singleton document's localized fields |
| versions and drafts | always-versioned Byline document plus its configured workflow |
| `admin.group` | `SingletonAdminConfig.group` |
| admin preview | `SingletonAdminConfig.preview` |

Import the default-locale data through one initial `update`, then issue updates
for the remaining locales against the same mapped document. Do not create one
singleton per locale.

## Alternatives rejected

### A normal collection plus `findOne()`

This has the smallest implementation cost but does not enforce cardinality and
advertises invalid SDK, authorization, and admin operations. It is acceptable
as a temporary application workaround, not Byline's product story.

### Separate singleton definition and configuration registries

`ServerConfig.singletons`, `AdminConfig.singletons`, a separate admin registry,
and a separate hook registry would make the resource name explicit at every
configuration boundary. They would also duplicate startup traversal and force
cross-registry path validation across schema fingerprinting, hook attachment,
ability registration, generated types, and route generation. A discriminated
`CollectionDefinition` union provides the same definition-site exclusions
while retaining one tuple and one bootstrap pipeline. Separate generated-type
maps and client handles preserve the public singleton API where the distinction
is useful.

### A separate global persistence system

Dedicated global tables, lifecycle services, localization, version storage,
and history would duplicate the strongest parts of Byline and drift over time.
Only the singleton-to-document mapping needs new persistence.

### Application configuration only

Static TypeScript or environment configuration is right for deploy-time and
secret values, but it cannot provide runtime editorial updates, localization,
permissions, history, preview, or publication workflow.

### A reserved path as the uniqueness key

The existing live-path constraint could prevent a second document in one
locale, but document paths are localized and re-anchorable. A default-locale
change could undermine the invariant. Singleton identity must be independent of
URL metadata and content locale.

### A nullable singleton marker on `byline_documents`

A nullable `singleton_slot` column plus
`UNIQUE(collection_id, singleton_slot)` is valid in both PostgreSQL and MySQL:
ordinary documents use `NULL`, while a singleton document uses one fixed slot
value. It avoids a mapping-row write and cannot leave an orphaned mapping.

The design instead keeps resource identity in
`byline_singleton_documents`. A slot is configuration-owned metadata, not a
property of every logical document, and a dedicated table can later evolve to
an explicitly scoped key without changing the base document row. This is not a
claim of zero hot-table migration cost: retaining the composite ownership
foreign key requires the supporting
`UNIQUE(collection_id, id)` key described above. Both designs therefore need a
documents-table index change; the mapping table wins on separation and future
schema shape, not on being entirely additive.

### Collection-level `tree: true` on a singleton

Byline's existing tree option arranges multiple logical documents. Applying it
to a resource that permits at most one logical document would produce at most
one node and would not model a nested menu. The singleton feature therefore
rejects collection-level `tree: true`. A recursive, versioned `type: 'tree'`
field should be specified separately after singleton documents, including its
node identity, maximum-depth validation, drag-and-drop editing, and recursive
TypeScript inference.

## Delivery phases

### Phase 1: schema, storage, and types

- Refactor `CollectionDefinition` and admin config into discriminated unions;
  add singleton factories without adding configuration registries.
- Extend the existing server/admin/hook validation passes for the singleton
  member.
- Extend schema fingerprinting and prohibit kind changes.
- Add the singleton mapping seam to `IDbAdapter`.
- Add the PostgreSQL and MySQL mapping tables, supporting composite document
  key, commands, queries, migrations, and shared conformance coverage.
- Extend code generation and the app-owned exactness contract.

### Phase 2: lifecycle, client, and authorization

- Add transactional read/update services over the mapped document.
- Add singleton hooks and ability registration.
- Widen the shared `beforeRead` contract with the `false` deny result.
- Add the typed `SingletonHandle`.
- Reuse workflow, schedule, history, restore, locale, populate, and upload
  behavior through the shared lifecycle.
- Add unit tests for initial materialization, concurrent first saves, locale
  updates, published-behind-draft reads, and invalid operation rejection.

### Phase 3: TanStack Start admin host

- Add singleton server functions and route factories.
- Render singleton dashboard cards in existing groups.
- Add the combined create/edit form route and history route.
- Remove collection-only controls from the reused editor surface.
- Add route, ability-visibility, and form behavior tests.

### Phase 4: documentation and migration example

- Add developer documentation under `docs/04-collections/` or a sibling
  `docs/04-content-models/` section, depending on the documentation navigation
  at implementation time.
- Add API-reference entries for definition, admin config, client handle, hooks,
  and abilities.
- Update CLI templates and generated-type checks.
- Add a neutral Payload Global migration example covering localized public
  settings, media relationships, and a private operational singleton.

## Acceptance criteria

The feature is complete when:

1. Two concurrent initial updates cannot leave two mapped logical documents.
2. PostgreSQL and MySQL pass the same singleton conformance suite.
3. A public published read continues returning the prior published version
   while an editor has a newer draft.
4. Localized saves in multiple locales resolve through one logical document.
5. The generated client accepts singleton paths only through `singleton()` and
   collection paths only through `collection()`.
6. A singleton never exposes list, create, delete, duplicate, reorder, tree,
   search, or reindex UI/API operations. Here, tree means the existing
   collection-level hierarchy operations; a future embedded tree field remains
   ordinary versioned document data.
7. Initial materialization requires `singletons.<path>.update`, not a hidden
   create ability.
8. The admin dashboard links directly to one editor and respects read ability
   filtering and dashboard grouping.
9. History, restore, publish, unpublish, schedule, preview, relationships, and
   localized fields work through the shared Byline behavior.
10. Changing a stored schema registration between collection and singleton
    fails fast with a migration-oriented error.
11. Server, admin, and hook configuration use the existing collection
    registries; generated types and client handles expose separately filtered
    collection and singleton paths.
12. `beforeRead` accepts `false` as an explicit deny result for collections and
    singletons, and multiple hooks combine without allowing a later hook to
    override a denial.
13. `pnpm byline:generate:check`, `pnpm lint`, `pnpm typecheck`, `pnpm knip`,
    unit tests, and both database integration/conformance suites pass.
