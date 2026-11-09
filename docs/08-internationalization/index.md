---
title: "Internationalization (i18n)"
path: "i18n"
summary: "Byline separates interface translation from content translation, and treats both independently from the language a document is published in. An overview of the three i18n axes (host interface, admin interface, and content locales) and how they stay decoupled."
---

# Internationalization (i18n)

Companions:
- [Configuration](../01-getting-started/03-configuration.md) — how `locales.ts`, `i18n.ts`, and `public.ts` divide public-safe data from admin translation registration.
- [Configuration API](../10-api-reference/01-configuration.md) — the exact `i18n.admin`, `i18n.content`, locale-definition, and translation-bundle properties.
- [Document paths](../04-collections/05-document-paths.md) — how source locale and path resolution interact.

Byline's i18n grew out of a recurring requirement: sites where content is
translated *independently* of the interface it is presented in. Supporting that
cleanly is one of the reasons Byline exists.

The result **separates interface translations from content translations**. A
site can present content in one or more translations that lie entirely *outside*
its own interface translations, and it does so correctly: additionally-translated
pages get the right `hreflang`, canonical, and sitemap entries (everything needed
to make a translated document discoverable) while preventing a content
translation from becoming a "switched", unknown *interface* locale that sticks to
the rest of the site as the visitor navigates.

## Three independent axes

There are two separate-but-coordinated translation systems, plus a third,
independent axis:

- **The host system** — your application. It owns the public site's chrome
  language and URL strategy, and it needs to be *aware* of the content languages
  Byline can serve so it can route to and advertise them.
- **Byline's admin interface system** — completely isolated from the host, used
  *exclusively* to render Byline's own admin-interface chrome.
- **Content locales** — the languages a *document* can be published in. Defined
  inside Byline, separate from and independent of the admin-interface
  translations.

All three can differ. A realistic configuration:

| Axis | Owner | Example |
|---|---|---|
| **Host interface** translations | the host frontend | `en`, `fr` |
| **Byline admin interface** translations | `@byline/i18n` | `en`, `fr`, `es`, `de`, … |
| **Byline content** translations | Byline storage / read pipeline | `en`, `fr`, `es`, `de`, `zh-CN`, `ja-JP`, `ko-KR` |

The three sets overlap only by coincidence. An editor working in a
Spanish-language admin chrome routinely edits English, French, and German
content; a visitor reading the English public site can be handed one Japanese
article without the site flipping into Japanese around them.

Search adds a fourth input without creating a fourth locale configuration: the language or scripts in the visitor's query text. The host still selects a result **content locale** for `SearchQuery.locale`; that scope does not have to match the interface locale or the query language, and it does not imply query translation or cross-lingual retrieval. See [Search API](../06-search/03-search-api.md#result-locale-and-query-language).

:::note[Reference-app note]
The example app keeps its public host interface to `en`/`fr`. Its Byline admin
interface enables `en`, `fr`, `es`, `de`, `it`, `zh-CN`, and `ko`; its content
locales are `en`, `fr`, `es`, `de`, `zh-CN`, and `th-TH`. The three sets remain
independent even when some codes overlap.
:::

## Changing field localization

A field's `localized` flag controls whether its value is shared or varies by content locale. Changing that flag requires no database migration or separate content migration. Byline reads older versions using the current declaration and converts their stored values when the document is next saved in a single locale. Earlier versions remain unchanged in storage.

When a shared field becomes localized, its old shared value supplies any locale that has no value of its own. An existing value for a particular locale takes precedence. On the next single-locale save, Byline preserves the shared value for the document's source locale and every concrete locale represented in the previous version's stored fields, then merges the submitted locale's edits. It does not create translations for every locale configured in the application. For a document with no other localized values, this normally means its source locale plus the locale being saved.

These copied values still need editorial translation. For example, if a shared English summary becomes localized on a document that already has English and French titles, the French editor initially sees the English summary. Saving a French translation preserves the old summary for English. An all-locale read exposes the converted values as a locale map; projected reads can omit incomplete locales represented only in fields outside the projection.

When a localized field becomes shared, its source-locale value becomes the value seen in every locale. If a shared stored value already exists, that shared value wins. If neither exists, the field is absent; Byline does not choose another translation. The next single-locale save writes the shared value and drops the old translations from the new version. Historical versions retain their stored rows, although reads still interpret them using the current field declaration.

Public delivery continues to use the document's existing locale eligibility until the next save recomputes it. A public exact read of an ineligible locale withholds fields that are currently localized, including a newly localized field's old shared value. A field that is now shared remains visible using the rule above. These two changes—source-locale values replacing former translations and newly localized values being withheld—are intentional. See [public delivery of advertised locales](./03-content-locales.md#public-delivery-of-advertised-locales) for eligibility and fallback rules.

Field filters and sorts follow the current declaration too. If a version already contains both shared and locale-specific rows for the same field, sorts choose the same winning value as reconstruction, but a filter can still match the losing value until a save converts the rows. Substring full-text queries can likewise return extra or missing matches before conversion. See [Core Document Storage](../03-architecture/01-document-storage.md#what-happens-when-you-save-a-document) for the save process and [Client SDK](../05-reading-and-delivery/01-client-sdk.md#write-surface) for whole-document writes and item identity requirements.

## How this section is organised

- **[The host i18n system](./01-host-i18n.md)** — the public-site half: routable
  vs advertised locales, the non-sticky rule, and clean default-locale URLs.
- **[Admin interface translations](./02-admin-translations.md)** — what language
  the Byline admin UI renders in, owned by the `@byline/i18n` package.
- **[Content locales](./03-content-locales.md)** — what language a *document*
  publishes in: resolution, fallback, and the editorial advertising control
  that decides which translations public reads deliver.
- **[Administering content locales](./04-administering-locales.md)** — switching a
  system's default content locale safely.

The two Byline-owned systems are deliberately independent: the admin shell
language switcher never forces document content into the same language, and the
public site's content locale never forces the admin chrome into the visitor's
locale.
