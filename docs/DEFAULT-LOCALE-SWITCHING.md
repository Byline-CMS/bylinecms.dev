---
title: "Switchable Default Content Locale"
path: "default-locale-switching"
summary: "Makes a system's default content locale safely switchable by recording a per-document source_locale, so existing data stops depending on a mutable global config value. Today the default locale is a single global string that is never recorded in the data, so switching it silently re-interprets every existing document against an anchor it was never written for — blanking localized fields, breaking path resolution, and invalidating the completeness ledger. Records source_locale per document, re-bases the read fallback / path / ledger anchors onto it, and adds a deliberate per-document (and bulk) re-anchor operation."
---

# Switchable Default Content Locale

> **Status:** In progress. Slices 1–4, the **Slice 5 bulk re-anchor command**,
> and the **Slice 6 edit-view source-locale badge** shipped 2026-06-01 on
> `feat/content-locale-resolution` — **switching `i18n.content.defaultLocale` is
> safe, fully-translated documents can be moved onto the new default in bulk, and
> a document's content anchor is visible in the editor.** Remaining (optional):
> Slice 5's per-document interactive UI action; Slice 6's list-view badge +
> making the indicator mismatch-only. Companion to the content-locale work;
> sketched 2026-06-01.
>
> **Settled decisions:** grain = **document-grain** (`byline_documents`);
> branch = **continue on `feat/content-locale-resolution`** (not a separate
> branch).

Companions:
- [CONTENT-LOCALE-RESOLUTION.md](./CONTENT-LOCALE-RESOLUTION.md) — the locale
  fallback model, the `byline_document_version_locales` ledger, and
  `_availableVersionLocales`. This doc re-bases that model's anchor.
- [DOCUMENT-PATHS.md](./DOCUMENT-PATHS.md) — `byline_document_paths`; paths are
  currently written only under the default content locale.
- [AVAILABLE-LOCALES.md](./AVAILABLE-LOCALES.md) — the editorial advertised-set
  widget; its eligibility data (`_availableVersionLocales`) is exactly what
  gates the re-anchor operation below.

## The problem

There is a hard rule that a document is created in the system's default content
locale first; translations are added later. The default content locale is
`i18n.content.defaultLocale`, threaded into the storage adapter as
`defaultContentLocale`.

**The default locale secretly does two different jobs:**

1. **A config preference** — which locale new content is authored in, and which
   locale is served for a request that doesn't specify one. Genuinely global,
   and genuinely should be switchable.
2. **A per-document data anchor** — every existing document's content rows, its
   path row, and its completeness ledger were written *keyed to whatever the
   default was at write time*, and **nothing in the data records what that
   was.** There is no `source_locale` / `origin_locale` column anywhere.

Because of (2), flipping `i18n.content.defaultLocale` on a live system silently
re-interprets all existing data against a new anchor it was never written for.

### What breaks on a naive switch (`en` → `fr`)

The default is load-bearing in four places, none of which migrate when the
config changes:

| Anchor | Mechanism | Breakage when default flips to `fr` |
|---|---|---|
| **Authoring locale** | "create in default first" rule | primary content sits under `locale='en'` rows |
| **Fallback floor** | `buildLocaleChain` → `[requested, default]` | a `fr` (now-default) read yields chain `['fr']` — **no floor beneath it**, so `en`-authored localized fields read **empty** (the `'fallback'` policy falls back *to* the default, which is now `fr` → circular) |
| **Path locale** | paths stored **only** under the default | path rows live at `(doc, 'en')`; `findByPath(slug, 'fr')` → chain `['fr']` → no row → **404**. (An explicit `'en'` read still resolves: chain `['en','fr']`.) |
| **Completeness yardstick** | ledger `canonical` = default's populated paths | old versions carry `en`-relative completeness (frozen); a `backfillVersionLocales` would recompute against `fr`, but with `fr` empty the `canonical` set goes empty and the `HAVING NOT EXISTS(...)` is vacuously true for **every** locale → completeness becomes meaningless |

Unaffected: **non-localized fields** (stored under the `'all'` sentinel) are
anchor-independent; and reads explicitly in `'en'` keep working.

### The completeness rule, precisely

(For reference, since it underpins the ledger anchor and the re-anchor
eligibility check.) In `createDocumentVersion` (`storage-commands.ts`):

```
loc       = all persisted localized rows (locale <> 'all'), as (field_path, locale)
canonical = field_paths that have a value in <defaultContentLocale>
covering  = locales L such that NOT EXISTS a canonical field_path L is missing
```

So **L is "complete" iff it has a value at every `field_path` the default
locale has a value at** — measured against *persisted default-locale data*
(not the schema's `localized: true` set; an empty-in-default field isn't in the
checklist), at the granular `field_path` level (array/block leaves included).
The default locale is trivially always complete; a doc with zero localized
content records the single `'all'` sentinel instead.

## The fix: record a per-document `source_locale`

Add **`source_locale`** to `byline_documents` (document-grain, `varchar(10)`,
NOT NULL). Set once at creation = the locale the first version was authored in
(defaults to the global config default at that moment). Immutable in normal
operation; changed only by the deliberate re-anchor operation.

That single column re-bases each anchor from "the global config" to "this
document's own truth," so switching the global default becomes a non-event for
existing data — every doc rides its own `source_locale`.

### Grain decision (open)

- **Document-grain** (`byline_documents`) — simplest; the fallback floor and
  path are naturally "the document's language." After a re-anchor, old immutable
  versions' frozen ledgers were computed against the *old* anchor, so they'd be
  inconsistent with the doc's current `source_locale`.
- **Version-grain** (`byline_document_versions`) — each version self-describes
  its anchor, matching its frozen ledger exactly; strictly correct for
  point-in-time / history reads, but heavier to thread.

**Lean:** document-grain, and treat re-anchor as writing a *new* version (whose
ledger is recomputed against the new source). Old versions keep their historical
ledgers — acceptable since they're immutable snapshots.

## The split: what re-bases vs what stays global

Every `defaultContentLocale` consumer falls into one of two buckets.

**Becomes per-document `source_locale`:**

| Site | What it does |
|---|---|
| `storage-commands.ts` path upsert (`locale: this.defaultContentLocale`, ~169) | write path row under `source_locale` |
| `storage-commands.ts` ledger `canonical` write path (~356) | canonical against `source_locale` |
| `storage-commands.ts` ledger `canonical` backfill (~412) | per-doc `source_locale`, set-wise |
| `storage-queries.ts` `buildLocaleChain` (~192–195) | `[requested, source_locale]` |
| `storage-queries.ts` per-doc effective-locale (~430–455) | uses per-doc source |
| field reconstruction `onMissingLocale: 'fallback'` | falls back to `source_locale` |
| `document-lifecycle.ts` `resolvePathForUpdate` (~343) | "path only on default-locale saves" → "on source-locale saves" |
| `document-lifecycle.ts` `derivePath` (~384/476) | slugify in source locale (= create locale) |

**Stays global config (demoted to "authoring default + request fallback"):**

| Site | Why it stays global |
|---|---|
| `document-lifecycle.ts` create validation (~452) | establishes the anchor; defaults new docs to global default |
| `storage-queries.ts` `filterLocale` for `'all'` (~913) | query-wide filter across many docs — can't be per-doc |
| `storage-queries.ts` `buildFilterExists` (~1217/1222) | where-clause compiled once per query, not per row |
| request-time "no locale specified → serve default" | presentation / routing concern |
| `field-upload.ts` default locale (~92/458/472) | review; likely request/authoring default |

## `buildLocaleChain` on list reads — feasibility & performance

This is the only intricate part, and it is tractable with a small, bounded cost
(no N+1, no extra round-trips):

- **`source_locale` rides on the row via one PK join.** It lives on
  `byline_documents` (PK `id`); list reads resolve from the current-documents
  view whose rows already carry `document_id`. Joining on `document_id = id` is
  a primary-key join — effectively free. Carry `source_locale` on each row
  exactly like `path` is carried today.
- **`pathProjection` swaps a constant for a column.** Today the fallback chain is
  a constant `ARRAY['fr','en']`; per-doc it becomes
  `ARRAY[<requested>, d.source_locale]`. Same correlated subquery, same
  `(document_id, locale)` unique index on `byline_document_paths` — identical
  complexity, a per-row array instead of a per-query one.
- **Field-fallback reconstruction needs zero extra queries.** Reconstruction is
  in-memory (`restoreFieldSetData`), already per-document; each doc's
  `source_locale` is on its row, so it's passed straight in (no batched
  follow-up like the ledger/advertised sets needed). The ~430–455 effective-
  locale logic likewise reads the column instead of the chain's tail.
- **Single-doc reads are simpler still** — select `source_locale` alongside and
  build the chain in JS as today.

**The one structural change:** the current-documents views
(`currentDocumentsView` / `currentPublishedDocumentsView`) are defined on
`documentVersions` only, so they must **join `byline_documents` and project
`source_locale`** (a view-definition change, regenerated by migration; still a
PK join). After that every read site gets `source_locale` for free. This is the
first step of the read slice; everything downstream falls out of it.

Net cost ≈ one PK join + one carried `varchar` per row.

## Sliced plan (each independently green)

1. **Schema + backfill primitive** (`@byline/db-postgres`) — ✅ **done** (migration
   `0003_ambitious_imperial_guard.sql`). Added `source_locale` to
   `byline_documents` (nullable, `varchar(10)`); added adapter
   `backfillSourceLocales()` (mirrors `backfillVersionLocales` — param-less, uses
   the adapter's configured `defaultContentLocale`, since a static migration
   can't know it) that stamps every `source_locale IS NULL` row with that
   default; idempotent. Integration test in `storage-locale-fallback.test.ts`.
   **No `NOT NULL` migration** — the column stays nullable; Slice 4 runs this
   backfill at boot and the read/write paths COALESCE NULL → default, which
   avoids a migrate-ordering footgun on in-place upgrades (decision 2026-06-01).
2. **Storage write path** (`@byline/db-postgres`) — ✅ **done.**
   `createDocumentVersion` stamps `source_locale` on new documents (= configured
   default) and reads the existing doc's anchor on a new version; the path upsert
   and the write-time ledger `canonical` key off that per-document
   `source_locale`; `backfillVersionLocales`' `canonical` joins
   `byline_document_versions` → `byline_documents` so it recomputes per-document
   (COALESCE-falling-back to the configured default for not-yet-stamped rows).
   Fully self-contained in the storage layer with **zero behaviour change at the
   current default** (anchor ≡ default until a flip). Tests in
   `storage-locale-fallback.test.ts` (re-anchor simulation proves the ledger and
   path key off `source_locale`, not the global default).

   **Scope moved out of this slice** (chicken-and-egg with the read payload):
   the lifecycle rebase — `resolvePathForUpdate` gate, `derivePath`, and the
   `createDocument` validation relax — needs the doc's `source_locale` *on the
   read payload*, which Slice 3 delivers. And it isn't needed for correctness
   until a flip (Slice 4): pre-flip, `requestLocale === defaultLocale ===
   source_locale`, so the lifecycle's current comparisons stay correct. Moved to
   Slice 3 (and it must land there, *before* Slice 4 sanctions a flip).
3. **Read path + lifecycle rebase** (`@byline/db-postgres` + `@byline/core`) —
   ✅ **done** (migration `0004_real_jamie_braddock.sql` re-projects the views).
   - Both current-documents views now project `source_locale` (the existing PK
     join to `byline_documents`, already there for `order_key`).
   - `buildLocaleChain` / `pathProjection` take a per-document floor;
     `pathProjection` emits `COALESCE(d.source_locale, <default>)` as the
     fallback locale. Threaded through every read site that has a row column:
     `viewProjection`, `documentVersionsProjection` (history, via a correlated
     subquery), detail (`getDocumentById` / `getDocumentByPath`), version-by-id,
     the `findDocuments` raw SQL, relation/populate (`td{depth}.source_locale`),
     and `getDocumentsByDocumentIds`.
   - The field fetch (`getAllFieldValuesForMultipleVersions`) now pulls each
     document's source-locale rows (distinct floors collected per page), and
     `reconstructFromUnifiedRows` resolves the effective locale against the
     document's own `source_locale`.
   - `source_locale` is surfaced on every read return payload (feeds the lifecycle
     and the Slice 6 indicator).
   - Lifecycle: `resolvePathForUpdate` now gates on the document's `source_locale`
     (read off the payload, default fallback for legacy rows) — an `en`-anchored
     doc in an `fr`-default system still treats `en` saves as the path-bearing
     source. **`createDocument` validation / `derivePath` were left as-is**: a new
     doc's source ≡ the global default at creation, so `defaultLocale` is already
     the correct anchor there; the "create in an arbitrary source locale"
     relaxation is a multi-source feature, deferred to Slice 5 (it would need the
     `sourceLocale` param threaded into `createDocumentVersion`).
   - **`resolveDocumentIdByPath` (findByPath) intentionally stays on the global
     default floor** — it resolves a URL with no row in hand, so it can't be
     per-document; `[requested, global-default]` is the correct request-time
     behaviour (post-flip the adapter's default has moved with the system).
   - Tests: field fallback + path projection resolve against a re-anchored doc's
     `source_locale`, not the global default; the lifecycle source-locale gate.
4. **Backfill + demote the global default** (`@byline/core`) — ✅ **done.**
   - **Boot-time backfill instead of a NOT NULL migration** (decision
     2026-06-01): `initBylineCore()` calls `backfillSourceLocales()`
     idempotently at boot (via a new *optional* `IDbAdapter.backfillSourceLocales`
     method), stamping any pre-existing NULL rows with the configured default. The
     column **stays nullable** and the read/write paths COALESCE NULL → default,
     so in-place upgrades self-heal with no manual step and a vanilla
     `drizzle:migrate` never fails on a constraint. A no-op (zero rows) at
     steady state. *(The hard `NOT NULL` DB constraint was dropped from scope —
     the boot backfill + write-path stamping make every live row anchored; a
     later release could add the constraint once installs have stamped, but it
     isn't needed for correctness.)*
   - Demoted the global default in config docs: `ServerConfig.i18n.content.defaultLocale`
     and the adapter's `defaultContentLocale` JSDoc now state it is the authoring
     locale + request/row-less fallback, **not** the per-document data anchor.
   - **Switching `i18n.content.defaultLocale` is now safe** — proved by a test
     that reads `en`-anchored documents through a query layer built with a `fr`
     default and gets the `en` content (and path) back intact.
5. **Re-anchor operation** (`@byline/db-postgres` + admin) — **bulk command ✅
   done** (adapter `reAnchorDocument`/`reAnchorDocuments` + `byline/scripts/re-anchor.ts`);
   per-document interactive UI action still optional. See below.
6. **Source-locale indicator** (`@byline/admin`) — see below.

## Deferred follow-up: make `source_locale` NOT NULL

Slice 4 deliberately left the column **nullable** (boot-time backfill + COALESCE
fallbacks) to avoid a `drizzle:migrate` ordering footgun on in-place upgrades.
**Once the source_locale work has bedded in** — i.e. every live install has
booted at least once on ≥ the release that ships Slice 4 (boot stamps legacy
NULL rows) and the write path stamps every new document — a later release can add
the hard DB constraint. Intent (Tony, 2026-06-01): come back and do this.

When picking it up:
- Precondition: confirm `SELECT count(*) FROM byline_documents WHERE source_locale
  IS NULL` is 0 on representative installs (it will be, post-boot-backfill).
- The migration is a bare `ALTER TABLE byline_documents ALTER COLUMN source_locale
  SET NOT NULL` — safe because the boot backfill (kept in place) guarantees no
  NULLs survive a startup, and the write path never inserts NULL. A static
  migration still can't *run* the backfill (no access to the configured default),
  so it relies on boot having already stamped — which the release ordering
  guarantees (the app must boot on the Slice-4 release before this later one).
- After it lands, the `COALESCE(source_locale, <default>)` guards in
  `pathProjection` / `buildLocaleChain` / the lifecycle become dead-code
  belt-and-suspenders; safe to keep, optional to simplify.

## Re-anchor (Slice 5): two modes

The core operation: assert the doc is **complete** in the target locale (via the
ledger / `_availableVersionLocales`) → flip `source_locale` → move its path row
onto the new locale → write a **new version** (recomputes the ledger against the
new anchor). Refuses on incomplete targets — no manufacturing translations.

> **The real bottleneck is translation, not re-anchoring.** Switching the default
> is safe immediately (Slices 1–4); the *hard* part of actually moving documents
> onto the new default is having them fully translated into it — the system can
> never manufacture a primary language with holes. So the realistic workflow is:
> flip the config → translate documents into the new locale over time → re-run
> the bulk re-anchor (it's idempotent) to sweep up the now-complete ones. The
> command's `skipped-incomplete` report **is** the outstanding-translation
> backlog.

**Bulk command — ✅ done.** Implemented as adapter methods
`reAnchorDocument({ documentId, targetLocale, dryRun? })` /
`reAnchorDocuments({ targetLocale, collectionId?, dryRun? })` in
`@byline/db-postgres` (off the core `IDbAdapter` contract, like the backfills),
driven by `apps/webapp/byline/scripts/re-anchor.ts`
(`pnpm tsx byline/scripts/re-anchor.ts --to fr [--collection <path>] [--dry-run]`).
Per document, in one transaction: skip if `not-found` / `already-anchored` /
`skipped-incomplete` (eligibility from the version-locale ledger — target present,
or the doc is locale-agnostic); otherwise flip `source_locale`, **move** the path
row onto the target locale (re-tag the slug, don't regenerate), write a **new
immutable version** that is a *verbatim copy* of the current one (all eight store
tables incl. `meta`, so block/array identities are preserved — decided over
in-place recompute: immutability is a core invariant and storage is cheap), and
recompute that version's ledger against the new source (shared
`writeVersionLocaleLedger` helper, extracted from `createDocumentVersion` step 6).
Each document is its own transaction → idempotent and resumable; `dryRun` reports
the would-be outcome (and the backlog) without writing. Tests in
`storage-locale-fallback.test.ts`.

Decisions settled here (matching the "scope (a)" agreement):
- **New version, not in-place** — immutability invariant + cheap storage + it's a
  near-start one-time operation.
- **Move the path row** (stable URL, re-tagged) rather than regenerate the slug.
- **Refuse on incomplete** — skip + report, never partial.

The remaining per-doc UI is a **follow-up** (deferred — not blocking; the bulk
command covers the system-switch use case):

- **Per-document, interactive** — a "Set primary language" action in the
  `DocumentActions` dropdown (sibling of *Copy to Locale* / *Duplicate* /
  *Delete*; *Copy to Locale* is the closest precedent — locale-oriented,
  modal-driven, version-producing). For the rare one-off.

Guards for the interactive action:
- **Eligibility from the ledger** — the target picker offers only locales the
  doc is complete in (`_availableVersionLocales`); incomplete targets are
  absent/disabled. Reuses the AvailableLocales reconciliation data.
- **Permission above plain edit** — re-anchoring changes *public* behavior
  (fallback floor, path locale, hreflang/sitemap), so gate it behind a stronger
  ability (e.g. `collections.<path>.manageLocale`, or admin-only) rather than
  ordinary collection-edit.
- **Confirmation modal** spelling out "this changes the document's primary
  language and its URL resolution," like the Duplicate / Copy-to-Locale modals.

## Source-locale indicator (Slice 6)

**Edit-view badge — ✅ done (always-on, temporary).** `SourceLocaleBadge`
(`@byline/admin/react`, `packages/admin/src/widgets/source-locale-badge/`) — the
shared `Badge` with the `noeffect` (neutral) intent, mirroring the localized-field
`LocaleBadge` in spirit. Rendered next to the `useAsTitle` heading in
`form-renderer.tsx`. Data: `ClientDocument.sourceLocale` (mapped from
`source_locale` in `shapeDocument`) + `sourceLocale` added to the shared
`createBaseSchema` (Zod was otherwise stripping it from the parsed get/list
responses); the edit view reads it off `initialData`.

**Currently shown for every document** so the anchor is visible during
development — the badge component carries a `NOTE` to that effect.

**End state (deferred):** make it *signal, not noise* — only show when a
document's `source_locale` **differs from the system's current default content
locale.** A normal single-default install then shows nothing; a re-anchored doc
(the `fr` doc in an `en`-default system) gets a quiet "FR" marker. Needs the
current default threaded to the component for the comparison.

**List-view badge — deferred** (decision 2026-06-01: per-row noise + it needs
threading through each collection's admin list schema). `sourceLocale` *is*
already carried on the list response (added to `createBaseSchema`), so when we do
it, it's mismatch-only rendering in `list.tsx` with no further data work. Reuse
the `contentLocales` code/label list for the chip text if a label is wanted.

## Open decisions

1. ~~**Grain** — document-grain (lean) vs version-grain `source_locale`.~~
   **Settled: document-grain** (`byline_documents.source_locale`).
2. **Re-anchor policy** — refuse on incomplete (lean, safe) vs allow-with-warning.
3. **Scope** — does the work stop at "config switch is safe + bulk re-anchor"
   (Slices 1–4 + 5-bulk), or include the per-doc UI action (5-interactive) and
   the indicator (6)?
4. **`'all'` rows** — non-localized content is anchor-independent and needs
   nothing; confirm we leave it untouched (believed yes).
5. **Re-anchor permission** — new `manageLocale` ability vs admin-only.

**To resume in a fresh session:** read this doc plus
[CONTENT-LOCALE-RESOLUTION.md](./CONTENT-LOCALE-RESOLUTION.md). Slices 1–4 **plus the Slice 5 bulk re-anchor command** are shipped — switching
`i18n.content.defaultLocale` is safe, and fully-translated documents can be moved
onto the new default via `byline/scripts/re-anchor.ts` (adapter
`reAnchorDocument`/`reAnchorDocuments`). Grain (document) and branch
(`feat/content-locale-resolution`) are settled. **Remaining work is optional:**

- **Slice 5 — per-document interactive action** — a "Set primary language" item
  in the `DocumentActions` dropdown (precedent: *Copy to Locale*): a host server
  fn calling `reAnchorDocument`, a target picker fed by `_availableVersionLocales`
  (incomplete locales disabled), a confirmation modal, and a permission above
  plain edit. Open decisions: re-anchor permission (`collections.<path>.manageLocale`
  vs admin-only); whether the interactive path writes a new version (it does today).
- **Slice 6 (source-locale indicator)** — purely presentational; `source_locale`
  is already on every read payload. Show a quiet chip only when a doc's
  `source_locale` ≠ the current global default.

Note: the deferred `createDocument` validation relax (create a doc directly in a
non-default source locale) was **not** needed for re-anchor — re-anchor operates
on existing docs by copying the current version. It remains a separate, optional
"create in arbitrary source" feature.

The recurring grep anchor is `defaultContentLocale` — every consumer is
catalogued in "The split" above; line numbers there are approximate (they
drift), so grep rather than trust them.
