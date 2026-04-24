# Document Path — Analysis & Plan

> Last updated: 2026-04-22
> Companion to [STORAGE-ANALYSIS.md](./STORAGE-ANALYSIS.md) and
> [RELATIONSHIPS-ANALYSIS.md](./RELATIONSHIPS-ANALYSIS.md). Captures
> the design and rules around the `path` attribute on document
> versions — the routing primitive that resolves a URL slug back to a
> document.

This document explains how `path` is modelled, derived, validated,
edited, and stored in Byline today, and the constraints that fall
out of that model. It also documents the deferred design space for
per-locale paths, since that is the most likely future request and
the current model deliberately does not address it.

## Context

Until this work, `path` was defined twice:

1. As a `notNull()` column on `documentVersions`
   (`packages/db-postgres/src/database/schema/index.ts`), used by the
   `current_documents` and `current_published_documents` views and
   by the indexed lookup in `getDocumentByPath`.
2. As a user-defined `text` field declared in collection schemas
   (`pages`, `news`, `docs`, `categories`), each with a
   `formatSlug('title')` `beforeValidate` hook in
   `apps/webapp/byline/utilities/format-slug.ts`.

The two were loosely bridged by a hardcoded `data.path` lookup in
`document-lifecycle.ts`. Three concrete defects fell out of that:

1. **Two different slugifiers**. The field hook used a Unicode-aware
   formatter (`formatTextField`); the lifecycle used an inline ASCII
   regex. Identical input could produce different stored values in
   the column versus the EAV row.
2. **`useAsTitle` was ignored**. The lifecycle hardcoded `data.title`
   as the slug source. Collections that used a different identity
   field (e.g. `categories.name`) silently fell through to
   `crypto.randomUUID()`.
3. **No first-class status for path**. As preview links and SSR
   routing land, `path` is the routing primitive — treating it as
   just another text field undermined the indexed lookup, the
   per-collection uniqueness story, and the conceptual model.

The change shipped in this work: `path` is a reserved system
attribute on `documentVersions`. Collections opt in to derived
paths via a new `useAsPath` directive. The column value is computed
in core using a single, installation-wide slugifier. Editors retain
manual control via a system "path widget" rendered in the form
sidebar. Patches stay admin-internal; the path slot is a
lifecycle-level write field, parallel to `status`.

### Framing

This work was the first time a system attribute was promoted out of
the user-defined field tree. It was deliberately scoped to one
attribute (`path`) and one routing concern, but it establishes a
pattern for any future "system metadata that needs editing in the
admin form": reserve the name, expose it via a directive, render it
through a non-field widget, and persist it via a top-level lifecycle
parameter rather than a `field.set` patch.

---

## Resolved design decisions

1. **`path` is reserved**. No collection field may be named `path`,
   at any nesting depth (group, array, blocks). Validation runs in
   `defineServerConfig` / `defineClientConfig` and throws at startup.
2. **`useAsPath?: string`** on `CollectionDefinition` names the source
   field whose slugified value initialises `documentVersions.path`.
   Parallel to `useAsTitle`. The field must exist at the top level
   and be of a slug-compatible type (`text`, `textArea`, `select`,
   `date`, `datetime`, `time`).
3. **Derivation cascade** (`createDocument` only):
   1. Explicit `params.path` from the caller → used verbatim.
   2. `definition.useAsPath` set → slugify the source field's value
      in the **default content locale** using the installation
      slugifier.
   3. Otherwise → `crypto.randomUUID()`.
4. **Sticky after first save**. `updateDocument` and
   `updateDocumentWithPatches` never re-derive. The previous version's
   `path` carries forward unchanged unless the caller supplies an
   explicit `params.path`. The widget surfaces a "Regenerate from
   {sourceField}" action for explicit re-anchoring.
5. **Default-locale enforcement on first create**. A brand-new
   document MUST be created in the configured default content locale
   (`ServerConfig.i18n.content.defaultLocale`). Creating in any other
   locale throws `ERR_VALIDATION`. Subsequent localised versions of
   the same document inherit the existing `path` automatically (it
   never re-derives, regardless of locale).
6. **Single canonical resource identifier per document**. There is
   one `documentVersions.path` per version, full stop. Localised
   variants (`/en/about` vs `/de/ueber-uns`) are a routing concern,
   resolved outside the CMS, expressed via `<link rel="alternate">`
   and equivalent. See [Future: per-locale paths](#future-per-locale-paths)
   for the structural change required to relax this rule.
7. **Installation-wide slugifier**. `ServerConfig.slugifier` is an
   optional `SlugifierFn`; absent, the lifecycle and widget both fall
   back to the default `slugify` exported from `@byline/core`. Per-
   collection override is deferred until a real need emerges
   (e.g. media filename preservation).
8. **Editable path widget lives in the sidebar**. `path` is identity
   metadata, not per-locale content — grouped conceptually with
   status and timestamps. Rendered via a non-field widget that
   bypasses the patch system (`setSystemPath()` on form context →
   top-level `path` parameter to the server fn → `params.path` on
   the lifecycle).
9. **Patches stay admin-internal**. `path` is not addressable via
   `field.*` / `array.*` / `block.*` patches — it is system metadata.
   The widget writes to a separate `systemPath` slot on form context;
   the submit payload sends it as a top-level field, parallel to how
   status changes use `setDocumentStatus` rather than a patch.

---

## Architecture (what shipped)

### Slugifier

Lives in `packages/core/src/utils/slugify.ts`. Pure, synchronous,
Unicode-aware (NFC), Thai-script preserving (`U+0E00–U+0E7F`),
HTML-stripping. Recognises ISO 8601 date prefixes and returns
`yyyy-mm-dd` rather than slugifying the time portion. Exported as
`slugify`, `formatTextValue`, `looksLikeISODate` plus the
`SlugifierFn` / `SlugifyContext` types.

The slugifier is intentionally trivial to swap. Installations with
strict URL/security policies can supply their own
`(value, ctx) => string` on `ServerConfig.slugifier`. The contract
is sync + pure because the same function runs server-side at write
time and client-side in the path widget for live preview, and the
two must agree.

### Lifecycle

`packages/core/src/services/document-lifecycle.ts` carries the
`derivePath` helper (private to the module) and threads
`defaultLocale` + optional `slugifier` through the
`DocumentLifecycleContext`. All callers — admin server fns, the
client SDK's `CollectionHandle.create/update`, and the upload
service — populate these fields explicitly from `ServerConfig`.

`createDocument` enforces the default-locale rule and runs the
derivation cascade. `updateDocument` and
`updateDocumentWithPatches` are sticky. All three accept an optional
`params.path` for explicit override.

### Validation

`packages/core/src/config/validate-collections.ts` runs at config
load time. Walks every collection's field tree (recursively into
group, array, and blocks fields) and rejects any field named
`path`. If `useAsPath` is set, asserts the named field exists and
is of a slug-compatible type.

The reserved name set is exported as `RESERVED_FIELD_NAMES` so the
storage layer can consume it.

### Storage tolerance for legacy data

`restoreFieldSetData` in
`packages/db-postgres/src/modules/storage/storage-utils.ts` silently skips
rows whose `field_name` is in `RESERVED_FIELD_NAMES`. This is the
data-drift tolerance for documents written before the migration —
their `store_text` rows for `path` are inert, never reach the
schema-walking lookup, and don't trigger the
"Field not found" warning that gets promoted to a `BylineError`.

The orphan rows are harmless and left in place. A one-shot cleanup
is available but optional:

```sql
DELETE FROM store_text WHERE field_name = 'path';
```

### Path widget

`apps/webapp/src/ui/forms/path-widget.tsx`. Reads
`useFieldValue(useAsPath)` to track the source field live; computes
`livePreview = slugify(sourceValue)` using the same slugifier that
the server will apply. Subscribes to a new `systemPath` slot on
form context (`useSystemPath()`).

- **Edit mode**: input shows the persisted `documentVersions.path`
  by default. Editing writes a string override into the slot;
  clearing reverts to `null` (sticky from the previous version on
  save).
- **Create mode**: input is empty by default; placeholder shows the
  live-derived preview (`Will be saved as "..."`).
- **"Regenerate from {source}" action**: a small text-style link
  rendered right-aligned to the label when `livePreview !== systemPath`.
  Clicking writes the live preview into the override slot. Used to
  re-anchor a stale path against an updated title.
- **Live validation hint**: typed values are slugified for
  comparison; if the typed value differs from its slugified form, an
  inline `Suggested: "..."` hint surfaces without blocking input.

### Form context wiring

`apps/webapp/src/ui/forms/form-context.tsx` adds a `systemPath`
slot (`getSystemPath`, `setSystemPath`, `subscribeSystemPath`) plus
the `useSystemPath()` hook. Initialised from `initialData.path` on
mount; tracked in dirty state; reset on form save. The slot is
threaded into the `onSubmit({ data, patches, systemPath })` payload
that `FormRenderer` emits.

### Server transport

`apps/webapp/src/modules/admin/collections/{create,update}.ts`
accept an optional top-level `path` on the request payload (separate
from `data`) and forward it as `params.path` to the lifecycle. This
mirrors the precedent set by `setDocumentStatus`: system metadata is
addressed via dedicated parameters, not field patches.

The `@byline/client` SDK exposes the same: `CreateOptions.path` and
`UpdateOptions.path` on `CollectionHandle.create/update`.

---

## File map

| Concern | Path |
|---|---|
| Slugifier (default) + types | `packages/core/src/utils/slugify.ts` |
| `useAsPath` on `CollectionDefinition` | `packages/core/src/@types/collection-types.ts` |
| `slugifier` on `ServerConfig` | `packages/core/src/@types/site-config.ts` |
| Reserved-name + `useAsPath` validation | `packages/core/src/config/validate-collections.ts` |
| Lifecycle derivation, sticky, locale enforcement | `packages/core/src/services/document-lifecycle.ts` |
| Storage tolerance for orphan rows | `packages/db-postgres/src/modules/storage/storage-utils.ts` |
| Client SDK options | `packages/client/src/{types,collection-handle}.ts` |
| Admin server fns accept `path` | `apps/webapp/src/modules/admin/collections/{create,update}.ts` |
| Form context `systemPath` slot | `apps/webapp/src/ui/forms/form-context.tsx` |
| Path widget (sidebar) | `apps/webapp/src/ui/forms/path-widget.tsx` |
| Form rendering integration | `apps/webapp/src/ui/forms/form-renderer.tsx` |
| Migrated collections | `apps/webapp/byline/collections/{pages,news,docs,categories}/schema.ts` |

---

## Migration of legacy data

Collections that previously declared a `path` field had two write
sources for the same value: the column (set via the lifecycle
fallback) and a `store_text` row (written by the field hook during
flatten). After the migration:

- New writes only touch the column. `flattenFieldSetData` walks the
  schema (which no longer declares `path`), so no new orphan rows
  appear.
- Existing `store_text` rows for `field_name = 'path'` remain.
  Reconstruction silently skips them.
- The `documentVersions.path` column was already populated for all
  existing documents and is unchanged.

No data migration is required. The cleanup SQL above is offered as
a tidy-up, not a fix.

---

## Out of scope / follow-up workstreams

These were intentionally deferred from this work and are documented
here so future work doesn't accidentally re-derive the constraints.

### Path uniqueness

Reserving the name doesn't prevent two `pages` documents from both
having `path = 'about'`. The partial unique index at
`packages/db-postgres/src/database/schema/index.ts:103` (currently
commented out) plus a collision-handling policy (reject vs.
auto-suffix) is its own workstream. Plan separately before
preview-link UX ships, because preview links implicitly rely on
"path uniquely identifies a document within a collection".

### Re-derivation policy beyond manual button

Sticky-by-default is intentional: it protects inbound links and
SEO from a title-edit accidentally invalidating a URL. There is
deliberately no "title changed → path follows" behaviour. The
"Regenerate" action is the explicit user-invoked re-anchor.

### Per-collection slugifier override

Add when a real need surfaces (e.g. media collections that want
to preserve filename extensions). The plumbing point is well
defined: `useAsPath: { source, formatter }` would be the natural
shape, with the per-collection formatter taking precedence over
`ServerConfig.slugifier`.

### Stable HTTP transport

The widget currently posts through TanStack Start server functions.
Once the project introduces a stable HTTP boundary
(see [ROUTING-API-ANALYSIS.md](./ROUTING-API-ANALYSIS.md)), `path`
will need a defined wire shape — likely the same top-level field
the server functions already accept.

---

## Future: per-locale paths

The current rule — one `path` per document, derived in the default
content locale — is a deliberate simplification, not a structural
limit. From a pure web-resource perspective it is technically
correct: a document has one canonical resource identifier, and
locale-prefixed variants
(`/en/about`, `/de/ueber-uns`) are presentation/routing concerns
expressed via `<link rel="alternate">` and equivalent. Most sites
need nothing more.

If a future consumer requires genuinely localised paths — distinct
slugs per language, indexed independently, addressable via
`findByPath('ueber-uns', { locale: 'de' })` — the cleanest path
forward is **a new `document_paths` table**, not extending the
existing column or pushing path back into the EAV.

### Why a side table — the EAV strategy is not available here

The reason is structural, not just principled. Per-locale storage
in Byline today comes for free in the `store_*` tables: every
row carries a `locale` column, and `flattenFieldSetData` /
`restoreFieldSetData` resolve the right one at read time. That
mechanism applies to **fields** — values that live in the EAV
layer. Because `path` is now a first-class scalar column on
`documentVersions` (not an EAV field), we cannot rely on the
existing per-locale storage strategy. There is no `locale` column
on `documentVersions` to discriminate by, and the field-level
flatten/reconstruct pipeline never sees the column.

So per-locale paths require their own storage. A dedicated table
is the natural fit and brings two further benefits:

- **Indexed lookup**. The current `WHERE collection_id = ? AND path = ?`
  on an indexed scalar column is the cheapest path-resolution
  primitive in the system. A `document_paths` table preserves that
  shape, just keyed by `(collection_id, locale, path)` instead.
- **Uniqueness**. Per-locale uniqueness on
  `(collection_id, locale, path)` is straightforward on a dedicated
  table — a single composite unique index. Achieving the same on
  `store_text` would require a partial index keyed by
  `field_name = 'path'`, conflating routing invariants with content
  storage.

### Sketch of the proposed table

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

- **Stay as the canonical/default-locale path** — a denormalised
  copy of the default-locale row from `document_paths`, kept in sync
  by the lifecycle. Existing indexed lookups continue to work; the
  table is consulted only when a non-default locale is requested.
  This is the lower-risk migration.
- Or be **dropped entirely**, making `document_paths` the sole
  source. Cleaner conceptually but a bigger refactor of the views,
  the `findByPath` adapter method, and every consumer that reads
  `path` directly off a row.

### Lifecycle implications

- `createDocument` would still enforce default-locale-first
  creation, but on first create write a single
  `document_paths` row for the default locale. Subsequent
  localised updates could supply `paths: { de: 'ueber-uns', fr: 'a-propos' }`
  to add per-locale variants.
- `updateDocument` would gain a `paths?: Record<string, string>`
  parameter alongside the existing `path?: string` — the latter
  would write the default-locale row, the former any subset of
  locales.
- The widget would need a per-locale layout (probably a small
  table or the existing locale-tab pattern from regular fields)
  rather than a single text input.
- Default-locale enforcement on first create stays unchanged: the
  default-locale path is the document's identity anchor; localised
  paths are additive.

### Why this is a footnote, not a plan

No real consumer needs this today. The current design supports
multilingual content (every other field can be localised) and
multilingual routing (a frontend can prefix `/{locale}/{path}`
without any CMS-side change). The wrinkle is only sites that want
**translated slugs** as a CMS concern, and that's a niche
requirement worth deferring until someone asks. Documenting it
here means the structural answer is on file: a side table, not
EAV.
