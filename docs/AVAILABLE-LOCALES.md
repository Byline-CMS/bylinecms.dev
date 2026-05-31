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

## Open decisions

1. **Directive** — explicit (`advertiseLocales: true`) vs auto-on for any
   collection with `localized` fields.
2. **Default policy** — opt-in (nothing advertised until toggled) vs opt-out
   (available locales default to advertised). The false-positive concern argues
   opt-in.
3. **Read surfacing** — expose a core-computed `_advertisedLocales` (intersection)
   or leave the intersection to the host.
4. **Naming proximity** — `availableLocales` (stored) vs `_availableLocales`
   (derived) differ only by the underscore. Consistent with the `path` /
   `_restoreWarnings` convention (stored vs computed), but worth a lint/docs note
   so they aren't confused in host code.
