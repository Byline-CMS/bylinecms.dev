---
'@byline/core': minor
'@byline/client': minor
'@byline/db-postgres': minor
'@byline/db-mysql': minor
'@byline/richtext-lexical': minor
'@byline/admin': minor
'@byline/host-tanstack-start': minor
'@byline/i18n': minor
'@byline/cli': minor
---

Make advertised locales authoritative for public delivery (#102). In a collection with `advertiseLocales: true`, a public read now delivers a translation only while its checkbox is set and the selected published version is complete in it. A complete but unchecked translation behaves like a missing one. The source language is always delivered, whether or not its checkbox is set, and authorized preview can review unchecked translations.

**Locale visibility.** Reads gain `localeVisibility: 'public' | 'editorial'`, defaulting from `status`: `published` or omitted reads are `public`, and `any` reads are `editorial`. `editorial` delivers any complete translation and requires an authenticated actor. The two are independent, so `status: 'published', localeVisibility: 'editorial'` reviews unchecked translations of the published version. `_bypassBeforeRead` skips `beforeRead` scoping only, never locale visibility. Collections without `advertiseLocales` keep completeness-based resolution.

**One policy across the read surface.** Core decides eligibility in one place (`resolveReadLocale`), and the Postgres and MySQL adapters apply it identically before projection, hooks and queries:

- `fallback` reads select the first eligible locale, ending at the source;
- `omit` excludes the document;
- public `empty` reads withhold localized values.

Localized `where` filters, sorts, list text queries, relation hops and tree structural reads evaluate each document in the locale it is shown in. Populated relation targets resolve under their own collection's checkboxes. Save-time rich-text embeds always read targets with public visibility, so an editor's save cannot copy an unchecked translation into a snapshot.

**`resolvedLocale`.** Every reconstructed `ClientDocument`, populated target and tree node now carries `resolvedLocale: string | null`: the locale its fields were selected in. It is `null` for a withheld public exact read, a `locale: 'all'` read, or a locale-agnostic version. Locale-agnostic results also report `_localeAgnostic` on every read surface. Public reads keep exposing `_availableVersionLocales` for the selected published version, including complete unchecked locales; the checkbox controls delivery of translated values, not secrecy about translation activity.

**Search.** Indexing pins `localeVisibility: 'public'`, so an index slice holds only the source and checked, complete translations. The reference and scaffolded hooks reindex on `requested.path || requested.availableLocales`, including no-op reconciliation retries. Every public search re-checks each hit's locale, even without `beforeRead`, and hydrates in the hit's own locale with no source substitution. Public search results therefore use the restricted convention:

- `total` is the number of surviving hits on the returned page;
- provider facets are omitted;
- a page can be short.

**Rich text.** Read-time population replaces copied target values rather than merging them. A link whose target yields no path loses its old path and is marked `_resolved: false`. An inline image whose media is missing, denied or unusable loses its copied image data and preview.

**Admin and preview.** One preview toggle now describes itself as showing saved drafts and withheld translations. The Preview button keeps the selected content locale even when it is unchecked, and says that unsaved changes are not included. The advertised-locales widget explains the public delivery rule. The source row states that the source stays available while published, whatever its checkbox. The save confirmation explains that checking an already-published translation makes it public as soon as the save commits, while a draft-only translation stays hidden until published. All eight admin bundles are updated.

## Compatibility

Two public-read changes apply to **every** collection, whether or not it advertises locales:

- **Public `onMissingLocale: 'empty'` withholds incomplete additional translations.** An exact public read could previously return a partial translation's stored values; it now returns empty localized fields with non-localized values intact. Editorial `empty` reads still return partial values for editing.
- **Public reads reject `locale: 'all'`** with `ERR_VALIDATION`. Multi-locale reads are editorial: pass `status: 'any'` or `localeVisibility: 'editorial'` with an authenticated actor.

In collections that advertise locales, **complete translations that were never checked stop being publicly delivered.** Before upgrading, review each document's advertised locales and check the translations you intend to publish. No translation is checked automatically, and no schema or data migration is required. After upgrading, rebuild each search index (`client.collection(path).reindex()` or the admin Reindex button) and clear application caches with your existing procedures.

Public search totals are now page-local for every public search, not only restricted ones. A results page that shows "N results" from a public search shows the hits on that page.

A combined content and advertised-locale save is one request and one guarded transaction: both commit or neither does. This was already the storage behaviour; the admin copy and documentation now describe it correctly.

Withdrawal has the same limits as unpublish:

- fresh origin reads change immediately;
- local caches clear through the reference hooks;
- cluster fan-out is best-effort;
- CDN responses remain until their TTL unless purged;
- rich-text snapshots saved into other documents keep their copied values until those documents are refreshed or re-saved.

Hosts building preview URLs should keep the editor's selected `locale` and apply their public routing rule. The scaffolded Pages builder no longer uses the admin interface default for the prefix. See `docs/08-internationalization/03-content-locales.md`.
