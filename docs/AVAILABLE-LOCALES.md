---
title: "Available Locales"
path: "available-locales"
summary: "Promotes the editorial 'advertise these locales' control from a userland custom field to a core system attribute + ledger-aware sidebar widget — the second instance of the path-widget pattern. Stored document-grain like path; reconciled at read time against the structural _availableLocales ledger."
---

# Available Locales

> **Status:** Design / decision record. Not yet implemented. Supersedes the
> userland `availableLanguagesField()`
> (`apps/webapp/byline/fields/available-languages-field.ts`), folding it into
> core as a system attribute + widget.

Companions:
- [DOCUMENT-PATHS.md](./DOCUMENT-PATHS.md) — the first system attribute promoted
  out of the field tree. `availableLocales` is the **second instance** of the
  same pattern (reserved name → directive → non-field widget → lifecycle param)
  and stores at the same **document grain**.
- [CONTENT-LOCALE-RESOLUTION.md](./CONTENT-LOCALE-RESOLUTION.md) — defines the
  *availability* side: `byline_document_version_locales` (the ledger) and the
  `_availableLocales` read metadata this control reconciles against.

## Overview

`availableLocales` is the **editorial advertising** control for a document: the
set of content locales the editor wants *promoted* — in hreflang, the sitemap,
and a per-page "Also available in…" menu. It is the deliberate counterpart to
the automatic structural fact:

| | what | source | grain | mutability |
|---|---|---|---|---|
| **`_availableLocales`** | "this version is **complete** in these locales" (path-coverage) | the ledger (`byline_document_version_locales`) | version | derived, read-only |
| **`availableLocales`** | "I want these locales **advertised**" | this system attribute | document | stored, editor-set |

They must stay separate — a version can be *structurally* complete in `de`
(every localized field has text) while the editor does **not** consider it ready
to advertise (placeholder copy, mid-edit, legal review). Trusting the ledger
alone would drag that `de` into public hreflang; trusting the field alone could
advertise a `de` translation that no longer exists. So the public advertised set
is the **intersection**:

```
advertised = availableLocales (editorial)  ∩  _availableLocales (ledger)
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

| ledger (`_availableLocales`) | toggle | state |
|---|---|---|
| ✓ complete | on | **advertised** |
| ✓ complete | off | *ready, held back* (your safe state) |
| ✗ incomplete | off | nothing to do |
| ✗ incomplete | on | ⚠ *advertising an incomplete locale* |

That ⚠ row **is** the deferred Phase-5 cross-check (`availableLanguages` ↔ ledger
disagreement) — realized as **inline editorial UX** at the moment of decision
rather than a passive boot/save warning. Open knobs: opt-in (advertise nothing
until toggled — safest) vs opt-out default; and disable-vs-warn on the ⚠ row
(lean: allow-with-warning, since content states are fluid).

For the widget to render the ledger column it needs `_availableLocales` at edit
time — the admin edit response currently **strips** it (Zod parse drops unknown
keys; `get.ts` already re-attaches `_restoreWarnings` explicitly, line ~151). So
`_availableLocales` must be preserved across that parse — the one prerequisite.

## Read surfacing

- `availableLocales` — the stored editorial set (top-level, like `path`).
- `_availableLocales` — the ledger fact (derived, already shipped in Phase 6).
- The host computes `advertised = availableLocales ∩ _availableLocales` for
  `resolveAlternates` / sitemap / menu. **Open decision:** whether core should
  expose the pre-reconciled set directly (a derived `_advertisedLocales`) so the
  host consumes one field, vs. leaving the intersection to the host.

## Migration

Remove `apps/webapp/byline/fields/available-languages-field.ts` and the
`availableLanguages` group from the `news` / `pages` / `docs` schemas; the
control becomes the core attribute (opt-in via the directive). Existing
`availableLanguages` field values would be migrated into the new
`(document_id, locale)` store as the initial advertised set.

## Implementation plan (sliced)

Each slice is independently committable (green) and mirrors the `path` system
attribute. Slices 1–3 are mechanical mirrors of `path` and go fast; 4–5 (the
widget + form-context state) are the real work. Done so far: the userland field
is marked `@deprecated`/reference (`apps/webapp/byline/fields/available-languages-field.ts`);
**Slice 1 shipped** (see below).

1. ✅ **Core reserve + directive** (`@byline/core`) — `'availableLocales'` added
   to `RESERVED_FIELD_NAMES` (`config/validate-collections.ts`); explicit opt-in
   directive `advertiseLocales?: boolean` on `CollectionDefinition`
   (`@types/collection-types.ts`), validated to require ≥1 `localized` field
   (advertising locales is meaningless otherwise) and folded into the collection
   fingerprint. Reserved-name error now branches per name (path → `useAsPath`,
   availableLocales → `advertiseLocales`). **Decision #1 settled: explicit
   directive, not auto-on.** Tests in `validate-collections.test.node.ts`.
2. **Storage primitive** (`@byline/db-postgres`) — `byline_document_available_locales
   (document_id, locale)` table (document-grain, mirrors `byline_document_paths`)
   + migration; `storage-commands` upsert/replace the rows (top-level lifecycle
   param, like the path upsert); `storage-queries` project `availableLocales`
   onto `getDocumentById`/`getDocumentByPath`/`findDocuments` (like the path
   projection); optionally emit core-computed `_advertisedLocales = availableLocales
   ∩ _availableLocales`. + tests.
3. **Lifecycle threading** (`@byline/core`) — thread `availableLocales` as a
   top-level param through `document-lifecycle` create/update → `createDocumentVersion`,
   mirroring `path`.
4. **Admin form-context state** (`@byline/admin`) — mirror the `systemPath`
   machine in `forms/form-context.tsx`: `systemAvailableLocalesRef`, get/set,
   `__systemAvailableLocales__` dirty-tracking, listeners.
5. **The widget** (`@byline/admin`) — `forms/available-locales-widget.tsx`
   (+ `.module.css` + test), based on the existing custom field's
   checkbox-per-locale UI but **ledger-aware** (the reconciliation grid above),
   rendered in the sidebar **below the path widget**.
6. **Host wiring** (`@byline/host-tanstack-start`) — `server-fns/collections/get.ts`:
   **preserve `_availableLocales` through the Zod parse** (prerequisite for the
   widget's ledger column; mirrors how `_restoreWarnings` is preserved ~line 151)
   + surface `availableLocales`; `create.ts`/`update.ts` pass the param.
7. **Migration** — map existing `availableLanguages` field values into the new
   store; drop the field from the `news`/`pages`/`docs` schemas.

**To resume in a fresh session:** read this doc, then start at **Slice 2**
(Storage primitive — first unchecked slice) on branch
`feat/content-locale-resolution`. The `path`
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
2. **Default policy** — opt-in (nothing advertised until toggled) vs opt-out
   (available locales default to advertised). The false-positive concern argues
   opt-in.
3. **Read surfacing** — expose a core-computed `_advertisedLocales` (intersection)
   or leave the intersection to the host.
4. **Naming proximity** — `availableLocales` (stored) vs `_availableLocales`
   (derived) differ only by the underscore. Consistent with the `path` /
   `_restoreWarnings` convention (stored vs computed), but worth a lint/docs note
   so they aren't confused in host code.
