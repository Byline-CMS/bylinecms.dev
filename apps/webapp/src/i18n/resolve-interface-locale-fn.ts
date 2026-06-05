/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server fn that resolves the chrome interface locale for a frontend URL.
 *
 * Always executes server-side — on SSR in-process, on a client-side
 * locale-change navigation as an RPC. The RPC carries the browser's `Cookie`
 * and `Accept-Language` headers, so `detectLocale`'s cascade resolves
 * identically in both cases (no SSR/CSR divergence, no cookie-persistence
 * hack). Keep this module's static imports client-safe — the implementation
 * (and its `negotiator` dependency) is reached through a handler-local
 * dynamic import. See `resolve-interface-locale.server.ts`.
 */

import { createServerFn } from '@tanstack/react-start'

import { isInterfaceLocale, type Locale } from '@/i18n/i18n-config'

interface ResolveInterfaceLocaleInput {
  pathLocale: string
}

export const resolveInterfaceLocaleFn = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: ResolveInterfaceLocaleInput): ResolveInterfaceLocaleInput => ({
      pathLocale: input.pathLocale,
    })
  )
  .handler(async (ctx): Promise<Locale> => {
    const { pathLocale } = ctx.data as ResolveInterfaceLocaleInput
    const { resolveFrontendInterfaceLocale } = await import('./resolve-interface-locale.server')
    return resolveFrontendInterfaceLocale(pathLocale)
  })

/**
 * Loader-side interface-locale resolver. Call this from route loaders (which
 * are `staleTime`-cached, unlike `beforeLoad` which re-runs on every
 * navigation and every `intent` preload).
 *
 * Fast path: when the URL locale is already an interface locale — the
 * overwhelming majority of traffic — it resolves SYNCHRONOUSLY with no server
 * round-trip. Only a content-only URL locale (e.g. `zh-CN`) falls through to
 * the server fn (cookie → Accept-Language → default).
 */
export async function resolveInterfaceLocale(pathLocale: string): Promise<Locale> {
  if (isInterfaceLocale(pathLocale)) return pathLocale
  return resolveInterfaceLocaleFn({ data: { pathLocale } })
}
