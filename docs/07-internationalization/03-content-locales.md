---
title: "Content locales"
path: "i18n-content-locales"
summary: "The language a document is published in: per-document locale resolution and fallback (onMissingLocale), the version-level completeness rule, and the editorial availableLocales control that decides which locales a document advertises in hreflang, sitemaps, and 'Also available in…' menus."
---

## Content locales

A **content locale** is the language a *document* is published in. Unlike
interface locales (a UI-chrome concern), content locales live in the data: each
`localized: true` field stores one value per locale that has one, and the read
pipeline resolves a single effective locale per document at read time.

This section covers two related concerns:

- **[Resolution & fallback](#resolution-and-fallback)** — what a read returns
  when a document is requested in a locale it has not (yet) been translated into.
- **[Advertising](#advertising-content-locales-availablelocales)** — the
  editorial control over which content locales a document *promotes* in
  `hreflang` / sitemap / the "Also available in…" affordance, and the admin
  widget that drives it.

## Resolution and fallback

## The problem it solves

There is no native "document exists in locale X" flag. A logical document is one
row; its current state is one version row carrying one status. Locale exists only
one level down, as a column on the stored field-value rows: non-localized fields
are stored once (under an `'all'` sentinel), and `localized: true` fields store
one row **per locale that has a value**. So "which locales does this document
exist in?" is an *emergent* property of which value rows happen to exist.

Historically Byline had a locale fallback chain for **paths** but not for
**field values**. A request for `/de/news/foo` on an untranslated document would
*resolve the path* (initial `findByPath` falls back `de → configured default`) but return *empty*
localized fields — the UI rendered the slug as a placeholder title over an empty
body. Resolution closes that gap with three rules:

1. **Resolution is per-document, never per-field.** A read picks *one* effective
   locale for the whole document and renders every field in it — never
   mixed-locale ("German title, English body") output.
2. **In fallback mode, a requested locale resolves through a chain that terminates
   at the document's source locale** (the configured default for new documents,
   and the legacy fallback when old data has no source marker). A
   read returns *something*, and only 404s when the document does not
   exist *at all* — never merely because a translation is missing.
3. **"Available in locale L" is a version-level fact** — a property of a document
   *version's* content, computed once at write time and frozen on the immutable
   version. Keying it to the version (not the document) is what keeps it correct
   under restore and point-in-time reads.

## When is a locale "available"? The completeness rule

> **Locale `L` is available on a version iff every localized field path the
> document's source locale has a value at also has a value in `L`.**

The check is run **status-blind** at write time, from the actually-persisted
rows, and the result is stored on the version (in the
`byline_document_version_locales` ledger). Two edges fall straight out of the
rule:

- **A document with no localized fields at all** is trivially *locale-agnostic* —
  it renders identically everywhere, so it is treated as available in *any*
  requested locale (and surfaces `_localeAgnostic: true` with an empty available
  set).
- **A partial translation** (title in `de`, body not) is **not** available in
  `de` → resolution falls through to the next chain entry → a clean
  source-locale page. This is rule #1 (no mixed fields) falling out of the model
  rather than being special-cased.

Because availability is recorded status-blind and keyed by version, **status
composes at read time for free**: a published read resolves the current
*published* version and checks *its* frozen locale set, so a draft `de`
translation stays invisible until the draft is published — at which point the
status flip alone lights `de` up for published reads, with zero extra writes.

## The fallback chain and `onMissingLocale`

Resolution walks an ordered locale chain and selects the first entry that is
available on the document. The chain defaults to `[requested, source]`
(zero-config installations create documents with the default as their source)
and always terminates at the document's source locale. Once a document row is
known, field restoration and projected paths use that source-aware chain. The
initial `findByPath` lookup cannot know the source yet, so it currently tries the
requested locale and configured default instead.

The behaviour is selected by a `onMissingLocale: 'empty' | 'fallback' | 'omit'`
read option:

| Value | Detail read | List read |
|---|---|---|
| **`'empty'`** | restore the *requested* locale exactly — localized fields empty where untranslated. **This is the admin edit view** (empty fields are the signal to use "Copy to Locale"). | render each row in the requested locale exactly. |
| **`'fallback'`** | resolve the effective locale via the chain and restore **all** fields in that one locale. Never 404s on a missing translation. | include every matching document; render each in *its own* effective locale. |
| **`'omit'`** | return `null` (→ caller 404) when the requested locale isn't available. | include only documents available in the requested locale (a cheap indexed check, so pagination / `total` stay correct). |

Defaults differ by caller, deliberately: the **adapter** treats an omitted value
as `'empty'` (the safe exact-match default for internal/direct reads);
**`@byline/client`** defaults to `'fallback'` so application reads "just show
something"; the **admin editor** explicitly passes `'empty'` so switching to an
untranslated locale leaves fields empty rather than pre-filling them with
source-locale text. **Populate always forces `'fallback'`** regardless of the
outer policy, so a populated relation tree never has holes.

## Named fallback chains (planned)

The shipped `[requested, source]` chain delivers the core guarantee. Named
intermediate hops (`de → fr → source`, or regional variants
`de-AT → de → source`) remain a planned additive enrichment; there is no
`localeDefinitions[].fallback` config property yet.

## Advertising content locales (`availableLocales`)

Resolution decides what is *renderable*. **Advertising** is the separate,
editorial decision of what is *promoted* — which content-locale URLs appear in
`hreflang`, the sitemap, and the per-page "Also available in…" menu. A document
can be *renderable* in `de` via fallback yet not *promoted* as a German page
(placeholder copy, mid-edit, legal review).

This is the `availableLocales` system attribute, opted into per collection with
`advertiseLocales: true` on its `CollectionDefinition` (valid only when the
collection has at least one `localized` field). It is the deliberate counterpart
to the automatic structural fact:

| | what | source | mutability |
|---|---|---|---|
| **`_availableVersionLocales`** | "this version is **complete** in these locales" | the completeness ledger | derived, read-only |
| **`availableLocales`** | "I want these locales **advertised**" | the editorial attribute | editor-set, stored |

They must stay separate. A version can be structurally complete in `de` while the
editor does **not** consider it ready to advertise; conversely the editorial set
could name a `de` that is no longer complete. So the **public advertised set is
the intersection**:

```
advertised = availableLocales (editorial)  ∩  _availableVersionLocales (ledger)
```

This handles both failure modes — *complete-but-not-blessed* (editorial off ⇒
out) and *blessed-but-no-longer-complete* (ledger drops it ⇒ out). The host
computes this intersection (`advertisedLocalesFor` in
`apps/webapp/src/lib/alternates.ts`).

## The widget: a "ready" reconciliation grid

When a collection opts in, Byline renders an **available-locales** widget in the
editor sidebar (directly below the path widget). It shows, per content locale,
the structural ledger fact beside the editor's toggle — so the editor is deciding
*advertise / hold back* at exactly the moment the information is in front of them,
rather than reacting to a passive boot/save warning:

| ledger (`_availableVersionLocales`) | toggle | state |
|---|---|---|
| ✓ complete | on | **advertised** |
| ✓ complete | off | *ready, held back* (the safe state) |
| ✗ incomplete | off | nothing to do |
| ✗ incomplete | on | ⚠ *advertising an incomplete locale* |

The reconciliation is expressed purely through the checkbox's **intent colour** —
no per-row text:

- **green / enabled** when the locale is complete in the ledger (the editor can
  toggle it on to advertise);
- **neutral / disabled** when the locale is not yet complete (nothing to
  advertise);
- **amber / enabled** for the ⚠ case — advertised but no longer complete — so the
  editor can uncheck to resolve.

That green checkbox is the visible output of the **"locale ready" detection**:
the completeness rule above, which inspects every localized field for a saved
value in that locale at write time and records the result on the version. The
widget never re-derives it in the browser; it reads `_availableVersionLocales`
off the edit payload and lights the row green when the locale is present. The
policy is **opt-in** — nothing is advertised until the editor checks a green
locale.

> For the widget to render the ledger column, the admin edit response preserves
> `_availableVersionLocales` across its Zod parse (which would otherwise strip the
> unknown key), alongside `availableLocales` itself.

## Saving advertised locales is immediate and non-versioned

`availableLocales` is **document-level** — it lives in
`byline_document_available_locales` keyed by logical document, sticky across
versions (the same shape as `path`). Editing it is therefore **not** part of the
version workflow: an explicit array (including `[]`) means “replace this set” and
flows through `updateDocumentSystemFields` → `setDocumentAvailableLocales`
**without minting a new version or resetting workflow status**. Values are
deduplicated and compared as an unordered set, so reordered/duplicate values
that describe the current set cause no table rewrite or audit noise. The change
is immediate and applies across every version of the document; the public
*advertised* set stays the intersection with the resolved version's completeness
ledger, so a draft-only edit still can't advertise a locale the published version
isn't complete in.

The service snapshots path and advertised locales under the logical-document
lock. A real locale-set change and its `document.locales.changed` before/after
audit row commit together, then `afterSystemFieldsChange` runs outside the
transaction. The hook receives both snapshots plus `requested` / `changed` flags.
With `reconcile: true`, an otherwise no-op retry re-runs that post-commit hook
without another write or audit row.

The admin form keeps a single **Save** button but partitions *why* it is dirty
into four states — `none`, `content` (versioned), `direct-write` (immediate
system-field write), and `both` (each through its own path). When a save involves
a `direct-write`, the editor first confirms a modal that spells out the immediate,
non-workflow nature of the change (tailored by whether a published version is
live). The path widget rides the exact same machinery for the exact same reason
(it is also document-level and sticky).

For `both`, the direct system-field request runs first (so a path conflict is
found before minting a content version), then the versioned content request runs.
They are not one transaction. In particular, a post-commit system-field hook
failure can stop the content request even though the path/locale write and audit
already committed; retrying the admin save opts into no-op reconciliation before
continuing. Because these writes are immediate rather than gated, accountability
for them is the job of the document-level
[audit log](../06-auth-and-security/02-auditability.md) rather than the version
history.

> **Why not gate it behind publish?** A document-level field can't honestly be
> "pending publish" — there is no per-version copy of it to stage. Coupling it to
> the version workflow (the pre-decoupling behaviour) reset the document to draft
> and *implied* gating that never existed: the editorial write already landed at
> save time. The decoupled write makes the data model and the UX agree.

## What core surfaces on a read

Per read, core emits the facts and stops there — the host turns them into URLs
and tags:

| Field | Meaning |
|---|---|
| `availableLocales` | the editorial advertised set (document-level, stored). |
| `_availableVersionLocales` | the structural completeness ledger for the resolved version (derived, read-only, sorted). |
| `_localeAgnostic` | `true` for a document with no localized content ("renders everywhere"); a per-document affordance should render no menu. |
| `sourceLocale` | the document's content anchor — see [Administering content locales](./04-administering-locales.md). |
| (the effective locale) | which content locale the document actually resolved to, driven by `onMissingLocale`. |

Because `@byline/client` defaults to `status: 'published'` and the ledger
resolves against the current *published* version, `_availableVersionLocales` on a
normal read is the **published-available** set — exactly what a public consumer
should advertise. These fields unify three host consumers — `hreflang`,
`sitemap.xml`, and the "Also available in…" menu — on **one** source, so they
cannot drift.

## Code map (content locales)

| Concern | Location |
|---|---|
| Locale chain builder + effective-locale resolution | `packages/db-postgres/src/modules/storage/storage-queries.ts` |
| Completeness ledger write + `availableLocales` write | `packages/db-postgres/src/modules/storage/storage-commands.ts` |
| Non-versioned system-field commands (`updateDocumentPath`, `setDocumentAvailableLocales`) | `packages/db-postgres/src/modules/storage/storage-commands.ts` |
| `byline_document_version_locales` + `byline_document_available_locales` tables | `packages/db-postgres/src/database/schema/index.ts` |
| `MissingLocalePolicy` (`onMissingLocale`) | `packages/core/src/@types/*` |
| `availableLocales` lifecycle threading | `packages/core/src/services/document-lifecycle/` (per-operation modules) |
| Non-versioned system-field service (`updateDocumentSystemFields`) | `packages/core/src/services/document-lifecycle/system-fields.ts` |
| Non-versioned system-field server fn (`updateCollectionDocumentSystemFields`) | `packages/host-tanstack-start/src/server-fns/collections/update.ts` |
| Dirty-reason partition (`getDirtyBreakdown`) + immediate-write confirm modal | `packages/admin/src/forms/form-context.tsx` + `form-renderer.tsx` |
| Read-surface shaping (`_availableVersionLocales`, `_localeAgnostic`, `sourceLocale`) | `packages/client/src/response.ts` + `packages/client/src/types.ts` |
| Available-locales widget + "ready" reconciliation | `packages/admin/src/forms/available-locales-widget.tsx` + `available-locales-reconcile.ts` |
| Edit-payload preservation of `_availableVersionLocales` | `packages/host-tanstack-start/src/server-fns/collections/get.ts` |
| Host advertised-set resolver | `apps/webapp/src/lib/alternates.ts` |
| Re-import that establishes the advertised set | `apps/webapp/byline/scripts/import-docs.ts` |
| Ledger backfill for pre-existing versions | `apps/webapp/byline/scripts/backfill-version-locales.ts` |

---
