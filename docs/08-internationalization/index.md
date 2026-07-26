---
title: "Internationalization (i18n)"
path: "i18n"
summary: "Byline separates interface translation from content translation, and treats both independently from the language a document is published in. An overview of the three i18n axes — host interface, admin interface, and content locales — and how they stay decoupled."
---

# Internationalization (i18n)

Byline's i18n grew out of a recurring requirement: sites where content is
translated *independently* of the interface it is presented in. Supporting that
cleanly is one of the reasons Byline exists.

The result **separates interface translations from content translations**. A
site can present content in one or more translations that lie entirely *outside*
its own interface translations — and it does so correctly: additionally-translated
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

:::note[Reference-app note]
The example app in this repo is configured more modestly than the table above
— host interface `en`/`fr`, admin interface `en`/`fr`, content
`en`/`fr`/`es`/`de` — because that is enough to exercise every mechanism. The
table shows what the system *permits*, not what the demo ships.
:::

## How this section is organised

- **[The host i18n system](./01-host-i18n.md)** — the public-site half: routable
  vs advertised locales, the non-sticky rule, and clean default-locale URLs.
- **[Admin interface translations](./02-admin-translations.md)** — what language
  the Byline admin UI renders in, owned by the `@byline/i18n` package.
- **[Content locales](./03-content-locales.md)** — what language a *document*
  publishes in: resolution, fallback, and the editorial advertising control.
- **[Administering content locales](./04-administering-locales.md)** — switching a
  system's default content locale safely.

The two Byline-owned systems are deliberately independent: the admin shell
language switcher never forces document content into the same language, and the
public site's content locale never forces the admin chrome into the visitor's
locale.
