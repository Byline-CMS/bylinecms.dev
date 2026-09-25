---
title: "Administering content locales"
path: "i18n-administering"
summary: "How per-document source locales preserve content anchors across installation-default changes, how explicit re-anchoring works, and which read and historical boundaries need consideration."
---

# Administering content locales

Companions:
- [Content locales](./03-content-locales.md) — what a content locale is, and the resolution / fallback / advertising machinery this administrative task operates on.
- [Document Paths](../04-collections/05-document-paths.md) — the per-`(document, locale)` path row that a re-anchor moves onto the new default locale.
- [Internationalization](./index.md) — the three-axis overview.
- [Content history and document controls](../03-architecture/06-content-history-and-document-controls.md) explains why source locale is stable across default changes and records the open re-anchoring questions.

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
reads are unaffected, but everything anchored to the default breaks.

## The fix: a per-document `source_locale`

Byline records a per-document **`source_locale`** on `byline_documents`. The ordinary
create lifecycle requires the initial content to use the configured default locale;
that becomes the document's source. The fallback floor, stored path locale, and
completeness reference therefore belong to the document rather than following a
mutable global setting.

Changing `i18n.content.defaultLocale` does not change existing documents' sources.
An English-source document remains English-source after the installation default
becomes French; new documents use French. Existing documents can still serve a
permitted French translation. The default also affects requests without an explicit
locale and host search preferences, so this preserves the stored content anchor,
not every aspect of the former site behavior. The initial path-lookup qualification
is described in [Content locales](./03-content-locales.md#the-fallback-chain-and-onmissinglocale).

`source_locale` is surfaced on every read payload as `sourceLocale`, and the
editor shows it as a small neutral badge next to the document title. For
in-place upgrades, the column is populated at boot (`initBylineCore()` stamps any
unstamped rows with the configured default idempotently), so a vanilla
`drizzle:migrate` never fails on a constraint and upgrades self-heal.

## Re-anchoring documents onto the new default

Changing the installation default does not require re-anchoring existing documents.
Re-anchor only when you deliberately want to change their durable source. The
operation checks the latest version's completeness in the target locale; it does
not establish that every retained version is complete there.

The [source interpretation review](../03-architecture/06-content-history-and-document-controls.md#source-interpretation-after-re-anchoring)
records an unresolved case where a complete latest draft permits re-anchoring while
an older published version remains incomplete in the new source. That concern also
applies to historical interpretation and requires regression verification. It is
separate from changing the installation default while retaining existing sources.

The bulk re-anchor is a script
(`apps/webapp/byline/scripts/re-anchor.ts`):

```sh
pnpm tsx byline/scripts/re-anchor.ts --to fr [--collection <path>] [--dry-run]
```

Per document, in one transaction, it: skips documents that are not-found,
already-anchored, or **incomplete in the target locale** (eligibility comes from
the completeness ledger: it refuses to manufacture a translation); otherwise
flips `source_locale`, **moves** the path row onto the target locale (re-tagging
the slug, keeping the URL stable), and writes a new immutable version recomputing
its ledger against the new anchor. Each document is its own transaction, so the
operation is **idempotent and resumable**, and `--dry-run` reports the would-be
outcome plus the backlog. The `skipped-incomplete` report *is* your
outstanding-translation list.

## Search after changing the default

Changing the default is safe for stored documents, but it can change the content-locale slice a host searches. A common host policy maps interface-only URLs to the current default content locale. After an `en → th` change, those searches therefore move from the English index slice to the Thai slice.

Ordinary reads and search then have intentionally different reach:

- a read prefers Thai and can still render an untranslated document through its per-document English `source_locale` floor;
- search returns only documents with a published Thai projection, because indexing uses `onMissingLocale: 'omit'` and does not create fallback copies.

Before changing the default, assess translation coverage for the content users must be able to find. Either complete those translations, provide an explicit content-locale selector and scoped empty-state recovery, or accept that fallback-rendered documents remain absent from the new default's search results. Re-anchoring and fallback-aware search are separate concerns: re-anchoring changes the durable document floor, while fallback-aware search is not currently a shipped capability.
