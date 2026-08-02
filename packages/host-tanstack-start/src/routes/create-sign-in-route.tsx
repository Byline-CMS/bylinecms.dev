/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Sign-in page route factory.
 *
 * Lives outside the configured admin subtree so the authenticated-admin layout
 * (and its `beforeLoad` guard) does not apply. Preserves a `callbackUrl`
 * query param so sign-ins triggered by the admin guard redirect back to
 * the originally-requested path.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { LocaleCode } from '@byline/i18n'

import { SignInPage } from '../admin-shell/chrome/sign-in-page.js'
import { getActiveLocaleFn } from '../server-fns/i18n/index.js'
import { resolveAdminCallbackPath, resolveAdminSignInRedirect } from './admin-path.js'
import { resolveSignInHomeUrl } from './sign-in-home-url.js'

interface SignInSearch {
  callbackUrl?: string
}

export interface CreateSignInRouteOptions {
  /**
   * Client-safe URL for the sign-in page's Home link. Defaults to `/`, which
   * preserves the link for integrated hosts without requiring an absolute site
   * origin. Pass an absolute URL when the public home is on another origin.
   */
  homeUrl?: string
}

export function createSignInRoute(path: string, { homeUrl }: CreateSignInRouteOptions = {}) {
  const resolvedHomeUrl = resolveSignInHomeUrl(homeUrl)
  const Route: any = createFileRoute(path as never)({
    validateSearch: (search: Record<string, unknown>): SignInSearch => {
      const callbackUrl = resolveAdminCallbackPath(search.callbackUrl)
      return { callbackUrl }
    },
    beforeLoad: async () => {
      // Resolve the active locale on the server before render so the
      // sign-in page hydrates in the user's chosen language. The
      // resolver works pre-auth — `readPreferredLocaleFromActor()`
      // returns null when there's no admin session and the cascade
      // falls through to cookie → Accept-Language → defaultLocale.
      const activeLocale = await getActiveLocaleFn()
      return { activeLocale }
    },
    component: function SignInRouteComponent() {
      const { callbackUrl } = Route.useSearch() as SignInSearch
      const { activeLocale } = Route.useRouteContext() as { activeLocale: LocaleCode }
      return (
        <SignInPage
          redirectTo={resolveAdminSignInRedirect(callbackUrl)}
          activeLocale={activeLocale}
          homeUrl={resolvedHomeUrl}
        />
      )
    },
  })
  return Route
}
