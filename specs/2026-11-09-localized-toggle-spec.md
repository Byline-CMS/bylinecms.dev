---
title: "Toggling a field's localized flag — specification"
path: "localized-toggle-spec"
summary: "Make a change to a field's localized flag a read-time conversion with save-time repair, so existing documents keep reading and saving correctly with no migration."
---

# Toggling a field's localized flag — specification

Companions:

- [Implementation plan](./2026-11-09-localized-toggle-plan.md) — stages, checkpoints and checks.
- [Document storage](../docs/03-architecture/01-document-storage.md) — makes the promise this work keeps (property 2, and step 5 of the save walkthrough).
- [Internationalization](../docs/08-internationalization/index.md) — the version completeness ledger, locale resolution and locale visibility.
- Issue #106 — the tracking issue. Section 3 below verifies its diagnosis and section 4 corrects its proposed behaviour.

## 1. Purpose

A field's `localized` flag decides whether the field stores one value shared by
every content locale (store rows with `locale = 'all'`) or one value per
content locale (store rows with `locale = 'en'`, `'fr'`, and so on). Byline
promises that changing this flag on an existing collection needs no database
migration and no content migration. Today that promise does not hold: after the
toggle, strict reads of any affected document fail, and saves can carry stale
rows forward or lose the old value.

This specification makes the toggle safe. You change the flag, and every
existing document keeps reading without errors and without losing values. Each
document converts to the new shape when an editor next saves it. No script has
to run.

What a reader sees after the toggle is unchanged with two intended exceptions:

- When a field becomes shared, every locale shows the source locale's value, so
  readers of other locales stop seeing that field's translation (4.2).
- When a field becomes localized, public exact reads of a locale the document is
  not eligible in withhold the field with the document's other localized
  values (4.2a).

## 2. Vocabulary

- **Shared row**: a store row with `locale = 'all'`. Non-localized fields write
  shared rows.
- **Locale row**: a store row with a concrete content-locale code.
- **Now-localized field**: a field whose current declaration has
  `localized: true` but whose stored rows in a given version may include a
  shared row, because the version was written before the toggle.
- **Now-shared field**: a field whose current declaration is not localized but
  whose stored rows in a given version may include locale rows, because the
  version was written before the toggle.
- **Source locale**: the document's content anchor, `byline_documents.source_locale`,
  falling back to the configured default content locale when it is null. The
  adapters already call this the fallback floor.
- **Copy-forward**: step 5 of `createDocumentVersion` in both adapters. When an
  editor saves in one locale, the form carries only that locale's values and the
  shared values, so the adapter copies the other locales' rows from the previous
  version into the new one.
- **Completeness ledger**: `byline_document_version_locales`, written at save
  time from the version's persisted locale rows. A locale is complete when it
  covers every localized field path the source locale has. The available-locales
  widget colours its checkboxes from it, and locale resolution uses it.

Only leaf fields can be localized. Group, array and blocks fields cannot, and
relations are always shared. A toggle therefore always concerns individual leaf
paths, which may sit inside groups, arrays or blocks.

## 3. Current state (verified against `c9a9c8a4`)

Each claim in issue #106 holds:

- `restoreFieldData` (`packages/core/src/storage/storage-restore.ts:191-214`)
  meets a shared row on a localized field, or a locale row on a non-localized
  field, by pushing a warning and dropping the value.
- `reconstructFromUnifiedRows` (`packages/db-postgres/src/modules/storage/storage-queries.ts:837`,
  and the same line in `packages/db-mysql`) throws `ERR_DATABASE` on any warning
  unless `lenient` is set. List reads, `getDocumentByPath` and
  `getDocumentByVersion` are strict. The editor's `getDocumentById` and several
  write-side lifecycle reads (delete-locale, copy-to-locale, duplicate,
  singleton update) are lenient, so they load the document with the field empty.
- Copy-forward (`packages/db-postgres/src/modules/storage/storage-commands.ts:378-449`,
  `packages/db-mysql/src/modules/storage/storage-commands.ts` step 5 at line 449)
  copies every row whose locale is neither `'all'` nor the active locale. It does
  not consult the collection definition.

Three further problems are not in the issue:

1. **A save can lose the old value (non-localized to localized).** After the
   toggle, the field's only data is a shared row. An editor saves in `fr`.
   Flatten writes a `fr` row. Copy-forward skips shared rows, so the old value is
   not carried forward under any locale. The source locale's value for that field
   is gone from the current version; it survives only in history. The issue's
   proposed fix (limit copy-forward to still-localized paths) does not prevent
   this.
2. **The issue's proposed read rule leaves translated documents blank.** The
   issue proposes reading a shared row as the source locale's value only.
   `resolveReadLocale` (`packages/core/src/storage/locale-resolution.ts:153`)
   chooses one locale per version from the ledger; there is no per-field
   fallback. A `fr` read of a version that is complete in `fr` for its other
   localized fields would therefore show the converted field as empty.
3. **Filters and reads would disagree.** Field where filters
   (`storage-queries.ts` around line 2675) match `field_name = <name> AND (locale = <locale> OR locale = 'all')`.
   The sort join (around line 2420) and the full-text `query` condition (around
   line 2381) match `locale = <effective locale> OR locale = 'all'`; the sort
   join takes `LIMIT 1` with no `ORDER BY`. None of them consults the
   `localized` flag. A shared row on a now-localized field already matches in
   every locale, which agrees with this specification's read rule (4.1). Locale
   rows on a now-shared field match in their own locale, which disagrees with
   the read rule in 4.2; for a sort, a document holding both `en` and `fr` rows
   sorts on whichever row the database returns first.

The ledger has a related gap. It is computed from persisted locale rows, so a
save that carries stale locale rows of a now-shared field forward keeps
advertising those locales as complete.

## 4. Contract

### 4.1 Reading a now-localized field

When a version holds a shared row for a field that is now localized, and no
locale row for the locale being restored, reconstruction uses the shared row's
value as that locale's value. A locale row, when present, wins over the shared
row. No warning is emitted.

- For a single-locale read (`resolveLocale` set), the shared value becomes the
  field's value.
- For a map-shaped read (`locale: 'all'`), the field's map gets the shared value
  under every locale in the **conversion set** (4.3) that has no locale row of
  its own. The adapter computes the conversion set from the loaded rows and
  passes it to `restoreFieldSetData`.

A full map-shaped read loads every store table, so its conversion set is exact.
The save path in 4.3 depends on that and always uses a full read.

*Builder's call, recorded as a decision:* a **projected** map-shaped read
(selective field loading) narrows the contract. It does not load every store
table, and the ledger lists only complete locales, so a partial translation
stored only in an unloaded table is invisible to it. Its conversion set is the
union of the loaded rows' locales, the ledger's locales and the source locale,
and it may omit such a partial locale. No write uses a projected read, so the
narrowing cannot affect stored data. An exact projected conversion set would
need a distinct-locale query across every store table for each listed version,
which is not worth its cost for a display-only read.

Rationale: before the toggle, the shared value *was* the value in every locale.
Showing it everywhere until a locale-specific value exists changes nothing a
reader sees, and it matches what the filter SQL already does.

Locale resolution and the ledger are unchanged by this rule. The version's
ledger was written before the toggle, so it does not list the field's path as a
localized path and does not count it against any locale's completeness.

### 4.2 Reading a now-shared field

When a version holds locale rows for a field that is now not localized, and no
shared row, reconstruction uses the source locale's row as the field's value
and ignores the other locale rows. No warning is emitted. When a shared row is
present it wins, and any locale rows are ignored.

When there is no source-locale row (for example, the field was translated in
`fr` only), the field reads as absent. *Builder's call, recorded as a decision:*
falling back to another locale row was considered and rejected, because which
locale to prefer is arbitrary and the source locale is what the document's
anchor promises.

`restoreFieldSetData` gains a `sourceLocale` input so it can apply this rule.
The adapters already compute it as the fallback floor (`sourceLocale ?? defaultContentLocale`).

### 4.2a The public withhold path

Under `'public'` visibility, an exact read of an ineligible locale withholds
localized values: `reconstructFromUnifiedRows` (pg `storage-queries.ts` around
line 825) keeps only shared rows and meta rows. That filter judges rows by their
stored locale. It must judge them by the field's current declaration instead:

- A now-shared field keeps its rows, and 4.2 picks the source-locale value. The
  field is not localized, so it is never withheld.
- A now-localized field's shared row is withheld with the field's other
  localized values.

*Builder's call, recorded as a decision:* withholding follows the current
declaration in both directions. The second rule hides a value that showed on
such reads before the toggle, but only on reads that already withhold every
other localized field of the document, so the visitor sees the field treated
like its localized neighbours.

The filter needs the collection's field set. The adapter already has it
(`definition.fields`), and restore already walks it, so the builder may move the
withhold decision into `restoreFieldSetData` as an option instead of filtering
rows beforehand.

### 4.3 Saving: an identity-merged write for affected documents

**Why not convert inside copy-forward.** An earlier draft converted rows inside
the adapters' positional copy-forward. That fails when the same save changes
structure. Take an English-source document with two array items whose shared
`caption` is now localized. The editor removes the first item and saves in
French. A positional conversion writes the old captions at indexes 0 and 1: the
surviving item receives the removed item's caption, and the stale index-1 rows
can recreate a removed position. `persistExistingDocumentVersion`
(`packages/core/src/services/document-lifecycle/persistence.ts`) already
documents this hazard for compacted unavailable blocks, and it already contains
the cure.

**The rule.** A single-locale save of a document whose previous version holds
a **localization mismatch** takes the same path that unavailable blocks take
today. A version holds a mismatch when it has a shared row for a field that is
now localized, or a locale row for a field that is now not localized. The
mismatch counts whether or not it changes a displayed value: a now-shared field
with only a `fr` row (which reads as absent under 4.2), and the losing row in a
version holding both kinds of row, both count.

1. Read the previous version in full with `locale: 'all'`. Under 4.1 and 4.2 this
   map read returns every now-localized field as a map holding the shared value
   under each locale in the conversion set, and every now-shared field as its
   single source value.
2. Merge the incoming single-locale data into that map with `mergeWriteLocale`
   (`packages/core/src/services/document-lifecycle/merge-write-locale.ts`).
   It matches array and block items by `_id`, takes structure from the incoming
   data, replaces only the saved locale's value in each localized map, and takes
   the incoming value for non-localized fields. Items submitted without an `_id`
   are matched by position (see "Items without an `_id`" below).
3. Write the result with `locale: 'all'`. A map write runs no copy-forward, so no
   positional rows are carried, stale locale rows of now-shared fields are not
   written, and removed or reordered items keep the right translations.

The adapters' copy-forward SQL does not change. Saves of documents that no
toggle affected run exactly as they do today.

**Detecting an affected document.** Detection examines the whole previous
version, not the rows a read happened to load. A single-locale read loads only
the requested locale chain and shared rows, so it cannot see, for example, a
now-shared field whose only row is `fr` during an `en` save; ordinary
copy-forward would then carry that stale row forward.

The adapters gain one query (named by the builder, on `IDocumentQueries`) that
lists the previous version's distinct `(field_path, locale)` pairs across every
store table, in the same UNION shape `writeVersionLocaleLedger` already uses.
Core classifies each distinct path against the current field set: remove the
numeric index segments from the stored path to get its declaration path (as
`storage-paths.test.node.ts` pins), resolve it with
`resolveDeclarationPath(..., { blocks: 'qualified' })` from
`packages/core/src/paths/`, and compare the row's locale with the field's
current `localized` flag. Paths that do not resolve are not mismatches.

`persistExistingDocumentVersion` runs this check for every single-locale save
with a previous version, and takes the merged-write path when the version has
unavailable blocks or a mismatch. Every single-locale caller (update,
copy-to-locale, and their singleton equivalents) already goes through it.
Restore also uses this persistence service, but writes `locale: 'all'` with
the supplied locale map; it is not a single-locale caller.
The cost is one indexed query per single-locale save over one version's rows,
plus path resolution for its distinct paths. The storage benchmark harness
(`benchmarks/storage/`) measures reads only, so the plan adds a single-locale
save scenario to measure it.

*Builder's call, recorded as a decision:* there is no shortcut based on
`collection_version`. A save made before this fix, after a toggle, already
stamps the current collection version while carrying stale locale rows forward,
so version equality does not prove a version is clean.

**Items without an `_id`.** `mergeWriteLocale` matches an incoming item by `_id`
when it has one and by position when it does not. The admin editor always sends
`_id`. A hand-built payload (for example a `@byline/client` single-locale
update) may omit it; then removing item A from `[A, B]` and submitting `B`
without its `_id` pairs `B`'s new value with `A`'s values in the other locales.
*Builder's call, recorded as a decision:* accept the narrower guarantee.
Identity is preserved for items that carry `_id`; items without one are matched
by position, which is what every ordinary single-locale save already does
through positional copy-forward. Rejecting such payloads would break existing
client writes that do not change structure. The documentation states that a
single-locale write that removes or reorders items must send each item's
`_id`.

`deleteDocumentLocale`'s non-compacted path copies rows verbatim and is covered
by 4.5.

**The conversion set.** For a version, the conversion set is the source locale
plus every locale that has at least one locale row in that version. A version
with no locale rows (locale-agnostic) has a conversion set of the source locale
alone.

A locale-agnostic document therefore becomes an ordinary single-language
document on its first save after the toggle: its ledger lists the source locale
(and the saved locale, if different), and exact public reads in other locales
leave it out, as they do for any untranslated document. This is intended
(section 7, decision 11): a locale-agnostic document has no translations to
protect, so there is nothing for copy-to-all to preserve.

*Builder's call, recorded as a decision:* the set is derived from rows, not from
the ledger. It includes partially translated locales, so an exact editorial read
of such a locale keeps showing the value, and it works for versions written
before the ledger existed.

**Rows whose path no longer resolves.** On an ordinary save, copy-forward carries
an unresolved locale row forward as it does today (reconstruction skips rows of
unknown fields silently). On a merged write the data is rebuilt from the current
field set, so such rows are not written. *Builder's call, recorded as a
decision:* this difference is accepted. Removed fields are out of scope (6), and
the merged write only drops rows that reconstruction already ignores.

After the write, the existing ledger write (`writeVersionLocaleLedger`) runs over
the new version's persisted rows. Because every locale in the conversion set now
holds a row for the field, locales that were complete stay complete and their
checkboxes stay green. That is the intended outcome (section 7, decision 1).

A save the caller already makes with `locale: 'all'` writes whatever map it
supplies, as today.

**Adjacent finding (pre-existing, not fixed here).** The positional hazard above
is not specific to toggles. An ordinary single-locale save that removes or
reorders array or block items carries the other locales' rows of
already-localized fields forward by position, so their translations can attach
to the wrong item. Only the unavailable-block case takes the identity-merged
path today. Stage 0 of the plan confirms this with a failing test and files it
as its own issue; this specification does not widen the merged-write trigger to
cover it.

### 4.4 Filters and sorts

Field where filters (including those inside relation sub-filters) and the sort
join choose their locale arms from the field's **current** declaration, so they
evaluate the same row reconstruction displays:

| Current declaration | Rows a predicate or sort may use |
|---|---|
| Localized, locale not withheld | The effective-locale row; otherwise the shared row. |
| Localized, locale withheld (4.2a: public exact read of an ineligible locale) | No row. The shared arm must not match either. |
| Not localized | The shared row; otherwise the source-locale row. |

The source locale is per document, so in a list query the source-locale arm is a
correlated `COALESCE(<document>.source_locale, <default content locale>)`, the
expression the adapters already use for the fallback floor, not a single
parameter.

**Carrying the declaration.** `FieldFilter` and `FieldSort` carry no
localization metadata today, and filters match on `field_name`. The plan must
add the field's `localized` flag where filters and sorts are parsed against the
field set (`packages/core/src/query/`), including relation sub-filters, which
resolve against the target collection's field set.

**Precedence.** Reconstruction gives a version holding both kinds of row a
winner (4.1: the locale row; 4.2: the shared row). A predicate that ORs the two
arms can match the losing value.

- **Sorts** must follow precedence in both directions: the sort join orders its
  candidate rows by precedence before `LIMIT 1`. This is cheap.
- **Where filters** follow precedence only through the arm choice in the table
  above. *Builder's call, recorded as a decision:* they do not add a `NOT EXISTS`
  guard for the winning row. A version holds both kinds of row for one path only
  when it was written by a save made *before* this fix (for example today's
  stale copy-forward after a localized-to-shared toggle). This specification's
  write paths never produce one, and such a document is repaired on its next
  save. A `NOT EXISTS` guard would add a correlated subquery to every
  localized-field filter on the hot list path to serve that transitional case.
  Until a damaged document is saved, a filter may match its losing value.

**Full-text `query`.** *Builder's call, recorded as a decision:* the full-text
`query` condition is out of scope. It is a substring match across several text
fields that takes `locale = <effective> OR locale = 'all'`. Until a document's
next save, a stale locale row on a now-shared field has two effects in a
non-source-locale search:

- an extra match, when the search text appears in the stale translation; and
- a missing match, when the search text appears only in the source value that
  the read displays, because the condition examines the searched locale and
  shared rows, not the source-locale row.

### 4.5 Verbatim version copies

`copyAllVersionStoreRows` (used by `deleteDocumentLocale`, `reAnchorDocument`
and related commands) copies rows unchanged. It stays unchanged. Its output reads
correctly under 4.1 and 4.2, and the next editorial save converts it.

### 4.6 Strictness

Strict reads keep throwing on genuine reconstruction damage: unexpected paths,
invalid indexes, and the other existing warnings. Only the two locale-mismatch
warnings go away, replaced by the conversions above.

### 4.7 What the editor sees

- Before the next save: in every locale, the editor shows the shared value in
  the now-localized field, and the available-locales checkboxes are unchanged.
- After a save in any locale: every locale in the conversion set holds the
  shared value as its own value, except the saved locale, which holds what the
  editor submitted. Checkboxes stay as they were. Editors translate the field
  per locale when they choose to.
- Toggling back (localized to shared): each document reads its source-locale
  value, and the next save drops the other locales' rows for that field.

### 4.8 The ledger before the next save

The completeness ledger is not recomputed at read time. Before a document's next
save its ledger reflects the pre-toggle definition, in both directions:

- Non-localized to localized: the field's path is not counted against any
  locale, so no checkbox changes.
- Localized to non-localized: a locale that was incomplete only because it lacked
  the now-shared field stays incomplete (amber, withheld or fallen back on public
  reads) until the next save drops the field from the localized paths.

*Builder's call, recorded as a decision:* both are accepted. In each case the
locale availability a reader experiences is what it was before the toggle until
the document is saved, apart from the display changes listed in section 1. Making the ledger schema-aware at read time is out
of scope (6).

## 5. Conformance and tests

Add a `localized-toggle` suite to `packages/db-conformance/src/suites/` so both
adapters run it. Each case writes documents under one collection definition, then
reads and saves under the toggled definition. Cases:

1. Non-localized to localized, document with no other localized fields: list,
   path, version and id reads succeed with no warnings and return the shared
   value in every requested locale.
2. Non-localized to localized, document with a localized `title` complete in `en`
   and `fr`: `fr` reads (exact and fallback, editorial and public) return the
   French `title` and the shared value; `resolvedLocale` is `fr`.
3. Case 2, then save in `en` with a new `en` value: the `fr` read returns the old
   shared value, the ledger still lists `fr`, and the version has no shared row
   for the field.
4. Case 2, then save in `fr` (the non-source locale): the `en` read returns the
   old shared value. This is the data-loss regression.
5. Map-shaped read (`locale: 'all'`) of case 2 before any save: the field's map
   holds the shared value under `en` and `fr`.
6. Localized to non-localized, document with `en`, `fr` and `de` rows: reads in
   every locale return the `en` value with no warnings.
7. Case 6, then save in `fr`: the new version has only a shared row for the
   field, and the next read succeeds.
8. Case 6, source-locale row missing: the field reads as absent with no warning.
9. Filters: case 6, a where-clause on the field in `fr` matches the `en` value
   and not the `fr` value. Case 2, a where-clause in `fr` matches the shared
   value.
10. A field nested in a blocks item and an array item, for both directions, read
    and then saved without structural changes.
11. Strict reads still throw on genuine reconstruction damage: an invalid array
    index and a truncated structural path. (Rows of unknown or removed fields
    are skipped silently today and remain so.)
12. Public exact read of an ineligible locale (4.2a): a now-shared field shows
    the source value; a now-localized field's shared value is withheld.
13. Sort on a now-shared field with `en` and `fr` rows, read in `fr`: documents
    order by the `en` value.
14. Projected list read and a projected map-shaped read: no warnings. The
    projected map omits a partial locale stored only in an unselected store
    table (the narrowed contract in 4.1); a full map read of the same version
    includes it.
15. A save of a document with an unavailable block after a
    non-localized-to-localized toggle: the other locales keep the shared value.
16. First save after a non-localized-to-localized toggle of an array item's and
    a block item's field, saved in the non-source locale:
    - removing the first item leaves the survivor with its own value in every
      locale and no row at the removed position;
    - reordering items keeps each item's value attached to that item.
17. The same removal and reorder cases after a localized-to-shared toggle.
18. A save of a document with no mismatch takes the ordinary copy-forward path
    (no merged write).
19. Filter and sort precedence on a version holding both a shared row and a
    locale row for one path (constructed directly through the adapter):
    a sort orders by the winning value in both directions; a where filter's
    behaviour matches the decision in 4.4.
20. Withheld locale (4.2a): a where filter on a now-localized field does not
    match its shared value on a public exact read of an ineligible locale.
21. A relation sub-filter on a toggled field of the target collection follows
    the table in 4.4.
22. A version written before this fix with mixed rows and the current
    `collection_version` (constructed directly through the adapter): a lifecycle
    save takes the merged-write path and leaves no stale rows.
23. A now-shared optional field with only a `fr` row, saved in `en` through the
    update lifecycle: the new version has no `fr` row for the field.
24. Removal and reorder with items submitted **without** `_id`: items are
    matched by position, as documented; with `_id`, by identity.

Unit tests in `packages/core/src/storage/` cover the restore rules in 4.1 and 4.2
directly (`storage-restore` tests), including locale-row-wins and shared-row-wins.

## 6. Non-goals

- A batch script or CLI command that converts documents ahead of editing.
- A report of documents whose translations still equal the old shared value.
  Under decision 1 the amber checkbox no longer flags these; a report is the
  likely follow-up if teams ask for one.
- Converting stored rows in verbatim copies (4.5).
- Handling removed or renamed fields, changed field types, or changed
  `source_locale` beyond what the existing code already does.
- Changes to the completeness ledger's rules.

## 7. Decisions

1. **The first save copies the shared value into every locale in the conversion
   set.** The alternative was to write it to the source locale only. That turns
   every other locale amber and, for public reads, hides the document's other
   translations until someone translates the one new field. Tony's call: hiding a
   document's translations because one field became localized is a greater
   penalty than visitors seeing one untranslated value, and toggling `localized`
   is a deliberate change whose translation work the downstream technical and
   editorial teams own.
2. **A shared row on a now-localized field serves every locale (4.1), not only
   the source locale (the issue's proposal).** Locale resolution is per version,
   so the issue's rule would blank the field in translated reads. This rule also
   matches the existing filter SQL.
3. **A now-shared field reads the source-locale row (4.2).** As proposed in the
   issue.
4. **The conversion set comes from the version's rows, not the ledger (4.3).**
   Builder's call.
5. **A missing source-locale row on a now-shared field reads as absent (4.2).**
   Builder's call.
6. **Withholding follows the current declaration (4.2a).** Builder's call.
7. **Projected map reads narrow the contract (4.1).** They take the union of
   loaded-row locales, ledger locales and the source locale, and may omit a
   partial locale stored only in an unloaded table. Builder's call.
8. **Affected saves use the identity-merged write; copy-forward SQL is
   unchanged (4.3).** This replaces an earlier draft's schema-aware
   copy-forward, which misattributed values when the first save after a toggle
   removed or reordered items. Builder's call, prompted by review.
9. **Filters and sorts choose arms from the current declaration; sorts follow
   precedence, where filters do not add a `NOT EXISTS` guard; full-text `query`
   is out of scope with both of its effects documented (4.4).** Builder's call.
10. **The pre-toggle ledger stands until the next save (4.8).** Builder's call.
11. **A locale-agnostic document converts to its source locale only (4.3).** The
    alternative was to write the shared value into every configured content
    locale so the document kept reading in every locale. Tony's call: a
    locale-agnostic document has no translations yet, so becoming a
    single-language document, with exact public reads leaving out the missing
    translations, is the correct outcome. Copy-to-all (decision 1) exists to
    protect translations that already exist.
12. **Unresolved-path rows are dropped by merged writes and carried by ordinary
    saves (4.3).** Builder's call.
13. **Mismatch detection examines the whole previous version with one extra
    query per single-locale save; no `collection_version` shortcut (4.3).**
    Builder's call, prompted by review.
14. **Items without `_id` are matched by position in merged writes (4.3).**
    Builder's call, prompted by review.

## 8. Documentation

Update `docs/03-architecture/01-document-storage.md`:

- Property 2 (line 41): state the promise precisely: toggling `localized` needs
  no DDL and no content migration; existing documents keep reading without
  errors or lost values, with the two intended display changes in section 1,
  and each converts on its next save.
- Step 5 (line 83): replace "a data change rather than a schema change" with a
  short account of the conversion, linking to the internationalization docs.

Add a section to `docs/08-internationalization/index.md` describing what
editors and visitors see after a toggle (4.7), including that the new
per-locale values start as copies and need translating.
