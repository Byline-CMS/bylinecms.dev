---
title: "Available Locales"
path: "available-locales"
summary: "Promotes the editorial 'advertise these locales' control from a userland custom field to a core system attribute + ledger-aware sidebar widget — the second instance of the path-widget pattern. Stored document-grain like path; reconciled at read time against the structural _availableVersionLocales ledger."
---

# Available Locales

> **Status:** Implemented (shipped 3.0, 2026-06-01). Opt a collection in with
> `advertiseLocales: true` on its `CollectionDefinition`; core renders the
> available-locales sidebar widget (`availableLocales` is a reserved name — not
> layout-addressable), stores the set document-grain, and reconciles it at read
> time against the ledger. Supersedes the userland `availableLanguagesField()`,
> folding it into core as a system attribute + widget.

Companions:
- [DOCUMENT-PATHS.md](./DOCUMENT-PATHS.md) — the first system attribute promoted
  out of the field tree. `availableLocales` is the **second instance** of the
  same pattern (reserved name → directive → non-field widget → lifecycle param)
  and stores at the same **document grain**.
- [CONTENT-LOCALE-RESOLUTION.md](./CONTENT-LOCALE-RESOLUTION.md) — defines the
  *availability* side: `byline_document_version_locales` (the ledger) and the
  `_availableVersionLocales` read metadata this control reconciles against.

## Overview

`availableLocales` is the **editorial advertising** control for a document: the
set of content locales the editor wants *promoted* — in hreflang, the sitemap,
and a per-page "Also available in…" menu. It is the deliberate counterpart to
the automatic structural fact:

| | what | source | grain | mutability |
|---|---|---|---|---|
| **`_availableVersionLocales`** | "this version is **complete** in these locales" (path-coverage) | the ledger (`byline_document_version_locales`) | version | derived, read-only |
| **`availableLocales`** | "I want these locales **advertised**" | this system attribute | document | stored, editor-set |

They must stay separate — a version can be *structurally* complete in `de`
(every localized field has text) while the editor does **not** consider it ready
to advertise (placeholder copy, mid-edit, legal review). Trusting the ledger
alone would drag that `de` into public hreflang; trusting the field alone could
advertise a `de` translation that no longer exists. So the public advertised set
is the **intersection**:

```
advertised = availableLocales (editorial)  ∩  _availableVersionLocales (ledger)
```

This handles both failure modes: *complete-but-not-blessed* (field-off ⇒ out)
and *blessed-but-no-longer-complete* (ledger drops it ⇒ out).

## Why a system attribute, not a field

The moment the control needs to **read the ledger** and **reconcile** against it,
it stops being content (a field) and becomes *system metadata edited in the admin
form* — exactly the category the path widget established. A userland field can't
cleanly reach the ledger; core can. The SEO *semantics* (how the advertised set
maps to hreflang/sitemap URLs) stay host-side — same boundary as `path` (core
stores the value; the host composes the URL).

## Anatomy (mirrors the path widget)

| Path widget | Available-locales widget |
|---|---|
| `path` reserved attribute | `availableLocales` reserved attribute |
| stored in `byline_document_paths` `(document_id, locale)` | stored `(document_id, locale)` (one row per advertised locale) — **document-grain, sticky across versions** |
| `useAsPath` directive opts a collection in | a directive opts a collection in (e.g. `advertiseLocales: true`, or auto-on when the collection has `localized` fields) |
| non-field `path-widget.tsx` (`@byline/admin`) | non-field, **ledger-aware** widget in `@byline/admin`, rendered in the sidebar **directly below the path widget** |
| persisted via top-level lifecycle param (not a `field.set` patch) | same — top-level lifecycle param |
| surfaced on reads as `path` | surfaced on reads as `availableLocales` |

Document-grain + sticky means editorial intent carries forward across edits and
survives restore (it's about the document, not a version) — the version-grain
ledger supplies the per-version reality at read time via the intersection above.

## The widget: a reconciliation grid

Per content locale, the widget shows the ledger fact beside the editor's toggle:

| ledger (`_availableVersionLocales`) | toggle | state |
|---|---|---|
| ✓ complete | on | **advertised** |
| ✓ complete | off | *ready, held back* (your safe state) |
| ✗ incomplete | off | nothing to do |
| ✗ incomplete | on | ⚠ *advertising an incomplete locale* |

That ⚠ row **is** the deferred Phase-5 cross-check (`availableLanguages` ↔ ledger
disagreement) — realized as **inline editorial UX** at the moment of decision
rather than a passive boot/save warning. **Both knobs settled in Slice 5:**
**opt-in** (advertise nothing until the editor toggles — safest), and
**allow-with-warning** on the ⚠ row (amber `warning` intent, kept enabled so the
editor can uncheck to resolve). Realized purely through Checkbox `intent`
colour — no per-row text.

For the widget to render the ledger column it needs `_availableVersionLocales` at edit
time. The admin edit response would otherwise **strip** it (Zod parse drops unknown
keys), so `get.ts` now preserves it across the parse alongside `availableLocales` and
`_restoreWarnings` (Slice 6).

## Read surfacing

- `availableLocales` — the stored editorial set (top-level, like `path`).
- `_availableVersionLocales` — the ledger fact (derived, already shipped in Phase 6).
- The host computes `advertised = availableLocales ∩ _availableVersionLocales` for
  `resolveAlternates` / sitemap / menu. **Open decision:** whether core should
  expose the pre-reconciled set directly (a derived `_advertisedLocales`) so the
  host consumes one field, vs. leaving the intersection to the host.

How a host turns that advertised set into canonical / hreflang / sitemap / the
"Also available in…" menu — and the non-sticky locale routing it pairs with — is
a **host concern**, not core's. See [Core vs host: who owns URLs, hreflang,
sitemap, and meta](./CONTENT-LOCALE-RESOLUTION.md#core-vs-host-who-owns-urls-hreflang-sitemap-and-meta)
for the boundary and a worked reference in `apps/webapp`.

## Migration

The userland `available-languages-field.ts` and the `availableLanguages` group
were removed from the `news` / `pages` / `docs` schemas; the control is now the
core attribute (opt in via `advertiseLocales: true`). For this repo the advertised
set is established on (re-)import rather than by a data migration — `import-docs.ts`
sets `availableLocales` directly. A standalone site with existing
`availableLanguages` values would map them into the new `(document_id, locale)`
store as the initial advertised set.

## Implementation plan (sliced)

Each slice is independently committable (green) and mirrors the `path` system
attribute. Slices 1–3 are mechanical mirrors of `path`; 4–5 (the widget +
form-context state) are the real work. **Slices 1–6 shipped (3.0, 2026-06-01)**;
Slice 7 (data migration) is moot for this repo — see Migration above. The userland
field has since been removed entirely.

1. ✅ **Core reserve + directive** (`@byline/core`) — `'availableLocales'` added
   to `RESERVED_FIELD_NAMES` (`config/validate-collections.ts`); explicit opt-in
   directive `advertiseLocales?: boolean` on `CollectionDefinition`
   (`@types/collection-types.ts`), validated to require ≥1 `localized` field
   (advertising locales is meaningless otherwise) and folded into the collection
   fingerprint. Reserved-name error now branches per name (path → `useAsPath`,
   availableLocales → `advertiseLocales`). **Decision #1 settled: explicit
   directive, not auto-on.** Tests in `validate-collections.test.node.ts`.
2. ✅ **Storage primitive** (`@byline/db-postgres`) — `byline_document_available_locales
   (document_id, locale, collection_id)` table (document-grain, mirrors
   `byline_document_paths`; PK on `(document_id, locale)`) + migration;
   `storage-commands.createDocumentVersion` takes an `availableLocales?: string[]`
   param and **replaces the set wholesale** (delete-then-insert; `undefined` =
   leave untouched/sticky, `[]` = clear); `storage-queries` projects
   `availableLocales` onto `getDocumentById`/`getDocumentByPath`/`findDocuments`
   via a batched `getAdvertisedLocalesByDocument` helper. **The ledger fact was
   renamed `_availableLocales` → `_availableVersionLocales`** (Decision #4
   settled) to disambiguate from the editorial `availableLocales`; storage raw
   keys now match the client surface (passthrough in `client/response.ts`, no
   boundary rename). `_advertisedLocales` (intersection) deferred — left to the
   host (Decision #3). Tests in `storage-document-available-locales.test.ts`.
3. ✅ **Lifecycle threading** (`@byline/core`) — `availableLocales?: string[]`
   threaded as a top-level param through `createDocument` / `updateDocument` /
   `updateDocumentWithPatches` → `createDocumentVersion` (and declared on the
   `IDocumentCommands.createDocumentVersion` interface in `@types/db-types.ts`).
   Also surfaced on `@byline/client` `CreateOptions` / `UpdateOptions` so the SDK
   write path threads it too. Simpler than `path` — no slugify/derive, no
   per-locale gate (the set is document-grain, locale-independent): the param is
   passed straight through, and the storage layer's `undefined` = sticky gives
   the carry-forward for free. `restoreVersion` / `duplicate` / `copyToLocale`
   deliberately left un-threaded (sticky / safe-empty default). Unit pass-through
   tests in `write-path.test.node.ts`; end-to-end (create/sticky/replace/clear)
   in `client-write.integration.test.ts`.
4. ✅ **Admin form-context state** (`@byline/admin`) — mirrored the `systemPath`
   machine in `forms/form-context.tsx`: `systemAvailableLocalesRef` +
   `initialSystemAvailableLocales` baseline, `get/set/subscribeSystemAvailableLocales`,
   `__systemAvailableLocales__` dirty-tracking, listeners, `resetHasChanges`
   re-baselining, and the `useSystemAvailableLocales()` hook (auto-exported via
   the `@byline/admin/react` barrel's `export *`). One necessary divergence from
   `path`: the slot holds `string[]`, so dirty-tracking uses order-insensitive
   set equality (`sameLocaleSet`) instead of `!==`, and set/get store/return
   defensive copies. The form-renderer→onSubmit payload read and server
   pass-through are deferred to Slices 5/6 (the slot is inert until the widget
   writes it and the save path reads it) — matching how `systemPath` is wired.
   Verified via typecheck; behavioural coverage arrives with the widget (Slice 5),
   mirroring `systemPath` (which likewise has no isolated form-context test).
5. ✅ **The widget** (`@byline/admin`) — `forms/available-locales-widget.tsx`
   (+ `.module.css`), one checkbox per content locale rendered in the sidebar
   **below the path widget**, gated on a new `advertiseLocales?: boolean`
   `FormRenderer` prop (the host passes `definition.advertiseLocales` in Slice 6).
   **The reconciliation is expressed purely as Checkbox `intent` — no per-row
   text** (Tony's design): `success` (green) when the locale is in
   `_availableVersionLocales` (toggleable), `noeffect` + disabled when not
   (nothing to advertise), `warning` (amber, **enabled**) for the ⚠ case
   (advertised but no longer complete — editor can uncheck to resolve). Checked
   state reflects the stored set via `useSystemAvailableLocales`; **opt-in** —
   nothing advertised until the editor checks a green locale (Decision #2). The
   intent/disabled decision is a pure, React-free helper
   (`available-locales-reconcile.ts` → `reconcileLocaleState`) unit-tested in
   `available-locales-reconcile.test.node.ts` (the admin suite only runs
   `*.test.node.ts` under node, so the logic was extracted out of the `.tsx`).
   New i18n keys `availableLocalesWidget.{label,srDescription}` (EN/FR) — heading
   + a11y only; the per-row reconciliation stays string-free. **The save loop is
   not yet closed**: the widget writes the form-context slot (Slice 4) but the
   `onSubmit` payload read + host forward + server pass-through are Slice 6, so
   the widget is inert end-to-end until then (and only renders once the host
   passes `advertiseLocales`).
6. ✅ **Host wiring** (`@byline/host-tanstack-start`) — closes the loop.
   `server-fns/collections/get.ts` now **preserves both `availableLocales`
   (editorial → initialises the form-context slot / checked state) and
   `_availableVersionLocales` (ledger → drives the widget's per-row intent)
   through the Zod parse** (mirrors the `_restoreWarnings` preservation).
   `create.ts` / `update.ts` accept an `availableLocales` param and pass it to
   the lifecycle. The admin `edit.tsx` / `create.tsx` pass
   `advertiseLocales={definition.advertiseLocales}` into `FormRenderer` and
   forward `systemAvailableLocales` from the `onSubmit` payload as
   `availableLocales`. `FormRenderer` emits `systemAvailableLocales` (from the
   Slice-4 slot) **only when `advertiseLocales` is set** — non-advertising
   collections never touch `byline_document_available_locales`. Verified by the
   25/25 workspace typecheck; the create/update→read round-trip is the same
   lifecycle path the Slice-3 `client-write.integration.test.ts` proves end-to-end.
7. ✅ **Migration (schema drop)** — the `availableLanguages` group was dropped
   from the `news`/`pages`/`docs` schemas and the userland field removed. No
   data-migration step was needed in this repo: `import-docs.ts` establishes the
   advertised set directly on (re-)import.

**Shipped (3.0, 2026-06-01).** The feature works end-to-end: opt a collection in
with `advertiseLocales: true`, edit, toggle green locales, save. The `path`
system attribute is the working reference at every layer
(`docs/DOCUMENT-PATHS.md`); grep `useAsPath` / `systemPath` / `byline_document_paths`
to find each analog.

## Open decisions

1. ~~**Directive** — explicit (`advertiseLocales: true`) vs auto-on for any
   collection with `localized` fields.~~ **Settled (Slice 1): explicit
   `advertiseLocales: true`**, validated to require ≥1 `localized` field.
   Beyond symmetry with `useAsPath`, explicit was chosen because its *absence*
   carries meaning — a collection without it is implicitly "default-locale
   only." Auto-on can't express that; it would silently assume content locales
   are **system-wide** and bake that into the capability rule. Staying explicit
   keeps the larger, still-open question — *are content locales collection-scoped
   or system-wide?* — deferred rather than answered by accident. The cheap,
   reversible choice avoids foreclosing the expensive, hard-to-reverse one; if
   content locales later become collection-defined, `advertiseLocales` (already
   per-collection) slots in unchanged.
2. ~~**Default policy** — opt-in (nothing advertised until toggled) vs opt-out
   (available locales default to advertised).~~ **Settled (Slice 5): opt-in.**
   The checkbox reflects the stored set; a green (ledger-complete) locale is an
   invitation, not an auto-advertise. Avoids pushing un-reviewed translations
   live and sidesteps the "never decided vs explicitly off" state opt-out needs.
3. **Read surfacing** — expose a core-computed `_advertisedLocales` (intersection)
   or leave the intersection to the host.
4. ~~**Naming proximity** — `availableLocales` (stored) vs `_availableLocales`
   (derived) differ only by the underscore.~~ **Settled (Slice 2): the ledger
   fact was renamed `_availableLocales` → `_availableVersionLocales`.** The
   editorial set keeps `availableLocales` (stored, no underscore, like `path`);
   the ledger fact now names its grain (version) rather than relying on a lone
   underscore, so the two can't be confused in host code. `_localeAgnostic`
   was left unchanged (no collision).
