---
title: "Document Paths"
path: "document-paths"
summary: "How byline_document_paths keys (document_id, locale) → path, why path lives outside the EAV stores, and how the slugifier resolves uniqueness on create and update."
---

# Document Paths

Companions:
- [CORE-DOCUMENT-STORAGE.md](./CORE-DOCUMENT-STORAGE.md) — `path` was the first system attribute promoted out of the EAV layer; it now lives in a dedicated `byline_document_paths` table keyed by `(document_id, locale)`, separate from `documentVersions`.
- [RELATIONSHIPS.md](./RELATIONSHIPS.md) — `path` is the routing identifier used by relation filters (`where: { category: { path: 'news' } }`) and resolved via `findByPath` under the same `readMode` rule populate honours, with locale fallback applied per request.
- [COLLECTIONS.md](./COLLECTIONS.md) — `useAsPath` participates in the collection schema fingerprint (see the Fingerprint section).

## Overview

`path` is a reserved system attribute. It is the routing primitive that resolves a URL path back to a document — the cheapest path-resolution lookup in the system, used by `findByPath` and by relation filters. Storage lives in a dedicated `byline_document_paths` table keyed by `(document_id, locale)` with a unique constraint on `(collection_id, locale, path)`. See [Path uniqueness — shipped](#path-uniqueness--shipped) below for the full schema and lifecycle behaviour.

Three rules anchor the model:

1. **`path` is reserved.** No collection field may be named `path`, at any nesting depth (group, array, blocks). Validation runs at config load and throws.
2. **`useAsPath?: string`** on `CollectionDefinition` names the source field whose slugified (URL safe) value initialises a document's `path` row. Parallel to `useAsTitle`. The named field must exist at the top level and be of a path-compatible type (`text`, `textArea`, `select`, `date`, `datetime`, `time`).
3. **One canonical resource identifier per document, per locale.** Phase 1 only writes the default-locale row; localised slugs (`/en/about` vs `/de/ueber-uns`) are deferred to the per-locale-paths phase below. Frontends can still serve multilingual content today by prefixing `/{locale}/{path}` over the single canonical path with no CMS-side change.

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
  path: 'new-canonical-slug',    // ← only honoured on default-locale writes
})
```

On a non-default-locale (translation) update, `path` is dropped silently with a `logger.warn` — phase 1 paths are default-locale-territory.

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

→ [Path uniqueness — shipped](#path-uniqueness--shipped)

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

`packages/core/src/services/document-lifecycle.ts` carries the `derivePath` helper (private to the module) and threads `defaultLocale` + optional `slugifier` through `DocumentLifecycleContext`. All callers — admin server fns, the client SDK's `CollectionHandle.create/update`, and the upload service — populate these fields explicitly from `ServerConfig`.

`createDocument` enforces the default-locale rule and runs the derivation cascade, then the storage primitive's `createDocumentVersion` upserts the corresponding row in `byline_document_paths`. `updateDocument` and `updateDocumentWithPatches` are sticky: when no `params.path` is supplied the path row is left untouched (no DB write), and when a `path` is supplied on a non-default-locale (translation) save it is dropped silently with a `logger.warn` rather than overwriting the default-locale row. All three accept an optional `params.path` for explicit override on default-locale operations.

Two helpers in the lifecycle module own this policy:

- `resolvePathForUpdate` — decides whether the storage primitive should receive a `path` argument (default-locale write) or be called without one (translation save), and emits the warn log when it drops a translation-locale change.
- `rethrowPathConflict` — catches the underlying Postgres unique-violation on `idx_document_paths_collection_locale_path` (SQLSTATE `23505`) and translates it to `ERR_PATH_CONFLICT`. Walks the Drizzle / pg cause chain so wrapped errors are still detected.

## Validation

`packages/core/src/config/validate-collections.ts` runs at config load time. It walks every collection's field tree (recursively into group, array, and blocks fields) and rejects any field named `path`. If `useAsPath` is set, it asserts the named field exists and is of a slugifier-compatible type.

The reserved name set is exported as `RESERVED_FIELD_NAMES` so the storage layer can consume it.

## The path widget

`packages/ui/src/forms/path-widget.tsx`. Rendered in the form sidebar, conceptually grouped with status and timestamps — `path` is identity metadata, not per-locale content.

- Reads `useFieldValue(useAsPath)` to track the source field live.
- Computes `livePreview = slugify(sourceValue)` using the same slugifier the server will apply.
- Subscribes to a new `systemPath` slot on form context (`useSystemPath()`).

Behaviour:

- **Edit mode** — input shows the persisted `byline_document_paths` row for the editing locale (resolved via the same `[requested, default]` fallback chain reads use). Editing writes a string override into the slot; clearing reverts to `null` (sticky from the previous version on save). When editing a translation, the input renders read-only — phase 1 paths are default-locale-territory, and the read-only state prevents the lifecycle's translation-locale warn from being hit through the admin form.
- **Create mode** — input is empty by default; placeholder shows the live-derived preview (`Will be saved as "..."`).
- **"Regenerate from {source}" action** — small text-style link rendered right-aligned to the label when `livePreview !== systemPath`. Clicking writes the live preview into the override slot. Used to re-anchor a stale path against an updated title.
- **Live validation hint** — typed values are slugified for comparison; if the typed value differs from its slugified form, an inline `Suggested: "..."` hint surfaces without blocking input.

The widget bypasses the patch system. The `systemPath` slot on form context (`getSystemPath`, `setSystemPath`, `subscribeSystemPath`) is initialised from `initialData.path` on mount, tracked in dirty state, reset on form save, and threaded into the `onSubmit(...)` payload that `FormRenderer` emits.

On an existing document, a path edit in the admin is a **document-grain, non-versioned write**: `path` lives in `byline_document_paths` keyed by logical document (sticky across versions), so editing it does not mint a new version or reset workflow status. `FormRenderer` partitions its dirty state (`getDirtyBreakdown()` → `none` / `content` / `direct-write` / `both`), confirms the immediate write with a modal, and persists `path` through the dedicated non-versioned write path below. On **create**, `path` is still part of the initial version write. See [I18N.md](./I18N.md) for the shared design (the available-locales widget works the same way).

## Server transport

The **create** server fn (`.../collections/create.ts`) accepts an optional top-level `path` on the request payload (separate from `data`) and forwards it as `params.path` to the lifecycle — on create, `path` is part of the initial version write. **Editing** an existing document's `path` in the admin no longer rides the versioned update: it routes through a dedicated `updateCollectionDocumentSystemFields` server fn → `updateDocumentSystemFields` lifecycle service → `updateDocumentPath` storage command — an immediate write that mints no version and leaves status untouched. (`updateCollectionDocumentWithPatches` no longer carries `path`.) This still mirrors the `setDocumentStatus` precedent: system metadata is addressed via dedicated parameters, not field patches.

The `@byline/client` SDK exposes `CreateOptions.path` and `UpdateOptions.path` on `CollectionHandle.create/update`. Note the SDK's whole-document `update` still writes `path` as part of its version (path is one parameter of a deliberate version write); the non-versioned direct write is the interactive admin-editor affordance.

## Patches stay admin-internal

`path` is **not** addressable via `field.*` / `array.*` / `block.*` patches — it is system metadata, parallel to `status`. The widget writes to the separate `systemPath` slot; the submit payload sends it as a top-level field. This keeps the patch system aligned with UI intent (reordering, block insertion, field-level changes) and keeps system metadata out of the patch grammar.

## Path uniqueness — shipped

Per-collection path uniqueness is enforced at the database level via a dedicated `byline_document_paths` table. The version-level `documentVersions.path` column has been retired. The new model:

```ts
byline_document_paths
  document_id   uuid    } composite primary key
  locale        varchar }
  collection_id uuid
  path          varchar(255)
  UNIQUE (collection_id, locale, path)
```

One row per logical document per content locale; the `(collection_id, locale, path)` unique index is what enforces the invariant that no two documents in the same collection share a path within the same locale. Locale is modelled from day one even though phase 1 only ever writes the default-locale row — the column is present so the per-locale-paths phase below is purely additive.

### Lifecycle behaviour

- **Create** — `createDocument` enforces "first create must be in the default content locale" (existing rule), then writes the path row keyed by `(document_id, defaultContentLocale)`. Collisions surface as `ERR_PATH_CONFLICT`.
- **Update in default locale** — `updateDocument` upserts the path row when an explicit `params.path` is supplied. Sticky: if no `path` is supplied, the existing row carries forward unchanged (no DB write). Collisions surface as `ERR_PATH_CONFLICT`.
- **Update in a non-default (translation) locale** — path changes are dropped silently with a `logger.warn`; the existing default-locale row is left untouched. Phase 1 deliberately keeps paths default-locale-territory; the path widget is read-only when editing a translation. Phase 2 (per-locale paths UI) lifts this restriction.
- **Restore** — never changes a document's path. `restoreDocumentVersion` does not pass `path` to the storage primitive; the existing `byline_document_paths` row is preserved.

### Collision policy

**Reject by default**, surfaced as `ERR_PATH_CONFLICT` from the lifecycle layer. The storage adapter's `createDocumentVersion` performs an upsert keyed by `(document_id, locale)`, so re-saving the same path for the *same* document is idempotent; only collisions across different documents trigger the error. Auto-suffixing is intentionally not implemented — silent rename is footgun-shaped, and seeders / bulk imports can pre-resolve uniqueness in caller code if they need to.

### Read-side locale resolution

Reads compose a fallback chain `[requested, default]`, deduplicated when both values match. `findByPath` resolves `(collection_id, path, locale-chain)` to a `document_id` via a single subquery using `array_position` for priority ordering — never a double round-trip. Projection helpers (`pathProjection`, `viewProjection`, `documentVersionsProjection`) attach the locale-resolved path to every read result; the relation-filter compiler does the same for nested target documents. The `current_*` views deliberately do **not** project `path` — locale is request-scoped and lives in the storage adapter's read functions, not in static view DDL.

### Where the default-locale value comes from

`pgAdapter()` takes a `defaultContentLocale: string` parameter, threaded from `ServerConfig.i18n.content.defaultLocale`. The storage adapter uses this when writing path rows on default-locale operations and as the fallback in the read-side locale chain. `@byline/client` resolves the same value (from explicit config, the supplied `ServerConfig`, or `'en'` as a last-resort fallback for tests / migration scripts) and applies it as the implicit default for `locale` on every read method.

## Future phases of work

The current model deliberately doesn't address two things. Both are deferred until a real workload forces the question.

### Phase — per-collection slugifier override

Add when a real need surfaces — for example a media collection that wants to preserve filename extensions. The plumbing point is well-defined: `useAsPath: { source, formatter }` would be the natural shape, with the per-collection formatter taking precedence over `ServerConfig.slugifier`.

### Phase — per-locale paths (translated paths)

The current rule — one `path` per document, written under the installation's default content locale — is a deliberate simplification, not a structural limit. From a pure web-resource perspective it is technically correct: a document has one canonical resource identifier, and locale-prefixed variants (`/en/about`, `/de/ueber-uns`) are presentation/routing concerns expressed via `<link rel="alternate">` and equivalent. Most sites need nothing more.

The phase-2 change is **purely additive** — the `byline_document_paths` schema is already locale-keyed, so flipping on per-locale support means *writing additional rows*, not reshaping the table.

#### What's already in place

The shipped phase-1 schema is locale-ready:

```ts
byline_document_paths
  document_id   uuid    } composite primary key
  locale        varchar(10) }
  collection_id uuid
  path          varchar(255)
  UNIQUE (collection_id, locale, path)
```

The reads already resolve through a `[requested, default]` priority chain — a `'de'` request that has no `'de'` row falls through to the `'en'` (default) row. Phase 2 adds the *write* side without touching the read pipeline.

#### Lifecycle changes for phase 2

- **`createDocument`** — still enforces default-locale-first creation; writes the default-locale row exactly as today. Optionally accepts a `paths?: Record<string, string>` payload to bulk-write additional locale rows on first save.
- **`updateDocument` in a non-default locale** — instead of dropping the supplied path with a warn (the phase-1 behaviour), upserts a row keyed by the request locale. The unique constraint on `(collection_id, locale, path)` still applies per-locale.
- **Path widget** — gains a per-locale layout: either a small table of locale → path pairs, or a per-locale tab pattern matching how localised regular fields are edited. The widget surfaces the live-preview slugifier per locale, plus the existing `Suggested:` hint.
- **Read-side fallback policy** — already in place; admin reads explicitly opt out of fallback (`locale` enforced strict) when editing a translation so you can see whether a row exists for that locale or whether the read is falling through.
- **Write-side hook contexts** — **must be revisited.** As of v3.1.0 the write-side collection hooks (`afterCreate`, `afterUpdate`, before/after `statusChange`, before/after `unpublish`, before/after `delete`) carry a single `path: string` — the **canonical (source-locale) slug**, resolved by `IDocumentQueries.getCurrentPath` with `requestedLocale: undefined` (so it reads the row under the document's `source_locale`). That is the only path row a document has today, so the value is unambiguous. Once per-locale paths land, a document will hold multiple slugs and a single canonical `path` is no longer sufficient for consumers that purge/invalidate **per localised URL**. At that point the hook contexts need enriching to either (a) carry the locale each path was derived from/retrieved under alongside the slug, or (b) expose the full `locale → path` map. `getCurrentPath` would gain a locale-aware sibling (or return the set). The document-grain contexts (`statusChange` / `unpublish` / `delete`) also carry **no locale** today and would need one. Keep the existing `path` field for backward compatibility (canonical slug) and add the locale-aware surface additively. See `CACHING.md` for how consumers use `ctx.path`.

#### Why this is a future phase, not a current plan

No real consumer needs this today. The current design supports multilingual content (every other field can be localised) and multilingual routing (a frontend can prefix `/{locale}/{path}` without any CMS-side change). The wrinkle is only sites that want **translated paths** as a CMS concern, and that's a niche requirement worth deferring until someone asks. The structural answer is on file and the schema is ready: phase 2 is widget UX, lifecycle write-side, and a small set of admin server fns — no migrations.

### Phase — stable HTTP transport for `path`

The widget currently posts through TanStack Start server functions. Once Byline introduces a stable HTTP boundary (see [ROUTING-API.md](./ROUTING-API.md)), `path` will need a defined wire shape — likely the same top-level field the server functions already accept. Trivial work that will fall out naturally from the broader transport-design pass.

## Code map

| Concern                                             | Location                                                                  |
|-----------------------------------------------------|---------------------------------------------------------------------------|
| Default slugifier + types                           | `packages/core/src/utils/slugify.ts`                                      |
| `useAsPath` on `CollectionDefinition`               | `packages/core/src/@types/collection-types.ts`                            |
| `slugifier` on `ServerConfig`                       | `packages/core/src/@types/site-config.ts`                                 |
| Reserved-name + `useAsPath` validation              | `packages/core/src/config/validate-collections.ts`                        |
| Lifecycle derivation + sticky update + locale rules | `packages/core/src/services/document-lifecycle.ts`                        |
| `ERR_PATH_CONFLICT` error type                      | `packages/core/src/lib/errors.ts`                                         |
| `byline_document_paths` schema                      | `packages/db-postgres/src/database/schema/index.ts`                       |
| Storage adapter — locale-aware path resolution      | `packages/db-postgres/src/modules/storage/storage-queries.ts` (`pathProjection`, `resolveDocumentIdByPath`, `viewProjection`) |
| Storage adapter — path upsert on write              | `packages/db-postgres/src/modules/storage/storage-commands.ts` (`createDocumentVersion`) |
| Adapter `defaultContentLocale` plumbing             | `packages/db-postgres/src/index.ts` (`pgAdapter`)                         |
| Client SDK options + locale defaults                | `packages/client/src/{types,collection-handle,client}.ts`                 |
| Admin server fns accept `path`                      | `packages/host-tanstack-start/src/server-fns/collections/{create,update}.ts` |
| Form context `systemPath` slot                      | `packages/ui/src/forms/form-context.tsx`                                  |
| Path widget (sidebar)                               | `packages/ui/src/forms/path-widget.tsx`                                   |
| Form rendering integration                          | `packages/ui/src/forms/form-renderer.tsx`                                 |
| Integration tests (collision, upsert, fallback)     | `packages/db-postgres/src/modules/storage/tests/storage-document-paths.test.ts` |
| Lifecycle tests (warn, conflict translation)        | `packages/core/src/services/document-lifecycle.test.node.ts`              |
| Reference collections using `useAsPath`             | `apps/webapp/byline/collections/{pages,news,docs,categories}/schema.ts`   |
