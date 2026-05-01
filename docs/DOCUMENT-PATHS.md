# Document Paths

> Companions:
> - [CORE-DOCUMENT-STORAGE.md](./CORE-DOCUMENT-STORAGE.md) — `path` is the first system attribute promoted out of the EAV layer onto `documentVersions`; this doc describes the rules around it.
> - [RELATIONSHIPS.md](./RELATIONSHIPS.md) — `path` is a first-class column used by relation filters (`where: { category: { path: 'news' } }`) and resolved via `findByPath` under the same `readMode` rule populate honours.
> - [COLLECTION-VERSIONING.md](./COLLECTION-VERSIONING.md) — `useAsPath` participates in the collection schema fingerprint.

## Overview

`path` is a reserved system attribute on `documentVersions`. It is the routing primitive that resolves a URL slug back to a document — the cheapest path-resolution lookup in the system, indexed on `(collection_id, path)`, used by `findByPath` and by relation filters.

Three rules anchor the model:

1. **`path` is reserved.** No collection field may be named `path`, at any nesting depth (group, array, blocks). Validation runs at config load and throws.
2. **`useAsPath?: string`** on `CollectionDefinition` names the source field whose slugified value initialises `documentVersions.path`. Parallel to `useAsTitle`. The named field must exist at the top level and be of a slug-compatible type (`text`, `textArea`, `select`, `date`, `datetime`, `time`).
3. **One canonical resource identifier per document.** A document has one `documentVersions.path`. Localised slugs (`/en/about` vs `/de/ueber-uns`) are a routing concern resolved outside the CMS — a frontend prefixes `/{locale}/{path}` with no CMS-side change. Translated slugs as a CMS concern are deferred to a future per-locale paths phase.

This work was the first time a system attribute was promoted out of the user-defined field tree. It establishes a pattern for any future "system metadata that needs editing in the admin form": reserve the name, expose it via a directive, render it through a non-field widget, and persist it via a top-level lifecycle parameter — not a `field.set` patch.

## Derivation cascade

`createDocument` runs three derivation steps in order:

1. **Explicit `params.path`** from the caller → used verbatim.
2. **`definition.useAsPath` set** → slugify the source field's value in the **default content locale** using the installation slugifier.
3. **Otherwise** → `crypto.randomUUID()`.

The cascade applies only on first create. After that, `path` is **sticky** — `updateDocument` and `updateDocumentWithPatches` never re-derive. The previous version's `path` carries forward unchanged unless the caller supplies an explicit `params.path`. This protects inbound links and SEO from a title-edit accidentally invalidating a URL. The path widget surfaces a "Regenerate from {sourceField}" action for explicit re-anchoring.

### Default-locale enforcement on first create

A brand-new document MUST be created in the configured default content locale (`ServerConfig.i18n.content.defaultLocale`). Creating in any other locale throws `ERR_VALIDATION`. Subsequent localised versions of the same document inherit the existing `path` automatically — it never re-derives, regardless of locale.

## The slugifier

`packages/core/src/utils/slugify.ts`. Pure, synchronous, Unicode-aware (NFC), Thai-script preserving (`U+0E00–U+0E7F`), HTML-stripping. Recognises ISO 8601 date prefixes and returns `yyyy-mm-dd` rather than slugifying the time portion. Exported as `slugify`, `formatTextValue`, `looksLikeISODate` plus the `SlugifierFn` / `SlugifyContext` types.

The slugifier is intentionally trivial to swap. Installations with strict URL or security policies can supply their own `(value, ctx) => string` on `ServerConfig.slugifier`. The contract is **sync + pure** because the same function runs server-side at write time and client-side in the path widget for live preview — the two must agree.

## Lifecycle wiring

`packages/core/src/services/document-lifecycle.ts` carries the `derivePath` helper (private to the module) and threads `defaultLocale` + optional `slugifier` through `DocumentLifecycleContext`. All callers — admin server fns, the client SDK's `CollectionHandle.create/update`, and the upload service — populate these fields explicitly from `ServerConfig`.

`createDocument` enforces the default-locale rule and runs the derivation cascade. `updateDocument` and `updateDocumentWithPatches` are sticky. All three accept an optional `params.path` for explicit override.

## Validation

`packages/core/src/config/validate-collections.ts` runs at config load time. It walks every collection's field tree (recursively into group, array, and blocks fields) and rejects any field named `path`. If `useAsPath` is set, it asserts the named field exists and is of a slug-compatible type.

The reserved name set is exported as `RESERVED_FIELD_NAMES` so the storage layer can consume it.

## Storage tolerance for legacy data

`restoreFieldSetData` in `packages/db-postgres/src/modules/storage/storage-utils.ts` silently skips rows whose `field_name` is in `RESERVED_FIELD_NAMES`. This is the data-drift tolerance for documents written before the migration — their `store_text` rows for `path` are inert, never reach the schema-walking lookup, and don't trigger the "field not found" warning that would normally be promoted to a `BylineError`.

The orphan rows are harmless and left in place. A one-shot cleanup is available but optional:

```sql
DELETE FROM store_text WHERE field_name = 'path';
```

## The path widget

`packages/ui/src/forms/path-widget.tsx`. Rendered in the form sidebar, conceptually grouped with status and timestamps — `path` is identity metadata, not per-locale content.

- Reads `useFieldValue(useAsPath)` to track the source field live.
- Computes `livePreview = slugify(sourceValue)` using the same slugifier the server will apply.
- Subscribes to a new `systemPath` slot on form context (`useSystemPath()`).

Behaviour:

- **Edit mode** — input shows the persisted `documentVersions.path` by default. Editing writes a string override into the slot; clearing reverts to `null` (sticky from the previous version on save).
- **Create mode** — input is empty by default; placeholder shows the live-derived preview (`Will be saved as "..."`).
- **"Regenerate from {source}" action** — small text-style link rendered right-aligned to the label when `livePreview !== systemPath`. Clicking writes the live preview into the override slot. Used to re-anchor a stale path against an updated title.
- **Live validation hint** — typed values are slugified for comparison; if the typed value differs from its slugified form, an inline `Suggested: "..."` hint surfaces without blocking input.

The widget bypasses the patch system. The `systemPath` slot on form context (`getSystemPath`, `setSystemPath`, `subscribeSystemPath`) is initialised from `initialData.path` on mount, tracked in dirty state, reset on form save, and threaded into the `onSubmit({ data, patches, systemPath })` payload that `FormRenderer` emits.

## Server transport

Admin server fns under `packages/host-tanstack-start/src/server-fns/collections/{create,update}.ts` accept an optional top-level `path` on the request payload (separate from `data`) and forward it as `params.path` to the lifecycle. This mirrors the precedent set by `setDocumentStatus`: system metadata is addressed via dedicated parameters, not field patches.

The `@byline/client` SDK exposes the same: `CreateOptions.path` and `UpdateOptions.path` on `CollectionHandle.create/update`.

## Patches stay admin-internal

`path` is **not** addressable via `field.*` / `array.*` / `block.*` patches — it is system metadata, parallel to `status`. The widget writes to the separate `systemPath` slot; the submit payload sends it as a top-level field. This keeps the patch system aligned with UI intent (reordering, block insertion, field-level changes) and keeps system metadata out of the patch grammar.

## Future phases of work

The current model deliberately doesn't address two things. Both are deferred until a real workload forces the question.

### Phase — path uniqueness

Reserving the name doesn't prevent two `pages` documents from both having `path = 'about'`. A partial unique index on `(collection_id, path)` is committed-out at `packages/db-postgres/src/database/schema/index.ts` ready to be enabled, but it needs a collision-handling policy (reject vs. auto-suffix) before it can ship. Plan separately before preview-link UX lands, because preview links implicitly rely on "path uniquely identifies a document within a collection."

### Phase — per-collection slugifier override

Add when a real need surfaces — for example a media collection that wants to preserve filename extensions. The plumbing point is well-defined: `useAsPath: { source, formatter }` would be the natural shape, with the per-collection formatter taking precedence over `ServerConfig.slugifier`.

### Phase — per-locale paths (the larger one)

The current rule — one `path` per document, derived in the default content locale — is a deliberate simplification, not a structural limit. From a pure web-resource perspective it is technically correct: a document has one canonical resource identifier, and locale-prefixed variants (`/en/about`, `/de/ueber-uns`) are presentation/routing concerns expressed via `<link rel="alternate">` and equivalent. Most sites need nothing more.

If a future consumer requires genuinely localised paths — distinct slugs per language, indexed independently, addressable via `findByPath('ueber-uns', { locale: 'de' })` — the cleanest path forward is **a new `document_paths` table**, not extending the existing column or pushing path back into the EAV.

#### Why a side table — the EAV strategy is not available here

Per-locale storage in Byline today comes for free in the `store_*` tables: every row carries a `locale` column, and `flattenFieldSetData` / `restoreFieldSetData` resolve the right one at read time. That mechanism applies to **fields** — values that live in the EAV layer. Because `path` is a first-class scalar column on `documentVersions` (not an EAV field), the existing per-locale storage strategy is unavailable. There is no `locale` column on `documentVersions` to discriminate by, and the field-level flatten/reconstruct pipeline never sees the column.

A dedicated table is the natural fit and brings two further benefits:

- **Indexed lookup.** The current `WHERE collection_id = ? AND path = ?` on an indexed scalar column is the cheapest path-resolution primitive in the system. A `document_paths` table preserves that shape, just keyed by `(collection_id, locale, path)` instead.
- **Uniqueness.** Per-locale uniqueness on `(collection_id, locale, path)` is straightforward on a dedicated table — a single composite unique index. Achieving the same on `store_text` would require a partial index keyed by `field_name = 'path'`, conflating routing invariants with content storage.

#### Sketch of the proposed table

```ts
export const documentPaths = pgTable(
  'document_paths',
  {
    document_version_id: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    collection_id: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 10 }).notNull(),
    path: varchar('path', { length: 255 }).notNull(),
    created_at: timestamp('created_at').defaultNow(),
    updated_at: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    // One path per (version, locale) — a version cannot have two paths
    // in the same language.
    unique().on(table.document_version_id, table.locale),
    // Per-collection uniqueness scoped by locale, for path resolution.
    index('idx_document_paths_collection_locale_path').on(
      table.collection_id,
      table.locale,
      table.path
    ),
  ]
)
```

The current `documentVersions.path` column would either:

- **Stay as the canonical / default-locale path** — a denormalised copy of the default-locale row from `document_paths`, kept in sync by the lifecycle. Existing indexed lookups continue to work; the table is consulted only when a non-default locale is requested. Lower-risk migration.
- Or be **dropped entirely**, making `document_paths` the sole source. Cleaner conceptually but a bigger refactor of the views, the `findByPath` adapter method, and every consumer that reads `path` directly off a row.

#### Lifecycle implications

- `createDocument` would still enforce default-locale-first creation, but on first create write a single `document_paths` row for the default locale. Subsequent localised updates could supply `paths: { de: 'ueber-uns', fr: 'a-propos' }` to add per-locale variants.
- `updateDocument` would gain a `paths?: Record<string, string>` parameter alongside the existing `path?: string` — the latter would write the default-locale row, the former any subset of locales.
- The widget would need a per-locale layout (probably a small table or the existing locale-tab pattern from regular fields) rather than a single text input.
- Default-locale enforcement on first create stays unchanged: the default-locale path is the document's identity anchor; localised paths are additive.

#### Why this is a future phase, not a current plan

No real consumer needs this today. The current design supports multilingual content (every other field can be localised) and multilingual routing (a frontend can prefix `/{locale}/{path}` without any CMS-side change). The wrinkle is only sites that want **translated slugs** as a CMS concern, and that's a niche requirement worth deferring until someone asks. The structural answer is on file: a side table, not EAV.

### Phase — stable HTTP transport for `path`

The widget currently posts through TanStack Start server functions. Once Byline introduces a stable HTTP boundary (see [ROUTING-API.md](./ROUTING-API.md)), `path` will need a defined wire shape — likely the same top-level field the server functions already accept. Trivial work that will fall out naturally from the broader transport-design pass.

## Code map

| Concern                                             | Location                                                                  |
|-----------------------------------------------------|---------------------------------------------------------------------------|
| Default slugifier + types                           | `packages/core/src/utils/slugify.ts`                                      |
| `useAsPath` on `CollectionDefinition`               | `packages/core/src/@types/collection-types.ts`                            |
| `slugifier` on `ServerConfig`                       | `packages/core/src/@types/site-config.ts`                                 |
| Reserved-name + `useAsPath` validation              | `packages/core/src/config/validate-collections.ts`                        |
| Lifecycle derivation + sticky update + locale check | `packages/core/src/services/document-lifecycle.ts`                        |
| Storage tolerance for orphan rows                   | `packages/db-postgres/src/modules/storage/storage-utils.ts`               |
| Client SDK options                                  | `packages/client/src/{types,collection-handle}.ts`                        |
| Admin server fns accept `path`                      | `packages/host-tanstack-start/src/server-fns/collections/{create,update}.ts` |
| Form context `systemPath` slot                      | `packages/ui/src/forms/form-context.tsx`                                  |
| Path widget (sidebar)                               | `packages/ui/src/forms/path-widget.tsx`                                   |
| Form rendering integration                          | `packages/ui/src/forms/form-renderer.tsx`                                 |
| Reference collections using `useAsPath`             | `apps/webapp/byline/collections/{pages,news,docs,categories}/schema.ts`   |
