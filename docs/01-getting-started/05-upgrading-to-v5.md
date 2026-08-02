---
title: "Upgrading from 4.x to 5.x"
path: "upgrading-to-v5"
summary: "Application migration guide for Byline 5.x: admin configuration naming, admin locale naming, host-owned site URLs, removed compatibility APIs, and coordinated package validation."
---

# Upgrading from 4.x to 5.x

Companions:
- [Configuration](./03-configuration.md) — the current application-owned configuration files and runtime boundaries.
- [Configuration API](../10-api-reference/01-configuration.md) — the exact `AdminConfig`, `ServerConfig`, and i18n contracts.
- [Internationalization](../08-internationalization/index.md) — the separation between host-interface, Byline-admin, and content locales.

Byline 5 removes compatibility APIs and gives the browser/SSR admin
configuration an unambiguous name. The migration changes application source,
but it does not change stored documents, admin locale values, or database
schemas.

Update every published `@byline/*` dependency to major 5 together. Byline's
packages share runtime singletons and cross-package types, so mixed majors are
not supported.

## Rename the admin configuration API

Rename these `@byline/core` imports and calls:

| 4.x | 5.x |
|---|---|
| `ClientConfig` | `AdminConfig` |
| `ResolvedClientConfig` | `ResolvedAdminConfig` |
| `defineClientConfig()` | `defineAdminConfig()` |
| `getClientConfig()` | `getAdminConfig()` |

These names describe the admin module graph, not the separate
`@byline/client` SDK. Types such as `BylineClientConfig` in the SDK retain their
existing names.

Keep both `admin.config.ts` registration points under `_byline`: the dynamic
`beforeLoad` import protects child loaders, and the lazy-route import protects
initial hydration and component rendering.

## Rename the admin locale axis

Change Byline's admin-language configuration and APIs:

| 4.x | 5.x |
|---|---|
| `i18n.interface` | `i18n.admin` |
| `interfaceLocales` | `adminLocales` |
| `resolveInterfaceLocale()` | `resolveAdminLocale()` |
| `ResolveInterfaceLocaleOptions` | `ResolveAdminLocaleOptions` |
| `setInterfaceLocaleFn` | `setAdminLocaleFn` |
| admin service `setInterfaceLocale` | admin service `setAdminLocale` |

Author locale tuples with `{ code, nativeName }`, and name their defaults next
to the tuples:

```ts
export const defaultAdminLocale = 'en'
export const defaultContentLocale = 'en'

export const adminLocales = [
  { code: 'en', nativeName: 'English' },
] as const

export const contentLocales = [
  { code: 'en', nativeName: 'English' },
] as const
```

The CLI still statically reads `contentLocales[*].code` from
`byline/locales.ts` and `i18nConfig.{locales, defaultLocale}` from the host
frontend's `src/i18n/i18n-config.ts`. Preserve those export and property names.
The host frontend may continue to call its own chrome language an “interface
locale”; that is independent from Byline's admin locale.

`byline_admin_users.preferred_locale` stores only a locale code. Its values and
column name do not change, so this rename requires no database or data
migration.

## Remove Byline's site URL

Delete `serverURL` from `AdminConfig`, `ServerConfig`, and every
`initBylineCore()` call. The host application's public configuration owns its
canonical origin.

If the sign-in page should link back to the public site, pass the host's
client-safe value to the route factory:

```ts
export const Route = createSignInRoute('/_byline/sign-in', {
  homeUrl: getPublicConfig().serverUrl,
})
```

Do not reuse that site origin as a future remote SDK base URL. A transport
client will need its own `baseURL` or `apiURL` contract.

## Remove deprecated compatibility usage

- Replace `CollectionAdminConfig.picker` with `itemView`.
- Import `UnifiedFieldValue` instead of the removed `UnionRowValue` alias.
- Stop reading or assigning the removed `ReadContext.beforeReadCache` property.
- Configure `routes.signIn`; do not pass `signInPath` to
  `createAdminLayoutRoute()` or call the removed sign-in override helpers.
- Pass a validated `redirectTo` to `SignInForm`; its old `callbackUrl` prop is
  removed. The host sign-in route's `callbackUrl` URL search parameter remains
  a separate, supported contract.

The unused collection serializer and its `Serializable*` types are also
removed. Byline does not yet expose a transport collection descriptor; future
HTTP and MCP descriptors will be explicit allowlisted projections.

## Verify the migration

Run the normal application typecheck and production build after updating all
packages. In a Byline source checkout, also run the generator check, package
tests, docs checker, and bundle-boundary tests. Verify that public routes do not
load `admin.config.ts`, `@byline/admin`, or the editor graph.
