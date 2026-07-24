---
title: "Document Paths"
path: "document-paths"
summary: "How byline_document_paths keys (document_id, locale) → path, why path lives outside the EAV stores, and how the slugifier resolves uniqueness on create and update."
---

# Document Paths

Companions:
- [Document Storage](../03-architecture/01-document-storage.md) — `path` was the first system attribute promoted out of the EAV layer; it now lives in a dedicated `byline_document_paths` table keyed by `(document_id, locale)`, separate from `documentVersions`.
- [Relationships](./03-relationships.md) — `path` is the routing identifier used by relation filters (`where: { category: { path: 'news' } }`) and resolved via `findByPath` under the same `readMode` rule populate honours, with locale fallback applied per request.
- [Collections](./index.md) — `useAsPath` participates in the collection schema fingerprint (see the Fingerprint section).

## Overview

A document's **path** is its stable, human-readable address — the slug you put in a URL, such as `launch-2026`. It is a reserved system attribute and the cheapest path-resolution lookup in the system, used by `findByPath` and by relation filters. Storage lives in a dedicated `byline_document_paths` table keyed by `(document_id, locale)` with a unique constraint on `(collection_id, locale, path)`. See [Path uniqueness](#path-uniqueness) below for the full schema and lifecycle behaviour.

Read this document when you are choosing which field drives a collection's URLs, overriding a slug from a seed or import, or handling a path collision.

Three rules anchor the model:

1. **`path` is reserved.** No collection field may be named `path`, at any nesting depth (group, array, blocks). Validation runs at config load and throws.
2. **`useAsPath?: string`** on `CollectionDefinition` names the source field whose slugified (URL safe) value initialises a document's `path` row. Parallel to `useAsTitle`. The named field must exist at the top level and be of a path-compatible type (`text`, `textArea`, `select`, `date`, `datetime`, `time`).
3. **One canonical resource identifier per document.** It is stored under the document's `sourceLocale` (the default content locale on create); localised slugs (`/en/about` vs `/de/ueber-uns`) are deferred. Frontends can still prefix `/{locale}/{path}` over the single canonical path.

This work was the first time a system attribute was promoted out of the user-defined field tree. It establishes a pattern for any future "system metadata that needs editing in the admin form": reserve the name, expose it via a directive, render it through a non-field widget, and persist it via a top-level lifecycle parameter — not a `field.set` patch.

---

## Quick reference

Each entry is the minimal shape for one task. The "Edit" line tells you which file you actually change; the link at the end points at the deeper section.

### 1. Set `useAsPath` on a collection

Name the field whose slugified value initialises a document's `path` on first create. Must be a top-level field of a path-compatible type (`text`, `textArea`, `select`, `date`, `datetime`, `time`).

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
export const News = defineCollection({
  path: 'news',
  useAsTitle: 'title',
  useAsPath: 'title',           // ← slugified from `title` on first create
  fields: [
    { name: 'title', type: 'text', localized: true },
    /* … */
  ],
})
```

`path` is sticky after creation — subsequent saves don't re-derive. Editors can re-anchor explicitly via the path widget's "Regenerate from {source}" action.

→ [Derivation cascade](#derivation-cascade)

### 2. Override `path` explicitly on create or update

Both `CollectionHandle.create` and `CollectionHandle.update` accept a top-level `path` parameter (separate from `data`). Useful for seeds, imports, and any caller that needs a specific URL slug.

**Edit:** any write call site — typically a seed under `apps/webapp/byline/seeds/` or a one-off script.

```ts
await client.collection('news').create({
  data: { title: 'Launch announcement' },
  path: 'launch-2026',           // ← overrides the useAsPath derivation
  locale: 'en',
})

await client.collection('news').update(id, {
  data: { title: 'Revised title' },
  path: 'new-canonical-slug',    // ← only honoured on source-locale writes
})
```

On a non-source-locale (translation) update, `path` is dropped silently with a `logger.warn` — the canonical path belongs to the document's source locale.

→ [Lifecycle wiring](#lifecycle-wiring)

### 3. Install a custom slugifier

The default slugifier is pure, sync, Unicode-aware (NFC), CJK-preserving, and recognises ISO 8601 date prefixes. Override site-wide if you need stricter URL policies, a different transliteration, or a domain-specific format. The contract is **sync + pure** because the same function runs server-side at write time and client-side in the path widget's live preview — the two must agree.

**Edit:** `apps/webapp/byline/server.config.ts`

```ts
import type { SlugifierFn } from '@byline/core'

const myStrictSlugifier: SlugifierFn = (value, _ctx) => {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

await initBylineCore({
  // …db, collections, storage, sessionProvider, adminStore, …
  slugifier: myStrictSlugifier,
})
```

→ [The slugifier](#the-slugifier)

### 4. Handle `ERR_PATH_CONFLICT`

Per-collection path uniqueness is enforced at the database level via a unique index on `(collection_id, locale, path)`. Collisions across different documents surface as `ERR_PATH_CONFLICT` from the lifecycle layer; re-saving the same path for the *same* document is idempotent.

**Edit:** any write call site that surfaces user-supplied paths.

```ts
import { BylineError, ErrorCodes } from '@byline/core'

try {
  await client.collection('news').update(id, {
    data: { title },
    path: requestedPath,
  })
} catch (err) {
  if (err instanceof BylineError && err.code === ErrorCodes.PATH_CONFLICT) {
    return { error: `The slug "${requestedPath}" is already in use.` }
  }
  throw err
}
```

Auto-suffixing is intentionally not implemented — silent rename is footgun-shaped. Seeders / bulk imports can pre-resolve uniqueness in caller code if they need to.

→ [Path uniqueness](#path-uniqueness)

---

## Derivation cascade

`createDocument` runs three derivation steps in order:

1. **Explicit `params.path`** from the caller → used verbatim.
2. **`definition.useAsPath` set** → slugify (make URL safe) the source field's value in the **default content locale** using the installation slugifier.
3. **Otherwise** → `crypto.randomUUID()`.

The cascade applies only on first create. After that, `path` is **sticky** — `updateDocument` and `updateDocumentWithPatches` never re-derive. The previous version's `path` carries forward unchanged unless the caller supplies an explicit `params.path`. This protects inbound links and SEO from a title-edit accidentally invalidating a URL. The path widget surfaces a "Regenerate from {sourceField}" action for explicit re-anchoring.

### Default-locale enforcement on first create

A brand-new document MUST be created in the configured default content locale (`ServerConfig.i18n.content.defaultLocale`). Creating in any other locale throws `ERR_VALIDATION`. Subsequent localised versions of the same document inherit the existing `path` automatically — it never re-derives, regardless of locale.

## The slugifier

`packages/core/src/utils/slugify.ts`. Pure, synchronous, Unicode-aware (NFC), Thai-script and CJK preserving, HTML-stripping. Recognises ISO 8601 date prefixes and returns `yyyy-mm-dd` rather than slugifying the time portion. Exported as `slugify`, `formatTextValue`, `looksLikeISODate` plus the `SlugifierFn` / `SlugifyContext` types.

The slugifier is intentionally trivial to swap. Installations with strict URL or security policies can supply their own `(value, ctx) => string` on `ServerConfig.slugifier`. The contract is **sync + pure** because the same function runs server-side at write time and client-side in the path widget for live preview — the two must agree.

## Lifecycle wiring

`packages/core/src/services/document-lifecycle/internals.ts` carries the `derivePath` helper (shared by the create / duplicate operation modules, not exported from the package) and `context.ts` threads `defaultLocale` + optional `slugifier` through `DocumentLifecycleContext`. All callers — admin server fns, the client SDK's `CollectionHandle.create/update`, and the upload service — populate these fields explicitly from `ServerConfig`.

`createDocument` enforces the default-locale rule and runs the derivation cascade, then the storage primitive's `createDocumentVersion` upserts the corresponding row in `byline_document_paths`. `updateDocument` and `updateDocumentWithPatches` are sticky: when no `params.path` is supplied the path row is left untouched (no DB write), and when a `path` is supplied on a non-source-locale (translation) save it is dropped silently with a `logger.warn` rather than overwriting the source-locale row. All three accept an optional `params.path` for explicit override on source-locale operations.

The admin's dedicated direct-write service is stricter about change detection. Inside the audit transaction it locks the logical document and snapshots its authoritative source locale, path, and advertised locales. An unchanged path causes no storage write or audit row; a real change and its `document.path.changed` row commit together. Only after commit does `afterSystemFieldsChange` run, carrying `previousPath` and `currentPath` plus `requested`, `changed`, and `reconciliation` flags. A hook failure rejects the call but cannot roll back the committed path/audit.

Two helpers in the lifecycle module own this policy:

- `resolvePathForUpdate` — decides whether the storage primitive should receive a `path` argument (source-locale write) or be called without one (translation save), and emits the warn log when it drops a translation-locale change.
- `rethrowPathConflict` — catches the underlying Postgres unique-violation on `idx_document_paths_collection_locale_path` (SQLSTATE `23505`) and translates it to `ERR_PATH_CONFLICT`. Walks the Drizzle / pg cause chain so wrapped errors are still detected.

## Validation

`packages/core/src/config/validate-collections.ts` runs at config load time. It walks every collection's field tree (recursively into group, array, and blocks fields) and rejects any field named `path`. If `useAsPath` is set, it asserts the named field exists and is of a slugifier-compatible type.

The reserved name set is exported as `RESERVED_FIELD_NAMES` so the storage layer can consume it.

## The path widget

`packages/admin/src/forms/path-widget.tsx`. Rendered in the form sidebar, conceptually grouped with status and timestamps — `path` is identity metadata, not per-locale content.

- Reads `useFieldValue(useAsPath)` to track the source field live.
- Computes `livePreview = slugify(sourceValue)` using the same slugifier the server will apply.
- Subscribes to a new `systemPath` slot on form context (`useSystemPath()`).

Behaviour:

- **Edit mode** — input shows the persisted `byline_document_paths` row for the editing locale (resolved via the same `[requested, source]` fallback chain reads use). Editing writes a string override into the slot; clearing reverts to `null` (sticky from the previous version on save). When editing a translation, the input renders read-only — the canonical path belongs to the source locale, and the read-only state prevents the lifecycle's translation-locale warn from being hit through the admin form.
- **Create mode** — input is empty by default; placeholder shows the live-derived preview (`Will be saved as "..."`).
- **"Regenerate from {source}" action** — small text-style link rendered right-aligned to the label when `livePreview !== systemPath`. Clicking writes the live preview into the override slot. Used to re-anchor a stale path against an updated title.
- **Live validation hint** — typed values are slugified for comparison; if the typed value differs from its slugified form, an inline `Suggested: "..."` hint surfaces without blocking input.

The widget bypasses the patch system. The `systemPath` slot on form context (`getSystemPath`, `setSystemPath`, `subscribeSystemPath`) is initialised from `initialData.path` on mount, tracked in dirty state, reset on form save, and threaded into the `onSubmit(...)` payload that `FormRenderer` emits.

On an existing document, a path edit in the admin is a **document-level, non-versioned write**: `path` lives in `byline_document_paths` keyed by logical document (sticky across versions), so editing it does not mint a new version or reset workflow status. `FormRenderer` partitions its dirty state (`getDirtyBreakdown()` → `none` / `content` / `direct-write` / `both`), confirms the immediate write with a modal, and persists `path` through the dedicated non-versioned write path below. On **create**, `path` is still part of the initial version write. See [Internationalization](../07-internationalization/index.md) for the shared design (the available-locales widget works the same way).

## Server transport

The **create** server fn (`.../collections/create.ts`) accepts an optional top-level `path` on the request payload (separate from `data`) and forwards it as `params.path` to the lifecycle — on create, `path` is part of the initial version write. **Editing** an existing document's `path` in the admin no longer rides the versioned update: it routes through a dedicated `updateCollectionDocumentSystemFields` server fn → `updateDocumentSystemFields` lifecycle service → `updateDocumentPath` storage command — an immediate write that mints no version and leaves status untouched. (`updateCollectionDocumentWithPatches` no longer carries `path`.) This still mirrors the `setDocumentStatus` precedent: system metadata is addressed via dedicated parameters, not field patches.

The admin server fn passes `reconcile: true`. If an earlier `afterSystemFieldsChange` failed after commit, repeating the same save therefore re-emits the hook with `reconciliation: true` but performs no second path write or audit append. Reconciliation is explicit lifecycle behavior, not an automatic retry loop.

The `@byline/client` SDK exposes `CreateOptions.path` and `UpdateOptions.path` on `CollectionHandle.create/update`. Note the SDK's whole-document `update` still writes `path` as part of its version (path is one parameter of a deliberate version write); it fires `afterUpdate`, not `afterSystemFieldsChange`. The non-versioned event belongs to the interactive admin/direct-write affordance; create continues to fire `afterCreate`.

## Patches stay admin-internal

`path` is **not** addressable via `field.*` / `array.*` / `block.*` patches — it is system metadata, parallel to `status`. The widget writes to the separate `systemPath` slot; the submit payload sends it as a top-level field. This keeps the patch system aligned with UI intent (reordering, block insertion, field-level changes) and keeps system metadata out of the patch grammar.

## Path uniqueness

Per-collection path uniqueness is enforced at the database level via a dedicated `byline_document_paths` table. The version-level `documentVersions.path` column has been retired. The new model:

```ts
byline_document_paths
  document_id   uuid    } composite primary key
  locale        varchar }
  collection_id uuid
  path          varchar(255)
  UNIQUE (collection_id, locale, path)
```

One row per logical document per content locale; the `(collection_id, locale, path)` unique index is what enforces the invariant that no two documents in the same collection share a path within the same locale. Locale is modelled from day one even though the lifecycle writes only the document's source-locale row — the column is present so localized paths remain an additive future capability.

### Lifecycle behaviour

- **Create** — `createDocument` enforces "first create must be in the default content locale" (existing rule), then writes the path row keyed by `(document_id, defaultContentLocale)`. Collisions surface as `ERR_PATH_CONFLICT`.
- **Update in the source locale** — a versioned `updateDocument` upserts the path row when an explicit `params.path` is supplied. The admin direct-write path first compares the locked current value and skips an equal value. Sticky: if no non-empty `path` is supplied, the existing row carries forward unchanged. Collisions surface as `ERR_PATH_CONFLICT`.
- **Update in a non-source (translation) locale** — path changes are dropped silently with a `logger.warn`; the source-locale row is left untouched and the path widget is read-only. A future per-locale paths UI can lift this restriction.
- **Restore** — never changes a document's path. `restoreDocumentVersion` does not pass `path` to the storage primitive; the existing `byline_document_paths` row is preserved.

### Collision policy

**Reject by default**, surfaced as `ERR_PATH_CONFLICT` from the lifecycle layer. The storage adapter's `createDocumentVersion` performs an upsert keyed by `(document_id, locale)`, so re-saving the same path for the *same* document is idempotent; only collisions across different documents trigger the error. Auto-suffixing is intentionally not implemented — silent rename is footgun-shaped, and seeders / bulk imports can pre-resolve uniqueness in caller code if they need to.

### Read-side locale resolution

Once a document row is known, reads compose a fallback chain `[requested, source]`, deduplicated when both values match. The initial `findByPath` lookup cannot know that source locale yet, so it currently resolves `(collection_id, path)` against `[requested, configuredDefault]` via one subquery using `array_position` for priority ordering — never a double round-trip. Projection helpers (`pathProjection`, `viewProjection`, `documentVersionsProjection`) then attach source-aware locale-resolved paths to read results; the relation-filter compiler does the same for nested target documents. The `current_*` views deliberately do **not** project `path` — locale is request-scoped and lives in the storage adapter's read functions, not in static view DDL.

### Where the source-locale value comes from

`pgAdapter()` takes a `defaultContentLocale: string` parameter, threaded from `ServerConfig.i18n.content.defaultLocale`. New documents use this as their initial `sourceLocale`; existing documents resolve path writes and fallback against their own source locale (falling back to the configured default for legacy rows). `@byline/client` resolves the same value (from explicit config, the supplied `ServerConfig`, or `'en'` as a last-resort fallback for tests / migration scripts) and applies it as the implicit default for `locale` on every read method.

## Current limitations

- **One path per document, under its source locale.** Translated paths
  (a different slug per locale) are not yet a CMS concern. This is a deliberate
  simplification, not a structural limit — `byline_document_paths` is already
  locale-keyed and known-document projections resolve through a `[requested, source]` chain, so a
  frontend can route `/{locale}/{path}` today and per-locale slugs can be added
  additively later. Most sites need nothing more.
- **No per-collection slugifier override.** The slugifier is configured once on
  `ServerConfig`; a collection cannot yet supply its own (for example to preserve
  filename extensions on a media collection).

## Code map

| Concern                                             | Location                                                                  |
|-----------------------------------------------------|---------------------------------------------------------------------------|
| Default slugifier + types                           | `packages/core/src/utils/slugify.ts`                                      |
| `useAsPath` on `CollectionDefinition`               | `packages/core/src/@types/collection-types.ts`                            |
| `slugifier` on `ServerConfig`                       | `packages/core/src/@types/site-config.ts`                                 |
| Reserved-name + `useAsPath` validation              | `packages/core/src/config/validate-collections.ts`                        |
| Lifecycle derivation + sticky update + locale rules | `packages/core/src/services/document-lifecycle/` (`internals.ts`, `create.ts`, `update.ts`) |
| `ERR_PATH_CONFLICT` error type                      | `packages/core/src/lib/errors.ts`                                         |
| `byline_document_paths` schema                      | `packages/db-postgres/src/database/schema/index.ts`                       |
| Storage adapter — locale-aware path resolution      | `packages/db-postgres/src/modules/storage/storage-queries.ts` (`pathProjection`, `resolveDocumentIdByPath`, `viewProjection`) |
| Storage adapter — path upsert on write              | `packages/db-postgres/src/modules/storage/storage-commands.ts` (`createDocumentVersion`) |
| Adapter `defaultContentLocale` plumbing             | `packages/db-postgres/src/index.ts` (`pgAdapter`)                         |
| Client SDK options + locale defaults                | `packages/client/src/{types,collection-handle,client}.ts`                 |
| Admin server fns accept `path`                      | `packages/host-tanstack-start/src/server-fns/collections/{create,update}.ts` |
| Form context `systemPath` slot                      | `packages/admin/src/forms/form-context.tsx`                               |
| Path widget (sidebar)                               | `packages/admin/src/forms/path-widget.tsx`                                |
| Form rendering integration                          | `packages/admin/src/forms/form-renderer.tsx`                              |
| Integration tests (collision, upsert, fallback)     | `packages/db-conformance/src/suites/document-paths.ts`, run against Postgres via `packages/db-postgres/tests/conformance.integration.test.ts` |
| Lifecycle tests (warn, conflict translation)        | `packages/core/src/services/document-lifecycle.test.node.ts`              |
| Reference collections using `useAsPath`             | `apps/webapp/byline/collections/{pages,news,docs,news-categories}/schema.ts` |
