# @byline/i18n

Admin interface i18n primitives for Byline CMS — a translation registry, an ICU MessageFormat formatter, a React provider + `useTranslation()` hook, a self-contained `<LanguageMenu>`, and a pure locale-resolution cascade.

This package is the *interface* axis of i18n (what language the admin UI renders in). The *content* axis (what languages your documents publish in) is a separate concern handled by `i18n.content` on the existing `BaseConfig`. The two are deliberately independent.

For the full design — registration model, plugin extensibility surface, per-user persistence, future phases — see [`docs/07-internationalization/index.md`](../../docs/07-internationalization/index.md) at the repo root.

## Install

```sh
pnpm add @byline/i18n
```

The package bundles every official Byline admin translation as a JSON file under `src/admin/`. Today that's English (`en.json`) and French (`fr.json`); adding a new locale is a single-file PR. The `adminTranslations({ locales })` factory reads only the requested codes and assembles a bundle.

## Three entry points

```ts
import { mergeTranslations, createFormatter, resolveInterfaceLocale } from '@byline/i18n'
import { I18nProvider, useTranslation, LanguageMenu } from '@byline/i18n/react'
import { adminTranslations, en } from '@byline/i18n/admin'
```

- **Root** — types, formatter, merge helper, locale cascade. React-free; safe on the server.
- **`/react`** — provider, hook, switcher. Single barrel by design (sidesteps the Vite `optimizeDeps` Context-identity trap that has bitten this codebase before).
- **`/admin`** — the bundled `byline-admin` namespace and the `adminTranslations(...)` factory.

## Minimal wiring

```ts
// apps/your-app/byline/admin.config.ts
import { defineClientConfig } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'

defineClientConfig({
  i18n: {
    interface: {
      defaultLocale: 'en',
      locales: ['en'],
    },
    // … content locales as before
    translations: adminTranslations({ locales: ['en'] }),
  },
  // … the rest of your client config
})
```

## Adding a second locale

```ts
import { adminTranslations } from '@byline/i18n/admin'

i18n: {
  interface: { defaultLocale: 'en', locales: ['en', 'fr'] },
  translations: adminTranslations({ locales: ['en', 'fr'] }),
}
```

The set of bundled locales is exported as `bundledLocales` for hosts that want to derive their locale list from what's available:

```ts
import { adminTranslations, bundledLocales } from '@byline/i18n/admin'

i18n: {
  interface: { defaultLocale: 'en', locales: [...bundledLocales] },
  translations: adminTranslations({ locales: bundledLocales }),
}
```

`adminTranslations({ locales: ['xx'] })` throws at config time when a requested code is not in `bundledLocales`. To contribute a new locale, drop a JSON file alongside `src/admin/en.json` and add it to the bundle map.

## Plugin contributions

A plugin (richtext extension, custom field, AI tool, …) ships its own JSON files inside its own package and exposes a factory matching `adminTranslations`'s shape — takes `{ locales }`, returns a `TranslationBundle` for the plugin's own namespace. The host merges them in `defineClientConfig`:

```ts
import { mergeTranslations } from '@byline/i18n'
import { adminTranslations } from '@byline/i18n/admin'
import { aiTranslations } from '@byline/ai/i18n'

i18n: {
  interface: { defaultLocale: 'en', locales: ['en', 'fr'] },
  translations: mergeTranslations(
    adminTranslations({ locales: ['en', 'fr'] }),
    aiTranslations({ locales: ['en', 'fr'] }),
  ),
}
```

A plugin that ships a locale the host hasn't enabled is harmless — the plugin's factory simply returns nothing for that code, the merge produces an empty entry for it, and the boot validator gates against `i18n.interface.locales` anyway.

`mergeTranslations` is associative + deterministic; later sources override earlier ones at the `(locale, namespace, key)` grain, and a `MergeOptions.onCollision` callback is available for surfacing conflicts during development.

Conventions:

- `byline-admin` — the built-in admin shell namespace.
- `byline-<package>` — every Byline-shipped package (`byline-richtext-lexical`, `byline-ai`, …).
- `<org>-<plugin>` — third-party plugins (the package name with `@` and `/` flattened).

## Using `useTranslation` in components

```tsx
import { useTranslation } from '@byline/i18n/react'

export function PublishButton() {
  const { t } = useTranslation('byline-admin')
  return <button>{t('common.actions.publish')}</button>
}
```

`t(key, values)` always returns a string. ICU MessageFormat syntax works in values — plurals, dates, numbers, selects:

```ts
t('list.unread', { count: 3 })             // "3 unread"
t('doc.publishedOn', { date: new Date() }) // "Published on May 28, 2026"
```

Missing keys fall through `active locale → default locale → raw key`. A one-shot `console.warn` per missing `(locale, namespace, key)` triple fires in dev so gaps are visible.

## Server-side translation

`createFormatter` is pure and React-free, so loaders and server functions use it directly:

```ts
import { createFormatter } from '@byline/i18n'

const { t } = createFormatter({
  bundle,                  // the merged TranslationBundle
  activeLocale: 'fr',
  defaultLocale: 'en',
}).bind(null, 'byline-admin')

return { subject: t('email.invite.subject') }
```

In a TanStack Start host, `resolveServerTranslator(namespace)` (provided by `@byline/host-tanstack-start`) wraps this with the request's resolved locale.

## Locale resolution cascade

`resolveInterfaceLocale` is the same pure cascade run on client and server, so SSR and hydration produce the same answer:

```ts
import { resolveInterfaceLocale } from '@byline/i18n'

const activeLocale = resolveInterfaceLocale({
  locales: ['en', 'fr'],
  defaultLocale: 'en',
  preferred: actor?.admin_user?.preferred_locale,
  cookie: getCookie('byline_admin_lng'),
  acceptLanguage: getRequestHeader('accept-language'),
})
```

Tier order: `preferred → cookie → acceptLanguage → defaultLocale`. Every signal is validated against the permitted `locales` set, so a stale cookie pointing at a removed locale falls through cleanly.

## What's *not* here (yet)

- **Lazy locale loading.** Locales currently bundle eagerly. With more than ~5 locales, switching to async loaders earns its complexity; see Phase 3 in [`docs/07-internationalization/index.md`](../../docs/07-internationalization/index.md).
- **Authoring-time metadata** (per-key descriptions, plural hints, deprecation markers). Phase 4.
- **RTL admin layout.** Phase 5. Need a community-translated RTL locale first to surface the real list of CSS breakages.
- **Inline translation editing** (CMS-as-translation-tool). Deliberately out of scope.

## License

MPL-2.0.
