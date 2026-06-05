/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only implementation of frontend chrome interface-locale resolution.
 *
 * Loaded via a handler-local dynamic `import()` from
 * `resolve-interface-locale-fn.ts` so that `detectLocale` (and its
 * `negotiator` / `intl-localematcher` dependencies) and the server-only
 * request helpers never reach the client bundle. See `pages/detail.ts` for
 * the same split rationale.
 */

import { getCookie, getRequestHeader } from '@tanstack/react-start/server'

import { detectLocale } from '@/i18n/detect-locale'
import { i18nConfig, isInterfaceLocale, type Locale } from '@/i18n/i18n-config'

/**
 * Resolve the interface locale for chrome on a page whose URL locale is
 * `pathLocale`:
 *
 *   - If the URL locale is itself an interface locale (`/fr/…`), chrome uses
 *     it directly.
 *   - If it is a content-only locale (`/zh-CN/…`), chrome falls back to the
 *     visitor's last-known / detected interface locale via `detectLocale`:
 *     `lng` cookie → Accept-Language → default. This runs server-side on both
 *     SSR and client-navigation RPC (the request carries both headers), so
 *     the answer is identical across SSR and hydration.
 */
export function resolveFrontendInterfaceLocale(pathLocale: string): Locale {
  if (isInterfaceLocale(pathLocale)) return pathLocale

  return detectLocale({
    cookie: getCookie(i18nConfig.cookieName),
    acceptLanguage: getRequestHeader('accept-language'),
  })
}
