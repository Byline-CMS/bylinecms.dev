---
title: "Admin interface translations"
path: "i18n-admin"
summary: "Translating the Byline admin shell with the @byline/i18n package: registering the bundled locales, the useTranslation hook, server-side translation, ICU message formatting, per-user locale preference, and the extension surface for plugins and custom fields."
---

## Admin interface translations

The Byline admin shell renders end-to-end in English and French today, with
hooks for plugins, custom fields, and extensions to register their own
translations. This is the `@byline/i18n` package.

## Package layout

- **`@byline/i18n`** (root) — React-free: the `TranslationBundle` types,
  `mergeTranslations`, the ICU formatter, and locale resolution. Safe in server
  contexts. Depends on `@byline/core` only — a leaf package.
- **`@byline/i18n/react`** — the single React barrel: `I18nProvider`,
  `useTranslation`, `LanguageMenu`.
- **`@byline/i18n/admin`** — the built-in `byline-admin` namespace bundle (EN/FR)
  plus the `adminTranslations({ locales })` factory.

The host integration lives in `@byline/host-tanstack-start`: per-request locale
resolution (`src/i18n/resolve-locale.ts`), cookie helpers
(`src/i18n/locale-cookie.ts`), a server-side translator
(`src/i18n/server-translator.ts`), and the locale-persistence server fns
(`src/server-fns/i18n/*`).

## Quick reference

Each entry is the minimal shape for one task. The **Edit** line tells you which
file you actually change.

## 1. Enable the bundled English admin

Default registration. Every admin shell string ships in English; no per-locale
work needed yet.

**Edit:** `apps/webapp/byline/admin.config.ts`

```ts
import { defineClientConfig } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'

defineClientConfig({
  i18n: {
    interface: { defaultLocale: 'en', locales: ['en'] },
    translations: adminTranslations({ locales: ['en'] }),
  },
  // … the rest of your client config
})
```

`adminTranslations({ locales })` reads bundled JSON files in
`@byline/i18n/src/admin/` and returns the `byline-admin` namespace for each
requested code. Skipping it is a hard error at startup — the validator refuses to
mount the admin without at least one registered locale.

## 2. Add a second locale

Every bundled translation lives in-package at
`packages/i18n/src/admin/<code>.json`. To enable a locale, list its code in
`i18n.interface.locales` and pass the same codes to
`adminTranslations({ locales })`. Today's bundle ships `en` and `fr`; adding more
is a one-file PR (drop a new JSON, add it to the bundle map).

```ts
defineClientConfig({
  i18n: {
    interface: { defaultLocale: 'en', locales: ['en', 'fr'] },
    translations: adminTranslations({ locales: ['en', 'fr'] }),
  },
})
```

The `interface` block stays separate from the content-locale list — admin UI in
French does not force document content into French.
`adminTranslations({ locales: ['xx'] })` throws at config time when the requested
code is not bundled.

**Authoring a translation for a new locale — what to watch.** Key parity is
enforced mechanically: a unit test asserts every bundled locale carries the exact
same key set as `en.json`, and the boot validator (`initBylineCore()`) fails fast
on a missing bundle and warns on key drift. So a *missing* string fails loudly —
the part that needs human care is *quality*, and three things repay attention
beyond word choice:

- **Plural categories are locale-specific.** ICU plural rules come from CLDR, and
  each message is formatted against its own locale (`new IntlMessageFormat(message,
  locale)`), so the formatter already resolves the right category per language. But
  the *authored* branches must match the target language, not English. English and
  the Romance languages distinguish `one` / `other`; Chinese, Japanese, Korean, and
  Thai have **only `other`**. Don't copy English's `one {…} other {…}` shape
  mechanically into those locales — author a single `other` branch (e.g.
  `{count, plural, other {# 개의 항목}}`). Parity is enforced on the top-level *keys*,
  not on the plural branches inside a value, so you are free — and expected — to
  shape each value the way its language actually works.

- **Grammar around interpolated values.** Several strings interpolate a noun whose
  surrounding grammar depends on that noun — e.g. `"Edit {section}"`,
  `"…collection \"{target}\"."`. Languages with grammatical particles or case
  marking (Korean 을/를, 이/가; and similar elsewhere) change the attached particle
  based on the interpolated word, which isn't known until runtime. Handle it the
  way native UI conventionally does: use the dual-particle form (`{target}을(를)`)
  or rephrase to a noun-adjacent form that needs no particle (`{section} 편집`
  rather than a verb phrase). A naive translation that hard-codes one particle reads
  as machine-generated half the time.

- **Length and rendering.** Translated UI is not the same length as English —
  German commonly runs ~30% longer (watch buttons and fixed-width labels for
  truncation), and CJK scripts need a real visual check for font coverage,
  line-height, and ellipsis handling. Always **render the locale in the actual admin
  UI** before shipping it, not just review the JSON.

Recommended workflow: draft the bundle → render it in the running admin → have a
native speaker review before release, especially for languages whose formality
register or grammar a non-native author can't reliably self-check (CJK in
particular). The mechanical scaffolding (parity test, boot validator) catches
structural gaps; the native review catches register and naturalness.

## 3. Translate a string in your own admin code

Inside any admin shell component or admin server fn output. Same hook everywhere.

```tsx
import { useTranslation } from '@byline/i18n/react'

export function PublishButton() {
  const { t } = useTranslation('byline-admin')
  return <button>{t('actions.publish')}</button>
}
```

## 4. Contribute translations from your own code

A custom component, a custom field, a plugin, a richtext extension — anything
outside `@byline/admin` follows the same shape: per-locale JSON files inside your
own package (or host), plus a factory matching `adminTranslations`'s
`{ locales }` signature. The host wires every source explicitly through
`mergeTranslations(...)`. See the
[worked example](#worked-example-the-custom-media-list-view) below.

## 5. ICU formatting (plurals, dates, numbers)

ICU MessageFormat works inline — the same syntax the host i18n already uses.

```ts
// translations
'inbox.unread': '{count, plural, one {# unread message} other {# unread messages}}',
'doc.publishedOn': 'Published on {date, date, medium}',
```

```tsx
const { t } = useTranslation('byline-admin')
t('inbox.unread', { count: 3 })             // "3 unread messages"
t('doc.publishedOn', { date: new Date() })  // "Published on May 28, 2026"
```

## 6. Server-side translation (loaders, server fns)

Same translation surface from a server context. Returns a pre-bound
`t(key, values)` for the request's resolved locale.

```ts
import { createServerFn } from '@tanstack/react-start'
import { resolveServerTranslator } from '@byline/host-tanstack-start/i18n'

export const sendInvite = createServerFn({ method: 'POST' })
  .handler(async () => {
    const { t } = await resolveServerTranslator('byline-admin')
    return { subject: t('email.invite.subject') }
  })
```

The translator resolves the locale once per request from the same cascade the
client uses (preferred_locale → cookie → `Accept-Language` → default).

## 7. The language-switcher menu

The built-in `<LanguageMenu>` mounts in the admin chrome. It reads the registered
`i18n.interface.locales`, the current request locale, and calls the server fn
that persists the new preference. No host-side wiring required.

```tsx
import { LanguageMenu } from '@byline/i18n/react'

<LanguageMenu className="my-2" />   // to render it somewhere else, e.g. an Account card
```

## 8. Set the locale on an admin user account

The Account page exposes a "Default language" field backed by
`byline_admin_users.preferred_locale`. Toggling it updates the user record
(cross-device) *and* writes the cookie (immediate). When `preferred_locale` is
`null`, detection falls through to cookie / `Accept-Language` / default. The same
field is surfaced on the admin-users list so a super-admin can pre-set a
colleague's locale.

## Architecture

## The contract surface

Six things compose the present surface:

1. **`LocaleCode` / `LocaleDefinition`** — the existing types in `@byline/core`
   (`i18n.interface.locales`, `i18n.interface.defaultLocale`).
2. **The translation registry** — a frozen map of
   `{ [locale]: { [namespace]: { [key]: string } } }` produced by
   `defineClientConfig({ i18n: { translations } })`. Built once at startup,
   read-only thereafter.
3. **The `t(key, values?)` formatter** — `intl-messageformat`-backed, identical
   signature on client and server.
4. **The React provider + `useTranslation(namespace)` hook** — the only
   client-side consumer surface. Throws if mounted outside the provider.
5. **The locale resolver** — `resolveInterfaceLocale({ preferred, cookie,
   acceptLanguage })`. A pure function the host calls once per request and threads
   into the provider.
6. **The locale-persistence server fn** — `setInterfaceLocaleFn({ lng })`.
   Updates the admin user record (if authenticated) AND the `byline_admin_lng`
   cookie. Cookie-only when no actor is present (e.g. the login page).

`TranslationBundle` is intentionally just JSON — no functions, no React, no
per-key metadata — which keeps the file format diff-friendly, importable by every
translation tool that round-trips JSON, and easy for a third-party plugin to ship
inside its own package:

```ts
export type TranslationBundle = {
  readonly [locale: string]: {
    readonly [namespace: string]: { readonly [key: string]: string }
  }
}
```

## The translation hook

```ts
function useTranslation<NS extends Namespace>(namespace: NS): {
  t: (key: string, values?: Record<string, unknown>) => string
  locale: string
}
```

The hook reads the registry off context, looks up `namespace`, and returns a `t`
bound to it. The returned `t` always returns a `string` — never `undefined`,
never a React element. Components that need rich-text interpolation (e.g. an `<a>`
inside a translated paragraph) use a separate `<Trans>` component wrapping the
same formatter. The hook throws if mounted outside `<I18nProvider>`; the provider
is mounted automatically by the host adapter's admin shell root.

## Server-side translation

`@byline/host-tanstack-start/i18n` exports `resolveServerTranslator(namespace)`,
which reads the request's resolved locale (via `getAdminRequestContext()`),
looks up the namespace from the same registry the client uses, and returns a
`{ t, locale }` identical in shape to the client hook's return. Loaders,
`createServerFn` handlers, and email templates all use the same call.

## Translation registration

Three ways to register, all converging on the same `TranslationBundle`:

- **The built-in admin bundle.** `adminTranslations({ locales })` reads bundled
  JSON from `packages/i18n/src/admin/` and returns the `byline-admin` namespace.
  The available codes are exported as `bundledLocales`; unknown codes throw.
- **A plugin's exported factory.** Plugins ship per-locale JSON inside their own
  package plus a factory taking `{ locales }`. The host merges via
  `mergeTranslations(adminFactory({...}), pluginFactory({...}))`.
- **Ad-hoc inline**, for a small custom field or one-off override:

  ```ts
  defineClientConfig({
    i18n: {
      translations: mergeTranslations(adminBundle, {
        en: { 'my-app': { 'banner.welcome': 'Welcome back' } },
        fr: { 'my-app': { 'banner.welcome': 'Bon retour' } },
      }),
    },
  })
  ```

**Why explicit merge rather than side-effect registration.** Side-effect
registration creates load-order dependencies — the plugin must be imported before
any UI renders *and* its import side-effect must actually run (which dead-code
elimination can defeat). The explicit-merge model mirrors what `RichTextField`
registration already does: the host's `admin.config.ts` is the one file that
knows about every wired-in subsystem.

## Locale configuration

Default locale + permitted set live on `i18n.interface`. One optional companion
slot carries display names for the language switcher:

```ts
i18n: {
  interface: {
    defaultLocale: 'en',                   // fallback when detection yields nothing useful
    locales: ['en', 'fr'],                 // permitted set; values outside are rejected
    localeDefinitions: [                   // optional — display names for the switcher
      { code: 'en', nativeName: 'English' },
      { code: 'fr', nativeName: 'Français' },
    ],
  },
  content: {
    defaultLocale: 'en',                   // default content locale for new documents
    locales: ['en', 'fr', 'es', 'de'],     // languages a document can be published in
    localeDefinitions: [                   // optional — display names for content locales
      { code: 'en', nativeName: 'English' },
      { code: 'fr', nativeName: 'Français' },
      { code: 'es', nativeName: 'Español' },
      { code: 'de', nativeName: 'Deutsch' },
    ],
  },
  translations: { /* … */ },               // required when interface.locales is non-empty
}
```

`localeDefinitions` is the host's chance to override what `Intl.DisplayNames`
produces — most commonly to capitalize romance-language names (`Français` rather
than CLDR's `français`). Per-code resolution is: explicit `localeDefinitions`
entry → `Intl.DisplayNames(code).of(code)` → the raw code. Partial coverage is
fine.

The **content** dimension accepts the same optional `localeDefinitions` slot.
Byline itself never renders it — the content-locale set has no admin switcher —
but it travels through `getServerConfig().i18n.content.localeDefinitions` so a
host frontend can label its own content-language affordances (`hreflang`
clusters, "read this in…" links, sitemap alternates) with author-controlled
names. The same resolution order applies, via the exported
`buildLocaleDefinitions(codes, localeDefinitions)` helper from
`@byline/host-tanstack-start/i18n`.

`initBylineCore()` validates at boot: every locale in `interface.locales` has at
least one namespace in `translations` (missing → fail fast with a pointer to
`adminTranslations({ locales })`); `defaultLocale` is in `interface.locales`; and
key-set drift between locales surfaces as a *warning* — partial translations are
fine, but contributors see the gap.

## Lookup and fallback

For `t('button.publish', { count: 3 })`:

1. **Active locale** — try `bundle[activeLocale][namespace]['button.publish']`;
   if present, format with ICU and return.
2. **Default locale** — try `bundle[defaultLocale][...]`; if present, format and
   return; in dev, `console.warn` once per `(locale, namespace, key)` about the
   miss.
3. **Key fallback** — return the raw key. Loud-by-default: the user sees
   `button.publish` on screen, which is uglier than the English fallback but makes
   the gap impossible to miss in development.

## Locale detection cascade

Per request, resolved once, identical on client and server (so no SSR/hydration
flicker):

1. **`byline_admin_users.preferred_locale`** — the authenticated user's explicit
   choice. Wins when set.
2. **`byline_admin_lng` cookie** — set on every language switch. A *different*
   cookie name from any host-side `lng` cookie, to avoid cross-talk.
3. **`Accept-Language`** negotiation — via `@formatjs/intl-localematcher`,
   matching against `i18n.interface.locales`.
4. **`i18n.interface.defaultLocale`** — last resort.

## Per-user locale preference

`byline_admin_users.preferred_locale` (varchar 16, nullable; `null` = "use
detection cascade") is surfaced in two places: the **Account preferences** page
(a `Select` of interface locales plus a "Use browser default" option that sets
the column back to `null`), and the **admin users list** (so a super-admin can
set a colleague's default before they first log in). The server fn that updates
the column also writes the cookie, so the change is visible without a sign-out /
sign-in cycle.

## Namespacing conventions

A namespace is a flat string:

- `byline-admin` — the built-in admin shell.
- `byline-<package>` — every other Byline-shipped package
  (`byline-richtext-lexical`, `byline-ai`, …).
- `<your-org>-<plugin>` — third-party plugins (package name with `@`/`/`
  flattened).

Hierarchical keys inside a namespace are dot-separated
(`chrome.sidebar.collapse`, `forms.validation.required`). Convention only — the
runtime treats keys as opaque strings.

## Message formatting

`intl-messageformat` is the floor — the same library the host already uses.
Supports plurals (`{count, plural, one {# message} other {# messages}}`), selects
(`{gender, select, …}`), dates/times/numbers (`{date, date, medium}`,
`{n, number, ::percent}`), and nesting. The formatter is built once per
`(locale, namespace, key)` and cached for the registry's lifetime — the parse
step is the expensive part, and the registry is immutable, so the cache is safe.

## Validation messages

Schemas in `@byline/core/validation` emit stable **codes** (e.g.
`password.tooShort`) instead of free-form English; the
`translateValidationError(t, message)` helper in `@byline/admin/react` maps the
codes onto the active locale at render time. This keeps `@byline/core`
i18n-agnostic — codes from core, mapping in admin. Form-level Zod defaults
(`min`/`max`/regex) are translated via the schema-inside-component +
`useMemo([t])` pattern used across the drawer forms.

## Bundling and code-splitting

Every locale's bundle is part of the initial admin JS payload (~5 kB
gzipped per locale of flat key→string JSON). Because the bundle map uses static
`import enJson from './en.json'` statements, the bundler sees a fixed-size set at
build time. This payload is admin-only — it never reaches the public bundle,
because the admin graph is code-split out via the `_byline` lazy route. Past
roughly five locales, lazy locale loading (async loaders in place of the eager
static-import map) becomes worth the added complexity.

## Worked example: the custom media list view

The webapp's media collection ships a custom `listView` that replaces the default
table with a card grid. It doubles as the canonical worked example for the i18n
extension surface — every moving part of the registration API exercised in a
setting that does not touch `@byline/admin`'s internals.

```
apps/webapp/byline/collections/media/i18n/
├─ en.json
├─ fr.json
└─ index.ts   ← exports `mediaAdminTranslations({ locales })` factory
              ← also exports MEDIA_ADMIN_NAMESPACE ('webapp-media-admin')
```

The factory mirrors `adminTranslations()` — same shape, same validation, same
`TranslationBundle` output:

```ts
// apps/webapp/byline/collections/media/i18n/index.ts
import type { LocaleCode, NamespaceTranslations, TranslationBundle } from '@byline/i18n'
import { mergeTranslations } from '@byline/i18n'

import en from './en.json'
import fr from './fr.json'

/** A globally-unique namespace — by convention `<app-or-package-slug>-<purpose>`. */
export const MEDIA_ADMIN_NAMESPACE = 'webapp-media-admin'

const BUNDLES: Readonly<Record<LocaleCode, NamespaceTranslations>> = {
  en: en as NamespaceTranslations,
  fr: fr as NamespaceTranslations,
}

export function mediaAdminTranslations(
  options: { locales?: readonly LocaleCode[] } = {}
): TranslationBundle {
  const locales = options.locales ?? ['en']
  const partials: TranslationBundle[] = []
  for (const locale of locales) {
    const bundle = BUNDLES[locale]
    if (bundle == null) {
      throw new Error(`[mediaAdminTranslations] no bundled translation for '${locale}'.`)
    }
    partials.push({ [locale]: { [MEDIA_ADMIN_NAMESPACE]: bundle } })
  }
  return mergeTranslations(...partials)
}
```

The host wires it once, in `apps/webapp/byline/i18n.ts`:

```ts
import { mergeTranslations } from '@byline/i18n'
import { adminTranslations } from '@byline/i18n/admin'

import { mediaAdminTranslations } from './collections/media/i18n/index.js'

export const i18n = {
  interface: { defaultLocale: 'en', locales: ['en', 'fr'] },
  content:   { defaultLocale: 'en', locales: ['en', 'fr', 'es', 'de'] },
  translations: mergeTranslations(
    adminTranslations({ locales: ['en', 'fr'] }),
    mediaAdminTranslations({ locales: ['en', 'fr'] }),
  ),
}
```

And the component uses the namespace via the hook:

```tsx
import { useTranslation } from '@byline/i18n/react'
import { MEDIA_ADMIN_NAMESPACE } from '../i18n/index.js'

export function MediaListView({ data }: ListViewComponentProps) {
  const { t } = useTranslation(MEDIA_ADMIN_NAMESPACE)
  return (
    <>
      <IconButton aria-label={t('header.uploadAriaLabel')}>…</IconButton>
      <Search placeholder={t('toolbar.searchPlaceholder')} />
      {data.docs.length === 0 ? <p>{t('empty')}</p> : /* … */}
    </>
  )
}
```

`mergeTranslations` is associative and last-writer-wins at the
`(locale, namespace, key)` granularity, with a dev-mode collision warning. Using
a distinct namespace (the recommended pattern) avoids collisions entirely. A
third-party plugin in a separate package follows the exact same shape — exporting
its own `{ locales }` factory the host imports and merges in `byline/i18n.ts`.

## Why not adopt the host i18n outright?

The host pattern in `apps/webapp/src/i18n/` is close to the admin system —
`intl-messageformat`, a namespaced bundle, a React provider, a cookie — but it is
not the right thing to *ship* as the admin system:

- **It targets the front-end site, not the admin.** The host's `lng` cookie
  carries the site-visitor's language; the admin needs its own cookie so editors
  aren't forced into the visitor's locale.
- **No per-user storage.** Admin editors expect their preference to follow them
  across machines.
- **No extensibility surface.** Plugins / extensions / custom fields need a
  registration path; the host pattern hard-codes its namespaces in one file.
- **Wrong package layer.** Admin i18n must ship from the richtext / storage /
  admin packages without depending on a specific host framework.

What the admin system *inherits* from the host pattern: ICU-via-`intl-messageformat`,
namespace-then-key structure, cookie-as-persistence-medium, and
`@formatjs/intl-localematcher` for `Accept-Language` negotiation.

## Code map (admin interface)

| Concern | Location |
|---|---|
| `TranslationBundle` type + `mergeTranslations` | `packages/i18n/src/types.ts` + `packages/i18n/src/merge.ts` |
| `adminTranslations({ locales })` + bundled JSON + `bundledLocales` | `packages/i18n/src/admin/index.ts` + `packages/i18n/src/admin/<code>.json` |
| `t(key, values)` formatter (shared) | `packages/i18n/src/formatter.ts` |
| `useTranslation` hook + `<I18nProvider>` | `packages/i18n/src/react/index.ts` |
| `<LanguageMenu>` | `packages/i18n/src/react/language-menu.tsx` |
| `resolveInterfaceLocale()` (pure cascade) | `packages/i18n/src/resolve.ts` |
| `resolveServerTranslator()` | `packages/host-tanstack-start/src/i18n/server-translator.ts` |
| `resolveRequestLocale()` (host cascade) | `packages/host-tanstack-start/src/i18n/resolve-locale.ts` |
| `getActiveLocaleFn()` (client-graph-safe wrapper) | `packages/host-tanstack-start/src/server-fns/i18n/get-active-locale.ts` |
| `setInterfaceLocaleFn()` server fn | `packages/host-tanstack-start/src/server-fns/i18n/set-locale.ts` |
| `byline_admin_lng` cookie helpers | `packages/host-tanstack-start/src/i18n/locale-cookie.ts` |
| `byline_admin_users.preferred_locale` column + migration | `packages/db-postgres/src/database/schema/auth.ts` + migrations |
| `preferred_locale` self-service write | `packages/admin/src/modules/admin-account/{commands,service,schemas}.ts` |
| `ClientConfig.i18n.translations` slot | `packages/core/src/@types/site-config.ts` |
| Boot-time validator | `packages/core/src/services/i18n-validator.ts` |
| Reference registration | `apps/webapp/byline/i18n.ts` + `apps/webapp/byline/admin.config.ts` |
