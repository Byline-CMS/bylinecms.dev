---
title: "Administering content locales"
path: "i18n-administering"
summary: "The administrative task of switching a system's default content locale safely: why the default doubles as a per-document data anchor, the per-document source_locale that makes the switch a non-event, and the bulk re-anchor workflow for moving documents onto a new default."
---

## Switching the default content locale

A system's default content locale (`i18n.content.defaultLocale`) does two
different jobs:

1. **A config preference** — which locale new content is authored in, and which
   locale is served for a request that doesn't specify one. Genuinely global, and
   genuinely should be switchable.
2. **A per-document data anchor** — every document's content rows, its path row,
   and its completeness ledger were originally written *keyed to whatever the
   default was at write time*.

Job (2) is the trap. If the default were *only* a global config value, flipping
`en → fr` on a live system would silently re-interpret every existing document
against an anchor it was never written for: `en`-authored fields would read empty
(the fallback floor moves to `fr`, which is empty), `findByPath(slug, 'fr')` would
404 (path rows live under `en`), and the completeness yardstick would become
meaningless. Non-localized content (the `'all'` sentinel) and explicit `'en'`
reads are unaffected — but everything anchored to the default breaks.

## The fix: a per-document `source_locale`

Byline records a per-document **`source_locale`** on `byline_documents`, set once
at creation to the locale the first version was authored in (defaulting to the
global config default *at that moment*). It re-bases each anchor — the fallback
floor, the path locale, the completeness yardstick — from "the global config" to
"this document's own truth." With that column in place, **switching
`i18n.content.defaultLocale` is a non-event for existing data**: every document
rides its own `source_locale`, and the global default is demoted to its honest
role — the authoring default for *new* documents plus the request-time fallback
when a read specifies no locale.

`source_locale` is surfaced on every read payload as `sourceLocale`, and the
editor shows it as a small neutral badge next to the document title. For
in-place upgrades, the column is populated at boot — `initBylineCore()` stamps any
unstamped rows with the configured default idempotently — so a vanilla
`drizzle:migrate` never fails on a constraint and upgrades self-heal.

## Re-anchoring documents onto the new default

Switching the config is safe immediately, but the *harder* part of actually
*moving* documents onto the new default is having them fully translated into it —
the system can never manufacture a primary language with holes. So the realistic
workflow is: **flip the config → translate documents into the new locale over
time → re-run the bulk re-anchor to sweep up the now-complete ones.**

The bulk re-anchor is a script
(`apps/webapp/byline/scripts/re-anchor.ts`):

```sh
pnpm tsx byline/scripts/re-anchor.ts --to fr [--collection <path>] [--dry-run]
```

Per document, in one transaction, it: skips documents that are not-found,
already-anchored, or **incomplete in the target locale** (eligibility comes from
the completeness ledger — it refuses to manufacture a translation); otherwise
flips `source_locale`, **moves** the path row onto the target locale (re-tagging
the slug, keeping the URL stable), and writes a new immutable version recomputing
its ledger against the new anchor. Each document is its own transaction, so the
operation is **idempotent and resumable** — and `--dry-run` reports the would-be
outcome plus the backlog. The `skipped-incomplete` report *is* your
outstanding-translation list.

