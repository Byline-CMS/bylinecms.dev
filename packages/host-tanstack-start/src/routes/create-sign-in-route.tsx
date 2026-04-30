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
 * Lives outside the `/admin` subtree so the authenticated-admin layout
 * (and its `beforeLoad` guard) does not apply. Preserves a `callbackUrl`
 * query param so sign-ins triggered by the admin guard redirect back to
 * the originally-requested path.
 */

import { createFileRoute } from '@tanstack/react-router'

import { SignInPage } from '../admin-shell/chrome/sign-in-page.js'

interface SignInSearch {
  callbackUrl?: string
}

export function createSignInRoute(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    validateSearch: (search: Record<string, unknown>): SignInSearch => {
      const callbackUrl = typeof search.callbackUrl === 'string' ? search.callbackUrl : undefined
      return { callbackUrl }
    },
    component: function SignInRouteComponent() {
      const { callbackUrl } = Route.useSearch() as SignInSearch
      return <SignInPage callbackUrl={callbackUrl} />
    },
  })
  return Route
}
