---
title: "Content locales"
path: "i18n-content-locales"
summary: "The language a document is published in: per-document locale resolution and fallback (onMissingLocale), the version-level completeness rule, and the editorial availableLocales control that decides which translations public reads deliver and advertise."
---

# Content locales

Companions:
- [Internationalization](./index.md) — the three-axis overview; content locales are the axis that lives in the data.
- [The host i18n system](./01-host-i18n.md) — how a host turns the available/advertised facts here into `hreflang`, canonical, and sitemap entries.
- [Administering content locales](./04-administering-locales.md) — switching a system's default content locale safely.
- [Document Paths](../04-collections/05-document-paths.md) — the per-`(document, locale)` path row and the `sourceLocale` anchor content resolution builds on.

A **content locale** is the language a *document* is published in. Unlike
interface locales (a UI-chrome concern), content locales live in the data: each
`localized: true` field stores one value per locale that has one, and the read
pipeline resolves a single effective locale per document at read time.

This section covers two related concerns:

- **[Resolution & fallback](#resolution-and-fallback)** — what a read returns
  when a document is requested in a locale it has not (yet) been translated into.
- **[Advertising](#advertising-content-locales-availablelocales)** — the
  editorial control over which translations a document *delivers and promotes*
  publicly, the [public delivery rule](#public-delivery-of-advertised-locales)
  it drives, and the admin widget that sets it.

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
localized fields: the UI rendered the slug as a placeholder title over an empty
body. Resolution closes that gap with three rules:

1. **Resolution is per-document, never per-field.** A read picks *one* effective
   locale for the whole document and renders every field in it, never
   mixed-locale ("German title, English body") output.
2. **In fallback mode, a requested locale resolves through a chain that terminates
   at the document's source locale** (the configured default for new documents,
   and the legacy fallback when old data has no source marker). A
   read returns *something*, and only 404s when the document does not
   exist *at all*, never merely because a translation is missing.
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

- **A document with no localized fields at all** is trivially *locale-agnostic*:
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
translation stays invisible until the draft is published. Publishing needs no
extra ledger write: the status flip makes `de` complete for published reads. In a
collection that advertises locales, public reads deliver it only when `de` is
also checked (see
[Public delivery of advertised locales](#public-delivery-of-advertised-locales)).

## The fallback chain and `onMissingLocale`

Resolution walks an ordered locale chain and selects the first entry that is
available on the document. The chain defaults to `[requested, source]`
(zero-config installations create documents with the default as their source)
and always terminates at the document's source locale. Once a document row is
known, field restoration and projected paths use that source-aware chain. The
initial `findByPath` lookup resolves the slug before the document is known, so it
ranks path rows in this order: the requested locale, then the configured default,
then a row under the matching document's own source locale, so a document whose
source differs from the current default stays reachable. Only a unique candidate
at that last rank is accepted; when several documents share the slug under
different source locales, the lookup returns nothing rather than an arbitrary
document. Matching a path never grants a translation: content eligibility is
decided afterwards, when the document is reconstructed.

The behaviour is selected by a `onMissingLocale: 'empty' | 'fallback' | 'omit'`
read option:

| Value | Detail read | List read |
|---|---|---|
| **`'empty'`** | restore the *requested* locale exactly. Under editorial visibility the stored values are returned, including a partial translation, with fields empty where untranslated. **This is the admin edit view** (empty fields are the signal to use "Copy to Locale"). Under public visibility a withheld or incomplete translation returns empty localized fields instead. | render each row in the requested locale exactly, under the same visibility rule. |
| **`'fallback'`** | resolve the effective locale via the chain and restore **all** fields in that one locale. Never 404s on a missing translation. | include every matching document; render each in *its own* effective locale. |
| **`'omit'`** | return `null` (→ caller 404) when the requested locale isn't available to the read. | include only documents available in the requested locale (a cheap indexed check, so pagination / `total` stay correct). |

"Available" in `'fallback'` and `'omit'` means complete on the selected version,
and, for public reads in a collection that advertises locales, also checked. See
[Public delivery of advertised locales](#public-delivery-of-advertised-locales).

Defaults differ by caller, deliberately: the **adapter** treats an omitted value
as `'empty'` (the safe exact-match default for internal/direct reads);
**`@byline/client`** defaults to `'fallback'` so application reads "just show
something"; the **admin editor** explicitly passes `'empty'` so switching to an
untranslated locale leaves fields empty rather than pre-filling them with
source-locale text. **Populate always forces `'fallback'`** regardless of the
outer policy, so a populated relation tree never has holes.

### The host supplies a content-locale preference

The read API accepts a locale string, but it cannot know whether that value came from a public interface locale, a URL prefix, an editor selection, or another host concern. Hosts whose interface and content locale sets differ should map request context to a configured content locale before ordinary reads.

A common policy passes a content locale through and maps an interface-only locale to the installation's current default content locale. The resulting chain remains `[preferred content locale, source locale]`: mapping establishes a consistent site preference without removing the document's durable fallback floor. Passing an interface-only locale raw leaves the preferred slot ineffective, so a list can render each document in its own source locale after an operational default change.

Search does not use this read chain. Its `locale` selects one exact index slice; see [Result locale and query language](../06-search/03-search-api.md#result-locale-and-query-language).

## Named fallback chains (planned)

The shipped `[requested, source]` chain delivers the core guarantee. Named
intermediate hops (`de → fr → source`, or regional variants
`de-AT → de → source`) remain a planned additive enrichment; there is no
`localeDefinitions[].fallback` config property yet.

## Advertising content locales (`availableLocales`)

Completeness decides what a version *can* render. **Advertising** is the
separate, editorial decision of which translations are *released*: in a
collection that advertises locales, public reads deliver a translation only
while its checkbox is set, and the same checked-and-complete set drives
`hreflang`, the sitemap, and the per-page "Also available in…" menu. An editor
holds a complete translation back (placeholder copy, mid-edit, legal review) by
leaving it unchecked.

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

This handles both failure modes: *complete-but-not-blessed* (editorial off ⇒
out) and *blessed-but-no-longer-complete* (ledger drops it ⇒ out). The host
computes this intersection for discovery (`advertisedLocalesFor` in
`apps/webapp/src/lib/alternates.ts`); the read pipeline applies the same rule to
delivery, described next.

## Public delivery of advertised locales

In a collection with `advertiseLocales: true`, the checkbox set is not only a
discovery hint: it decides which translations public reads deliver. Every read
chooses a **locale visibility**:

| `localeVisibility` | Typical callers | `'fallback'` and `'omit'` select | Exact (`'empty'`) reads return |
|---|---|---|---|
| `'public'` | Anonymous visitors and published delivery | The source; any other locale only when it is **checked and complete** on the selected version. | The requested locale when it is eligible; otherwise empty localized fields. |
| `'editorial'` | Authorized editors, preview, the admin edit view | The source; any other locale that is **complete** on the selected version, checked or not. | The requested locale's stored values, **including a partial translation**. |

A locale-agnostic version (no localized content) is deliverable in every locale
under both. Collections without `advertiseLocales` have no checkbox, so both
visibilities deliver any complete locale.

Visibility is independent of `status`. `@byline/client` only *derives a default*
from `status` when you don't pass one: omitted or `'published'` reads default to
`'public'`, and `'any'` reads default to `'editorial'`. You can combine them
explicitly — `status: 'published', localeVisibility:
'editorial'` reviews unchecked translations of the published version:

```ts
const client = getViewerBylineClient()
const doc = await client.collection('news').findByPath('launch', {
  locale: 'es',
  status: preview ? 'any' : 'published',
  localeVisibility: preview ? 'editorial' : 'public',
})
```

`'editorial'` requires an authenticated actor; an anonymous read that asks for
it fails with `ERR_UNAUTHENTICATED`. The adapter's own default, for internal
reads that call it directly, is `'editorial'`.

An unchecked translation behaves exactly like a missing one under `'public'`:

- **`'fallback'`** selects the next eligible locale in the chain, ending at the
  source. A Spanish request for a document whose complete Spanish is unchecked
  returns the source content.
- **`'omit'`** leaves the document out, as it would an untranslated one.
- **`'empty'`** returns the document with its localized fields empty and its
  non-localized fields intact, rather than the stored translation.

Two public-read rules apply to **every** collection, whether or not it
advertises locales:

- Public `'empty'` also withholds an **incomplete** additional translation.
  Previously an exact public read could return a partial translation's stored
  values.
- Public reads cannot request `locale: 'all'`; the client rejects it with
  `ERR_VALIDATION`. Multi-locale reads are editorial.

The same rule applies across the read surface: populated relation targets use
their own collection's checkboxes; `where` filters, sorts, and text queries
evaluate each document in the locale it is shown in; and public search indexes
and returns only publicly deliverable locales (see
[Result locale and query language](../06-search/03-search-api.md#result-locale-and-query-language)).
`_bypassBeforeRead` skips only `beforeRead` row scoping, not locale visibility.

### What a check or uncheck changes

A checkbox change is immediate and non-versioned (see
[below](#saving-advertised-locales-is-immediate-and-non-versioned)), so its
effect depends on the version public reads select:

- Checking a translation that is complete in the **published** version delivers
  it publicly as soon as the save commits.
- Checking a translation that is complete only in a **newer draft** delivers
  nothing yet; it becomes public when that draft is published.
- Unchecking a published translation withdraws it on the next fresh read. The
  source is always delivered, so unchecking the source row stops advertising
  it but does not withdraw it.

Withdrawal has the same limits as unpublish: cached responses stay until their
invalidation or expiry, and rich-text relationship snapshots saved into other
documents keep their copied values until those documents are refreshed or
re-saved. See [Caching](../05-reading-and-delivery/06-caching.md) and
[Rich Text](../04-collections/07-rich-text.md).

### Editorial policy for localized content

Byline enforces which translations public reads deliver; your editorial policy
decides when that should change. Byline separates content languages from
interface languages, so you can release each translation when it is ready. That
flexibility benefits from an explicit editorial policy: who approves a
translation, what approval means, and when a released language should be
withdrawn.

A checked language grants continuing permission to deliver its complete
published content. Routine revisions can follow the draft and preview workflow
while the existing publication remains available. Unchecking a language is a
separate withdrawal decision. The source language is delivered whatever its
checkbox says, so withdrawing a document entirely is an unpublish, not an
uncheck.

Choose relationship behaviour deliberately too. Saved rich-text snapshots
preserve previously copied content; read-time population follows the target's
current permitted state (see [Rich Text](../04-collections/07-rich-text.md#relations-embed-and-populate)).
Decide which behaviour each field needs and who is responsible for reviewing
stale snapshots. Byline does not currently report or repair stale snapshots;
tooling for that is possible future work.

These editorial practices complement Byline's visibility rules and the
documented [cache limits](../05-reading-and-delivery/06-caching.md). They do not
replace them.

### Preview

Byline's preview mode reads the latest saved version with `'editorial'`
visibility, so an editor can review an unchecked translation at its public URL.
The admin Preview button keeps the content locale selected in the editor even
when it is unchecked; preview shows saved content only, never unsaved form
edits. A preview response is private and bypasses the shared application cache.
Preview does not add an unchecked translation to public discovery: the reference
application suppresses `hreflang` alternates and the language menu on preview
responses rather than advertise a draft's completeness.

## The widget: a "ready" reconciliation grid

When a collection opts in, Byline renders an **available-locales** widget in the
editor sidebar (directly below the path widget). It shows, per content locale,
the structural ledger fact beside the editor's toggle, so the editor is deciding
*advertise / hold back* at exactly the moment the information is in front of them,
rather than reacting to a passive boot/save warning:

| ledger (`_availableVersionLocales`) | toggle | state |
|---|---|---|
| ✓ complete | on | **advertised** |
| ✓ complete | off | *ready, held back* (the safe state) |
| ✗ incomplete | off | nothing to do |
| ✗ incomplete | on | ⚠ *advertising an incomplete locale* |

The reconciliation is expressed purely through the checkbox's **intent colour**
(no per-row text):

- **green / enabled** when the locale is complete in the *saved* version's
  ledger (the editor can toggle it on). The saved version may be an unpublished
  draft, so green means "can be checked", not "is complete in the published
  version";
- **neutral / disabled** when the locale is not yet complete (nothing to
  advertise);
- **amber / enabled** for the ⚠ case (advertised but no longer complete), so the
  editor can uncheck to resolve.

That green checkbox is the visible output of the **"locale ready" detection**:
the completeness rule above, which inspects every localized field for a saved
value in that locale at write time and records the result on the version. The
widget never re-derives it in the browser; it reads `_availableVersionLocales`
off the edit payload and lights the row green when the locale is present. The
policy is **opt-in**: no translation is publicly delivered or advertised until
the editor checks it. The source-locale row carries a note that the source stays
available while published whether or not it is checked, and the list carries a
short explanation of the public delivery rule.

> For the widget to render the ledger column, the admin edit response preserves
> `_availableVersionLocales` across its Zod parse (which would otherwise strip the
> unknown key), alongside `availableLocales` itself.

## Saving advertised locales is immediate and non-versioned

`availableLocales` is **document-level**: it lives in
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
into four states: `none`, `content` (versioned), `direct-write` (immediate
system-field write), and `both`. When a save involves a `direct-write`, the
editor first confirms a modal that spells out the immediate, non-workflow nature
of the change and its effect on public delivery. The path widget rides the exact
same machinery for the exact same reason (it is also document-level and sticky).

Every save is one request. For `both`, the server writes the path or locale
change first and then the new content version, inside one guarded transaction:
both commit or neither does, so a failed content write leaves the checkbox set
unchanged. After the commit, `afterSystemFieldsChange` and `afterUpdate` run
outside the transaction. A post-commit hook failure is reported to the editor
after the writes have committed; retrying the save opts into no-op
reconciliation. Because these writes are immediate rather than gated,
accountability for them is the job of the document-level
[audit log](../07-auth-and-security/02-auditability.md) rather than the version
history.

> **Why not gate it behind publish?** A document-level field can't honestly be
> "pending publish": there is no per-version copy of it to stage. Coupling it to
> the version workflow (the pre-decoupling behaviour) reset the document to draft
> and *implied* gating that never existed: the editorial write already landed at
> save time. The decoupled write makes the data model and the UX agree.

## What core surfaces on a read

Per read, core emits the facts and stops there; the host turns them into URLs
and tags:

| Field | Meaning |
|---|---|
| `availableLocales` | the editorial advertised set (document-level, stored). |
| `_availableVersionLocales` | the structural completeness ledger for the resolved version (derived, read-only, sorted). |
| `_localeAgnostic` | `true` for a document with no localized content ("renders everywhere"); a per-document affordance should render no menu. |
| `sourceLocale` | the document's content anchor (see [Administering content locales](./04-administering-locales.md)). |
| `resolvedLocale` | the locale the fields were selected in: the first eligible chain entry under `'fallback'`, the requested locale for an eligible exact read, or `null` for a withheld public exact read, a `locale: 'all'` read, or a locale-agnostic version. It says which locale was selected, not that every field is linguistically in it. Populated targets and tree nodes carry their own. |

Because `@byline/client` defaults to `status: 'published'` and the ledger
resolves against the current *published* version, `_availableVersionLocales` on a
normal read is the **published-complete** set. Public reads expose it unchanged,
including complete locales that are unchecked: the checkbox controls delivery of
translated values, not secrecy about translation activity. A preview or
`status: 'any'` read reports the latest version's ledger, which can describe a
draft, so do not use it as public discovery metadata. These fields unify three host consumers (`hreflang`,
`sitemap.xml`, and the "Also available in…" menu) on **one** source, so they
cannot drift.

## Code map (content locales)

| Concern | Location |
|---|---|
| Locale eligibility, `resolvedLocale`, visibility defaults (`resolveReadLocale`, `resolveLocaleVisibility`) | `packages/core/src/storage/locale-resolution.ts` |
| Public/editorial read assertions (`assertLocaleVisibility`) | `packages/core/src/auth/assert-locale-visibility.ts` |
| Locale chain builder, gate, and effective-locale SQL | `packages/db-postgres/src/modules/storage/storage-queries.ts`, `packages/db-mysql/src/modules/storage/storage-queries.ts` |
| Shared adapter conformance | `packages/db-conformance/src/suites/locale-visibility.ts`, `locale-query-semantics.ts` |
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
| Host advertised-set resolver + preview discovery suppression | `apps/webapp/src/lib/alternates.ts` |
| Re-import that establishes the advertised set | `apps/webapp/byline/scripts/import-docs.ts` |
| Ledger backfill for pre-existing versions | `apps/webapp/byline/scripts/backfill-version-locales.ts` |

---
