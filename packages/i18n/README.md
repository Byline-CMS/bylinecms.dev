# @byline/i18n

Admin interface i18n primitives for Byline CMS — a translation registry, an ICU MessageFormat formatter, a React provider + `useTranslation()` hook, a self-contained `<LanguageMenu>`, and a pure locale-resolution cascade.

This package is the *interface* axis of i18n (what language the admin UI renders in). The *content* axis (what languages your documents publish in) is a separate concern handled by `i18n.content` on the existing `BaseConfig`. The two are deliberately independent.

For the full design — registration model, plugin extensibility surface, per-user persistence, future phases — see [`docs/I18N.md`](../../docs/I18N.md) at the repo root.

## Install

```sh
pnpm add @byline/i18n
```

The package ships English admin strings out of the box. Other locales arrive as standalone community packages (`@byline/i18n-fr`, `@byline/i18n-de`, …) and merge in at registration time.

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
    translations: adminTranslations({ en: true }),
  },
  // … the rest of your client config
})
```

## Adding a second locale

```ts
import { adminTranslations } from '@byline/i18n/admin'
import { fr } from '@byline/i18n-fr'

i18n: {
  interface: { defaultLocale: 'en', locales: ['en', 'fr'] },
  translations: adminTranslations({ en: true, fr }),
}
```

## Plugin contributions

A plugin (richtext extension, custom field, AI tool, …) exports a `TranslationBundle` from a dedicated entry point. The host merges it during `defineClientConfig`:

```ts
import { mergeTranslations } from '@byline/i18n'
import { adminTranslations } from '@byline/i18n/admin'
import { aiTranslations } from '@byline/ai/i18n'

i18n: {
  interface: { defaultLocale: 'en', locales: ['en', 'fr'] },
  translations: mergeTranslations(
    adminTranslations({ en: true, fr: frAdmin }),
    aiTranslations,
  ),
}
```

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
  cookie: getCookie('lng_admin'),
  acceptLanguage: getRequestHeader('accept-language'),
})
```

Tier order: `preferred → cookie → acceptLanguage → defaultLocale`. Every signal is validated against the permitted `locales` set, so a stale cookie pointing at a removed locale falls through cleanly.

## What's *not* here (yet)

- **Lazy locale loading.** Locales currently bundle eagerly. With more than ~5 locales, switching to async loaders earns its complexity; see Phase 3 in [`docs/I18N.md`](../../docs/I18N.md).
- **Authoring-time metadata** (per-key descriptions, plural hints, deprecation markers). Phase 4.
- **RTL admin layout.** Phase 5. Need a community-translated RTL locale first to surface the real list of CSS breakages.
- **Inline translation editing** (CMS-as-translation-tool). Deliberately out of scope.

## License

MPL-2.0.
