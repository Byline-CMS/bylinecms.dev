---
title: "Content Locale Resolution & Fallback"
path: "content-locale-resolution"
summary: "Why content-locale availability is a version-grain fact, how a requested locale resolves through a fallback chain ending at the default, and the per-version locale projection that makes list/detail reads return 'something' instead of an empty document."
---

# Content Locale Resolution & Fallback

> **Status:** Implemented (Phases 1–3 + backfill + Phase 6) on branch
> `feat/content-locale-resolution`; Phase 4 deferred, Phase 5 planned. Phase 6
> — availability metadata on read results (`_availableVersionLocales`) — retired the
> userland `availableLanguages` field. Began as a design /
> decision record from a working session — the model below is the present-state
> reference; see [Implementation status](#implementation-status) for what shipped.
> Supersedes the ad-hoc reliance on the userland `availableLanguages` field for
> *resolution*; the *advertising* side is now the core `availableLocales` system
> attribute (see [AVAILABLE-LOCALES.md](./AVAILABLE-LOCALES.md)), which folded that
> field in.

Companions:
- [DOCUMENT-PATHS.md](./DOCUMENT-PATHS.md) — path resolution already walks a `[requested, default]` locale chain (`buildLocaleChain`); this doc extends the *same* chain to content and explains why availability must **not** be bound to the path table.
- [CORE-DOCUMENT-STORAGE.md](./CORE-DOCUMENT-STORAGE.md) — localized field values are stored per-locale in the `store_*` tables; availability is a function of which localized rows a *version* holds.
- [I18N.md](./I18N.md) — the admin-interface translation system, and the `i18n.content.localeDefinitions` content-locale primitive this design grows a `fallback` slot onto.
- [CLIENT-SDK.md](./CLIENT-SDK.md) — `find` / `findByPath` / `findOne` are the read surfaces that gain `onMissingLocale` and the resolution behaviour described here.
- [DEFAULT-LOCALE-SWITCHING.md](./DEFAULT-LOCALE-SWITCHING.md) — *in progress (slices 1–6 shipped 2026-06-01).* The fallback chain here ends at the global default; that doc re-bases the anchor onto a per-document `source_locale` so the system default becomes safely switchable.

---

## Overview

Byline separates **interface locales** (the chrome / admin UI language) from
**content locales** (the languages a *document* can be authored in). This doc is
only about content locales: specifically, **what a read returns when a document
is requested in a locale it has not (yet) been translated into.**

Today the answer is unsatisfying. A `findByPath('/de/news/foo')` for an
untranslated document:

- **resolves the document** (the path layer falls back `de → default`), but
- **returns empty localized fields** (the value layer has *no* fallback), so the
  UI renders the slug as a placeholder title over an empty body.

The document half-exists in the requested locale. This doc closes that gap with
three decisions:

1. **Resolution is per-document, never per-field.** A read picks *one* effective
   locale for the whole document and renders every field in it. No mixed-locale
   ("German title, English body") output, ever.
2. **A requested locale resolves through a fallback chain that always terminates
   at the default content locale** — which must be published first. The result:
   a read always returns *something* (option **a**), and only 404s when the
   document does not exist *at all*, never merely because a translation is
   missing.
3. **"Available in locale L" is a version-grain fact** — a property of a
   document *version's* content, materialised onto the immutable version at
   write time. This is the core primitive that was missing, and keying it at the
   version grain (not the document grain) is what makes it consistent under
   restore / point-in-time reads.

---

## The problem, precisely

### Locale lives at the field-value grain, not the document grain

There is no native "document exists in locale X" concept. A logical document is
one row in `byline_documents`; its current state is one version row in
`byline_document_versions` carrying **one** status. Locale exists only one level
down, as a column on the `store_*` value rows:

- non-localized fields → stored once under `locale = 'all'`;
- `localized: true` fields → one row **per locale that has a value**.

So a single published version can hold `en` + `de` for `title`, only `en` for
`body`, and `'all'` for `slug`. "Which locales does this document exist in?" is
therefore **not a stored fact** — it is an emergent property of which `store_*`
rows happen to exist. That is exactly why installations reach for a userland
`availableLanguages` checkbox: it is the only place a per-document-per-locale
signal lives.

### Paths fall back; field values do not — the visible bug

Byline *already* has a locale fallback chain, but only for **paths**:

- **Paths** (`byline_document_paths`, via `buildLocaleChain` in
  `packages/db-postgres/src/modules/storage/storage-queries.ts`): the chain is
  `[requested, default]`. A `de` request with no `de` path row falls through to
  the default slug, so the URL resolves.
- **Field values** (same file, `getAllFieldValuesForMultipleVersions`, and
  `storage-restore.ts`): the SQL filter is `locale = requested OR locale =
  'all'`, and the restore loop accepts a localized row **only on exact match**
  (`data.locale === resolveLocale`). There is **no** `→ default` fallback. A
  missing `de` translation yields an *undefined* localized field.

The path layer got the chain; the value layer never did. Closing that asymmetry
— giving content the same chain paths already walk — is the heart of the fix.

### Why advertising is the wrong layer for resolution

The editorial **advertising** signal (originally the userland
`availableLanguagesField()`, now the core `availableLocales` attribute) is a good
**advertising** signal and a poor **resolution** signal:

- **Advertising** = "which locale URLs do we *promote* in hreflang / sitemap /
  the read-this-in affordance." A genuine editorial decision (a doc may be
  *renderable* in `de` via fallback yet not *promoted* as a German page).
  The editorial set is correct here — it stays a separate concern.
- **Resolution** = "given a `de` request, what do I render, and does this row
  belong in a `de` list?" This must come from a structural core fact, not a
  hand-maintained checkbox, because the checkbox (i) can drift from the actual
  translated content, (ii) is userland — `@byline/client` cannot depend on a
  field a given install may not define — and (iii) is not the publish-aware,
  per-locale fact resolution needs.

The two concerns map cleanly onto the LANGUAGE-STRATEGY *"routable vs
advertised"* distinction: resolution decides what is *renderable*; advertising
decides what is *promoted*. They stay separate.

---

## The core primitive: version-grain locale availability

### Why not the document grain (the rejected Option B)

The tempting move is to record availability on `byline_document_paths` (write a
per-locale path row when a translation is saved; presence = available). It
fails on **synchronization**: that table is keyed at the **document** grain and
is a *separate write* from version content, while availability is a fact *about
the current version's content*. When the current-version pointer moves —
**restore to a point-in-time version that lacks the `de` translation** — the
document-level ledger would still claim `de` is available. Bad state by
construction. It also overloads one row with two different facts of different
lifetimes: "this document has a *slug* in `de`" (editorial, stable) vs. "this
document's content *is translated* into `de`" (a function of the current
version).

### The fix: key availability at the version grain

Availability is intrinsically a property of a version's content, so materialise
it **onto the immutable version**, at the same grain as content, computed once
at write time:

```
byline_document_version_locales
  ( document_version_id  uuid   -- FK → byline_document_versions.id
  , locale                varchar
  , PRIMARY KEY (document_version_id, locale) )
```

(Equivalently a JSON `available_locales` column on the version row; a dedicated
table is preferred because list-filtering becomes an indexed `EXISTS` / join.)

This inherits immutable versioning's guarantees instead of fighting them:

- **create / update** → a new version is written; its locale set is computed
  from the flattened content and stored.
- **restore** → `restoreDocumentVersion` writes a **new version** copying the
  source's full `locale: 'all'` tree (confirmed in
  `packages/core/src/services/document-lifecycle.ts`). The new version
  recomputes its *own* correct locale set from the content it just copied — so
  the synchronization problem **cannot occur**: there is no stale
  document-level row to contradict the restored content.
- **status change** → mutates the version in place, content unchanged, set
  unchanged.
- **copy-to-locale** → new version adding a locale → recomputed set includes it.
- **delete** → soft flag on the version, set unchanged.

Because the fact rides the same immutability as every other piece of version
content, **following the current-version pointer is always consistent**, and no
invalidation logic is needed.

Reads compose with status for free: published-availability = "the current
*published* version's locale set," obtained by resolving over
`current_published_documents` rather than `current_documents`. Availability
(content presence) and status (lifecycle) stay orthogonal — which is correct.

> **Zero-schema fallback.** Pure query-time derivation (an `EXISTS` against the
> `store_*` tables, no new table) is also correct — it reads the truth directly
> and likewise cannot desync. The materialised table is an optimisation for
> cheap list filtering and to avoid re-encoding the completeness rule in SQL at
> every call site. Phase the table in; ship correctness first.

### Availability is computed status-blind

Write-time availability is computed **purely from content presence** (the
completeness rule below) and is **status-independent**. A version with complete
`de` content records `de` in its locale set *whether the version is draft or
published* — the locale table is populated for **every** version regardless of
status, and the status-change path never writes to it.

This is required, not merely convenient: status changes *mutate the version row
in place* and touch no content. If availability were status-aware, every
`draft → published` transition would have to rewrite the locale set —
reintroducing the exact desync we eliminated by moving to the version grain.
Keeping it status-blind preserves the "compute once at write, freeze on the
immutable version" guarantee.

Status composes at read time instead, for free, because the rows are keyed by
`document_version_id`:

- A **published** read resolves the current *published* version (via
  `current_published_documents`) and checks *that version's* locale set. A draft
  `de` translation lives in a draft version that the published view does not
  surface, so it stays invisible until published — and the read falls back to
  default.
- An **admin / `any`** read resolves over `current_documents` and checks the
  same table.

The payoff is the publish transition itself: when the editor publishes the draft
version, the published view now surfaces it, and its *already-frozen* locale set
lights `de` up for published reads **with zero writes to the locale table**. The
status flip alone flips availability-for-published-reads — which only works
because availability was recorded status-blind at write time.

### What "available" means — the completeness rule

> **Locale `L` is available on a version iff every non-optional `localized: true`
> field has a value in `L`.** Optional localized fields do not gate availability.

Two edges, decided:

- **A document with no localized fields at all** (everything `'all'`) is
  trivially locale-agnostic — it renders identically everywhere. Treat it as
  available in *any* requested locale; the chain resolves to `requested`
  immediately and the content is the same regardless.
- **A partial translation** (title `de`, body not) → under the rule `de` is
  **not** available → resolution falls through to the next chain entry → a clean
  default-locale page. This is precisely decision #1 (no mixed fields) falling
  out of the model rather than being special-cased.

---

## Resolution: one shared fallback chain

### The chain

Resolution walks an **ordered locale chain** and selects the first entry that is
*available* on the document (per the rule above). The chain:

- defaults to `[requested, default]` (zero-config; matches today's path chain);
- always **terminates at the default content locale**, which therefore **must be
  published first** — that terminal guarantees a read always returns something;
- may be enriched with **named fallbacks** (e.g. `de → fr → default`).

### Named fallbacks live on the content-locale primitive

The home for named fallbacks is the already-shipped (2.7.0)
`i18n.content.localeDefinitions`. Grow each entry from `{ code, nativeName }` to:

```ts
{ code: 'de', nativeName: 'Deutsch', fallback?: string | string[] }
```

so `de`'s resolved chain becomes `[de, ...fallback, default]`, deduplicated,
default appended if absent. This is a backward-compatible enrichment of an
existing core primitive — no new surface area, no userland involvement. **Put
the slot in; leave it unused initially.** The engine consumes a chain regardless
of how many hops it contains.

### Path and content must consume the *same* chain

`buildLocaleChain` becomes the single shared chain builder, optionally enriched
by `fallback`, used by **both** `pathProjection` / `resolveDocumentIdByPath`
(path layer) **and** the new content resolver. If they diverge, a URL and its
content can disagree on the effective locale. One builder, one chain, one
effective locale per read.

The behaviour is selected by `onMissingLocale: 'empty' | 'fallback' | 'omit'`. The
**adapter** treats an omitted value as `'empty'` (exact-match — the safe default
for internal/direct reads); **`@byline/client`** defaults it to `'fallback'` so
application reads "just show something". The admin editor explicitly passes
`'empty'` (below).

### Detail read (`findByPath` / `findById`)

- **`'empty'`** (raw per-locale) — restore the *requested* locale exactly:
  localized fields show only their requested-locale value (empty where
  untranslated), `'all'` fields as-is. No fallback, no document gating. This is
  the **admin edit view** — empty fields are the signal to use "Copy to Locale".
- **`'fallback'`** — resolve the effective locale = first entry in the chain that
  is available on the resolved version's locale set, and restore **all** fields
  in that one locale (never mixing). Never 404s on a missing translation; the
  only locale 404 is when the default locale itself isn't published.
- **`'omit'`** — return `null` (→ caller 404) when the requested locale isn't
  available; otherwise restore the requested locale exactly.

### List read (`find` / `findMany`)

- **`'empty'`** — render each row in the requested locale exactly (untranslated
  rows show empty localized columns). The admin list uses this so the list
  reflects actual per-locale translation state.
- **`'fallback'`** — include every matching document; render each in *its own*
  effective locale via the chain (German where available, default-locale content
  elsewhere).
- **`'omit'`** — include only documents available in the requested locale, via
  a cheap indexed `EXISTS` on the version-locale table (so pagination / `total`
  stay correct). The "don't list untranslated docs" policy.

### Why the default differs by caller (regression note)

Phase 1 originally applied effective-locale fallback to *every* concrete-locale
read. That leaked into the **admin editor**, which must show raw per-locale data:
switching to an untranslated locale wrongly pre-filled every field with the
default-locale text instead of leaving them empty. The fix made fallback explicit
— `@byline/client` opts into `'fallback'` for application reads, while the admin
host server fns (`server-fns/collections/get.ts`, `list.ts`) pass `'empty'`.
**Populate always forces `'fallback'`** (in `getDocumentsByDocumentIds`) regardless
of the outer policy, so a populated relation tree never has holes.

---

## Relationship to advertising (`availableLocales`)

| Concern | Source of truth | Layer |
| --- | --- | --- |
| **Resolution** — what is *renderable*; what to render; list inclusion | version-grain locale set (this doc) | core (`@byline/core` / adapter) |
| **Advertising** — what is *promoted* in hreflang / sitemap / affordances | `availableLocales` system attribute | core (editor-set) |

They are independent and can be **cross-checked**: a boot- or save-time warning
when `availableLocales` claims a locale the content does not actually cover (or
vice-versa) catches editorial drift without coupling the two.

---

## Implementation status

Phased so each step was independently shippable; Phase 1 fixes the visible bug on
its own. **Phases 2 and 3 were merged** during implementation — decision: build
on the durable ledger immediately rather than ship an interim `store_*` `EXISTS`
that Phase 3 would have replaced. All on branch `feat/content-locale-resolution`.

**Phase 1 — close the value/path asymmetry — DONE (`fac1d685`).** Content
restoration now walks the same `[requested, default]` chain paths already use,
resolving a single effective locale per document and restoring every field in it
(never mixing locales). In the adapter (`storage-queries.ts`):
- `getAllFieldValuesForMultipleVersions` widened to fetch the whole chain, not
  just `requested` + `'all'`, so the default rows are present to fall back to.
- new `resolveEffectiveLocale` called once per version inside
  `reconstructFromUnifiedRows` — the single per-version chokepoint shared by
  detail and list reads. The restore loop (`storage-restore.ts`) was unchanged;
  it just receives the resolved locale via the existing `resolveLocale` param.
- The completeness rule shipped as **path-coverage**: a locale is available iff
  it covers every localized field path the default locale has, computed from the
  rows already in hand — no schema walk. (The doc's earlier "non-optional
  fields" framing is a possible future refinement; path-coverage is the shipped
  rule and is faithful given that document structure is shared across locales.)

**Phases 2 + 3 — `onMissingLocale` + version-locale ledger — DONE (`e3b55c01`).**
- `byline_document_version_locales (document_version_id, locale)` table +
  migration `0001`. Populated **status-blind at write time**
  (`storage-commands.ts` step 6) from the *persisted* rows — so it accounts for
  the per-locale carry-forward, not just the freshly-flattened locale — with an
  `'all'` sentinel row for locale-agnostic documents.
- `MissingLocalePolicy = 'empty' | 'fallback' | 'omit'` in `@byline/core`
  (the `onMissingLocale` read option; client defaults to `'fallback'`, admin
  passes `'empty'`); an indexed `EXISTS`
  gate (`localeAvailabilityExists`) wired into `findDocuments` (list — at the SQL
  layer, so pagination / `total` stay correct), `getDocumentById`, and
  `getDocumentByPath` (detail — resolves to `null` when unavailable).
- `onMissingLocale?` on `FindOptions` / `FindOneOptions` / `FindByIdOptions` /
  `FindByPathOptions`, threaded through `find` / `findOne` / `findById` /
  `findByPath`. Populate stays `'fallback'` (a populated tree never has holes).

**Backfill — DONE (`4d5d6e83`).** Versions written before migration `0001` carry
no ledger rows, so `strict` would hide them until populated (`'fallback'` is
unaffected — it never reads the ledger). `PgAdapter.backfillVersionLocales()`
(on the concrete `DocumentCommands`, deliberately **off** the core `IDbAdapter`
contract so no service mock changed) recomputes the ledger set-wise over all
versions with the same path-coverage rule, using the configured default content
locale — which a static SQL migration can't know, hence a runtime routine.
Idempotent. Runner: `apps/webapp/byline/scripts/backfill-version-locales.ts`
(`cd apps/webapp && pnpm tsx byline/scripts/backfill-version-locales.ts`).

**Phase 4 — named fallback chains — DEFERRED (nice-to-have, not load-bearing).**
The `[requested, default]` chain already delivers the core guarantee; named
intermediate hops (`de → fr → default`, or regional variants
`de-AT → de → default`) are an additive enrichment — a `fallback?` slot on
`i18n.content.localeDefinitions` consumed by `buildLocaleChain`. Zero migration,
no behaviour change for installs that don't set it, so it can land whenever a
regional-variant or editorial-fallback need actually appears.

**Phase 5 (optional) — advertising/availability cross-check.** Save- or
boot-time warning when the editorial `availableLocales` set and the version-locale
set disagree.

**Phase 6 — availability metadata on read results — DONE.** Read results now
carry `doc._availableVersionLocales: string[]` (the resolved version's locale set from
the ledger, sorted) plus `doc._localeAgnostic: boolean` for the `'all'`-sentinel
case (no localized content → "available everywhere", which a per-document
affordance should treat as "render no menu" and `_availableVersionLocales` is empty).
Implemented as a batched indexed query (`getAvailableLocalesByVersion`) attached
in `getDocumentById`, `getDocumentByPath`, and `findDocuments` (one query per
read/page, keyed by the already-resolved version id); the adapter emits
`_availableVersionLocales` / `_localeAgnostic` directly and `@byline/client`'s
`shapeDocument` passes them through to `ClientDocument` unchanged. Absent on
version/history reads and on populated relation targets.

> **Naming note (Slice 2 of AVAILABLE-LOCALES):** this ledger fact was
> originally surfaced as `_availableLocales`. It was renamed to
> `_availableVersionLocales` to disambiguate from the **editorial**
> `availableLocales` advertising set (document-grain, stored) that
> [AVAILABLE-LOCALES.md](./AVAILABLE-LOCALES.md) introduces. The ledger fact is
> version-grain and computed; the editorial set is what an editor elects to
> advertise. Storage raw keys now match the client surface (no boundary rename). Because the SDK defaults
to `status: 'published'` and the ledger resolves against the current-*published*
version, `_availableVersionLocales` on a normal read is the **published-available**
set — exactly what a public consumer should advertise.

This is the payoff that makes the ledger consumable by the host, and it unifies
three consumers on **one source** (so they cannot drift):

- **hreflang / `<link rel="alternate">`** — replaces `availableLanguages` as the
  input to the host's `resolveAlternates(...)`.
- **dynamic `sitemap.xml`** — same alternates set per document.
- **a per-document "Also available in…" content-language menu** —
  `_availableVersionLocales` (set) + `i18n.content.localeDefinitions` (labels) +
  `buildLocalizedPath` (URLs) fully derive the menu; no userland field. Distinct
  from the global *interface*-language switcher (which lists interface locales
  unconditionally); this one is per-page, content-locale, gated on availability,
  and is the explicit opt-in affordance that surfaces a non-default content URL
  without making it sticky.

Net effect: the editorial *advertising* signal — once the userland
`availableLanguages` field, now the core `availableLocales` attribute (opt in via
`advertiseLocales: true`) — is no longer "the only signal for what's translated."
It is an **optional editorial override**: the public advertised set is
`availableLocales ∩ _availableVersionLocales`, so it can *narrow* the auto-derived
availability (suppress-when-ready, stable intent, or a stricter "ready" definition
than path-coverage). A site where *advertise == fully-translated* can skip
`advertiseLocales` entirely and have the host derive hreflang straight from
`_availableVersionLocales`. Pairs naturally with Phase 5: the cross-check flags an
editorial override that contradicts the actual content.

---

## Open edges (decide during implementation)

- **`strict` list + populate.** When a relation target is unavailable in the
  requested locale under `strict`, does the relation envelope report
  "unresolved-in-locale" or fall back to default content? Lean: relations follow
  `'fallback'` (render default) regardless of the list policy, so a populated tree
  never has holes — but make it explicit.
- **`findOne` with `strict`.** Returns null when the single match isn't available
  in-locale, or falls back? Lean: honour the same `onMissingLocale` the caller
  passed; `'fallback'` is the default and falls back.
- **`useAsTitle` over a fallback.** When the effective locale is the default,
  the title comes from default content — correct and consistent (no special
  case), but worth a test asserting the admin list/preview show the default-locale
  title rather than the slug placeholder.
- **Required-field set changes across schema versions.** The completeness rule is
  evaluated against the version's *own* collection schema version; a field that
  was optional when the version was written stays optional for that version's
  availability. Materialised set (Phase 3) freezes this correctly; query-time
  derivation must read the version's schema, not the current one.
