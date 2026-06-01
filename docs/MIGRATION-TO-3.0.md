---
title: "Migrating an existing site to Byline 3.0"
path: "migration-to-3.0"
summary: "Working notes for the 3.0 major release: the full schema + data + app-config delta from 2.7.0, the ordered steps to migrate an existing production site, and the per-site checklist for the two current production installs. Draft aid for the release-prep session — not yet the published release notes."
---

# Migrating an existing site to Byline 3.0

> **Status:** Draft / working notes (started 2026-06-01, on `develop`). Captured
> while the content-locale + default-locale work is fresh, as an aid for the
> later release-prep session that squashes migrations and writes the published
> release notes. **Not yet verified end-to-end against a real upgrade.**

## What this release is

3.0 is the first major since 2.7.0. The headline is the **content-locale
resolution** system and its capstone, a **safely switchable default content
locale**. It is a major because it changes a public read-surface shape
(`_availableLocales` → `_availableVersionLocales` on `ClientDocument`) and the
meaning of `i18n.content.defaultLocale`, and it retires the hand-rolled
`availableLanguages` field pattern in favour of a first-class `advertiseLocales`
directive.

The work landed across 33 commits in three tracks (all merged to `develop`):

1. **Content-locale resolution** — per-document locale fallback on reads, the
   version-grain completeness ledger (`byline_document_version_locales`), the
   `onMissingLocale` read switch (`'empty' | 'fallback' | 'omit'`), and the
   `_availableVersionLocales` read metadata. See
   [CONTENT-LOCALE-RESOLUTION.md](./CONTENT-LOCALE-RESOLUTION.md).
2. **Available-locales (editorial advertising)** — the `advertiseLocales`
   collection directive, the document-grain `byline_document_available_locales`
   table, and the admin sidebar widget. Surfaced on reads as `availableLocales`;
   the public advertised set is `availableLocales ∩ _availableVersionLocales`.
   See [AVAILABLE-LOCALES.md](./AVAILABLE-LOCALES.md).
3. **Switchable default content locale** — the per-document `source_locale`
   anchor, the read/write re-base onto it, the boot-time backfill, and the bulk
   re-anchor command. See [DEFAULT-LOCALE-SWITCHING.md](./DEFAULT-LOCALE-SWITCHING.md).

## Migration shape (release practice)

Per project practice, we **squash migrations before a release** and ship the
existing-site upgrade as **manual SQL + commands in the release notes**. Two
things matter for 3.0:

- **Fresh installs** run the squashed 3.0 baseline migration (regenerate it at
  release time; it supersedes `0000`–`0004`).
- **Existing installs** apply the **delta** below. Both current production sites
  are at the **identical `0000` baseline** (verified: `@byline/core@2.6.1` and
  `@byline/core@2.7.0` ship the same single `0000_black_sabra.sql`, byte-for-byte;
  `byline_document_paths` and `byline_current_published_documents` already exist
  there). So the schema delta is exactly migrations **`0001`→`0004`**, in order,
  followed by the data backfills.

> **The existing-site schema delta ships as one self-contained SQL script:**
> [`packages/db-postgres/sql/upgrade-2.7.0-to-3.0.sql`](../packages/db-postgres/sql/upgrade-2.7.0-to-3.0.sql)
> — idempotent, transactional, Drizzle-independent (equivalent to applying
> `0001`→`0004`). We use this instead of `drizzle:migrate` because, after a
> release squash, a deployed DB's Drizzle journal no longer matches the
> migration files — and the deployed DBs may not carry the Drizzle schema at all.
> Run it with `psql "$DATABASE_URL" -f packages/db-postgres/sql/upgrade-2.7.0-to-3.0.sql`.
>
> **CAUTION:** do **not** run `drizzle:migrate` against a DB upgraded this way —
> its journal points at superseded (squashed) hashes. `drizzle:migrate` is for
> fresh installs only.

---

## Part A — Database migration (existing site)

**DDL first (the SQL script), then the backfills.** The script is one
transaction; safe to re-run.

### A1. Schema DDL — run the script

```sh
psql "$DATABASE_URL" -f packages/db-postgres/sql/upgrade-2.7.0-to-3.0.sql
```

[`sql/upgrade-2.7.0-to-3.0.sql`](../packages/db-postgres/sql/upgrade-2.7.0-to-3.0.sql)
applies, idempotently:

1. **`0001` — completeness ledger.** `byline_document_version_locales`
   (`document_version_id`, `locale`, PK) + FK to `byline_document_versions`.
2. **`0002` — editorial advertised set.** `byline_document_available_locales`
   (`document_id`, `locale`, `collection_id`, timestamps, PK) + FKs to
   `byline_documents` / `byline_collections` + `idx_document_available_locales_document_id`.
3. **`0003` — source-locale anchor.** `byline_documents.source_locale varchar(10)`
   (nullable — intentionally; see A2.2 and the deferred NOT NULL note).
4. **`0004` — current-documents views.** Re-projects `byline_current_documents`
   and `byline_current_published_documents` to carry `source_locale` (and the
   already-present `order_key`) via the existing PK join. View-definition change
   only; the script uses `DROP VIEW IF EXISTS` + `CREATE VIEW` (faithful to the
   tested migration — these views have no dependents).

### A2. Data backfills (ordered, after DDL)

1. **Version-locale ledger backfill — REQUIRED.** Populate
   `byline_document_version_locales` for every pre-existing document version.
   Without it, `onMissingLocale: 'omit'` reads can't see pre-existing documents
   and `_availableVersionLocales` is empty on old versions. Idempotent.
   - Command: `cd apps/webapp && pnpm tsx byline/scripts/backfill-version-locales.ts`
     (calls the adapter's `backfillVersionLocales()`, which uses the configured
     default content locale). See `apps/webapp/byline/scripts/backfill-version-locales.ts`.
   - The script's logic also lives in the bulk re-anchor's shared helper; it keys
     each version's canonical set off that document's `source_locale` (falling
     back to the configured default for rows not yet stamped — see A2.2).
2. **Source-locale backfill — AUTOMATIC at boot.** `initBylineCore()` calls
   `backfillSourceLocales()` idempotently on startup (a no-op once every row is
   stamped), setting `source_locale = <configured default content locale>` on any
   NULL rows. So **deploying the 3.0 server is the backfill** — no manual step.
   The column stays nullable; the read/write paths `COALESCE` NULL → default. See
   `packages/core/src/core.ts` and DEFAULT-LOCALE-SWITCHING.md (Slice 4).
   - Ordering note: this runs *after* migrations on a normal deploy, so 0003 is
     in place. For a controlled cutover you can also run it explicitly via the
     adapter before flipping traffic.

### A3. NOT relevant to these two sites

- `byline_document_paths` and the published view already exist at the `0000`
  baseline — **do not** re-create them.
- No path-table backfill: paths were already moved off the version row before
  2.7.0.

---

## Part B — Application / config migration (per site)

### B1. Version bump

Bump all `@byline/*` deps to `3.0` (lockstep). bylinecms.app is on `^2.7.0`;
modulus-learning.org is on `^2.6.1` (no schema difference — same `0000` baseline —
but review any 2.6→2.7 config-only changes, e.g. `i18n.content.localeDefinitions`).

### B2. Retire `availableLanguages` → `advertiseLocales` (REQUIRED — both sites)

Both sites use the deprecated hand-rolled `availableLanguagesField()` custom field
in their `docs`, `news`, and `pages` collections (`byline/fields/available-languages-field.ts`).
3.0 replaces it with a first-class directive. The reference change is how
bylinecms.dev migrated (commit `63b10d46`):

- In each collection **schema**: remove the `availableLanguagesField()` entry from
  `fields` and its import; add `advertiseLocales: true` to the collection
  definition.
- In each collection **admin** config: remove any column/widget referencing the
  old field.
- Delete `byline/fields/available-languages-field.ts` once unreferenced (and any
  `import-docs.ts` references).
- Note: `availableLocales` is now a **reserved** field name — a collection cannot
  declare a user field by that name.

See AVAILABLE-LOCALES.md for the directive semantics.

### B3. Public read-surface rename (verify per consumer)

- `ClientDocument._availableLocales` → **`_availableVersionLocales`** (the
  structural ledger fact), plus the new editorial `availableLocales` and
  `_localeAgnostic`. **Neither production site consumes `_availableLocales` in
  its frontend today** (checked `apps/webapp/src`), so this is likely a no-op for
  them — but any new hreflang / "also available in…" UI should read the new
  fields. See CONTENT-LOCALE-RESOLUTION.md.
- The read switch is `onMissingLocale: 'empty' | 'fallback' | 'omit'`. Neither
  site calls it directly today.

### B4. `i18n.content.defaultLocale` is no longer the data anchor

Documentation/behaviour note, **no code change required**: it now means "default
authoring locale + request fallback," and each document rides its own
`source_locale`. Switching it on a live site is now safe for existing data (they
keep reading the locale they were authored in). The optional bulk re-anchor
(`byline/scripts/re-anchor.ts --to <locale>`) moves *fully-translated* documents
onto a new default; it is **not** part of a normal version upgrade.

### B5. Content-locale frontend routing (OPTIONAL)

bylinecms.dev added routable content-locale public routing (matcher + strip rules
+ styled not-found, commit `59da6bc3`). The two sites may adopt this if they want
locale-prefixed public URLs; not required by the upgrade.

---

## Part C — Editorial-data migration (OPEN QUESTION — decide per site)

The old `availableLanguagesField` stored a per-document list of advertised
languages as an ordinary EAV field value (under the old field name). The new
system stores editorial advertising in `byline_document_available_locales`
(populated only when an editor saves with `advertiseLocales` on). **These are not
automatically connected.** So after B2, existing documents start advertising
*nothing* until re-saved — even if they previously carried `availableLanguages`
data.

Decision for the release-prep session: either
- **(a) Leave empty** — editors opt back in per document (simplest; acceptable if
  the advertised set isn't load-bearing for public hreflang/sitemap yet), or
- **(b) One-shot data migration** — read each document's old `availableLanguages`
  field values from the store and insert matching `byline_document_available_locales`
  rows (intersect with each doc's `_availableVersionLocales` so we never advertise
  an incomplete locale). Worth a small script if either site relies on the old
  field for public language switching.

Confirm which against each site's actual front-end usage of the old field.

---

## Per-site checklist

| | bylinecms.app | modulus-learning.org |
|---|---|---|
| Current `@byline/core` | `^2.7.0` | `^2.6.1` |
| DB baseline | `0000` (verified) | `0000` (verified, identical) |
| DB delta to apply | `0001`→`0004` + A2 backfills | `0001`→`0004` + A2 backfills |
| `availableLanguages` field in use | docs / news / pages | docs / news / pages |
| `_availableLocales` in frontend | none found | none found |
| No running DB available locally | — | — (so DB steps run against the deployed DB only) |

Both sites take the identical path. modulus has the larger version jump (2.6.1 →
3.0); double-check 2.6→2.7 config deltas (`localeDefinitions`) when bumping.

## Verification (post-migration)

1. Server boots; logs `stamped source_locale on N pre-existing document(s)` once
   (or nothing if already stamped). Admin dashboard loads (no "Byline has not
   been configured" — that fix shipped in this release too).
2. `SELECT count(*) FROM byline_documents WHERE source_locale IS NULL` → expect 0
   after first boot.
3. Existing documents read correctly in their authored locale; a non-default
   locale read with `onMissingLocale: 'fallback'` falls back to the document's
   `source_locale`.
4. `byline_document_version_locales` is populated for pre-existing versions
   (`SELECT count(*)` > 0); `_availableVersionLocales` is non-empty on reads of
   previously-existing docs.
5. Collections with `advertiseLocales: true` render the sidebar widget; saving a
   document writes `byline_document_available_locales` rows.

## Open decisions for the release-prep session

1. ~~**Squash strategy**~~ — **decided (2026-06-01):** fresh installs run the
   squashed/regenerated 3.0 baseline via `drizzle:migrate`; existing installs run
   the committed `sql/upgrade-2.7.0-to-3.0.sql` (Drizzle-independent). At release
   time, regenerate the squashed baseline and double-check the script still equals
   the `0001`→`0004` delta. The Drizzle-native / `byline migrate` CLI path is a
   **deferred product item** — its trigger is downstream self-hosters arriving at
   varied versions, not the two in-house sites.
2. **Editorial-data migration (Part C)** — (a) leave empty vs (b) one-shot script
   per site.
3. **`source_locale` NOT NULL** — still deferred (boot backfill + COALESCE make it
   unnecessary for correctness); a later release can add the constraint once all
   installs have booted on 3.0. See DEFAULT-LOCALE-SWITCHING.md → "Deferred
   follow-up".
4. **Re-anchor** — not part of the upgrade; only if a site actually switches its
   default content locale.
