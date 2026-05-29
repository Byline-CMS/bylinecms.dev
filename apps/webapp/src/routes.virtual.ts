/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Virtual route configuration consumed by `tanstackStart()` via
 * `tsr.virtualRouteConfig` in `vite.config.ts`. The bulk of the route
 * tree is still file-based — mounted unchanged via `physical('/',
 * 'routes')`. The literal-locale shim routes (`/es`, `/fr`, …) are
 * added programmatically here for each non-default interface locale,
 * disambiguating bare-locale URLs from the optional-{-$lng}/$path
 * catch-all in the file tree. See `route-shims/locale-home-shim.tsx`
 * for the full rationale.
 */

import { physical, rootRoute, route } from '@tanstack/virtual-file-routes'

import { i18nConfig } from './i18n/i18n-config'

const nonDefaultLocales = i18nConfig.locales.filter((locale) => locale !== i18nConfig.defaultLocale)

// All file paths below are resolved relative to `routesDirectory`
// (default: `./src/routes`). `__root.tsx` lives at the top of that
// directory; `physical('/', '.')` mounts the directory itself for the
// file-based scanner; the shim files live OUTSIDE routes/, so they're
// referenced via `../route-shims/...`.
export const routes = rootRoute('__root.tsx', [
  // The existing file-based tree, untouched.
  physical('/', '.'),

  // Literal-locale shims for each non-default interface locale.
  ...nonDefaultLocales.map((locale) => route(`/${locale}`, `../route-shims/${locale}-route.tsx`)),
])
