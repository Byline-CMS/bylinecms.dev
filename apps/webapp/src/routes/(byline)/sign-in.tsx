/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin sign-in page.
 *
 * Lives outside the `/admin` subtree so the authenticated-admin layout
 * (and its `beforeLoad` guard) does not apply. A bare centred card on a
 * plain background — no AdminAppBar, no breadcrumbs.
 *
 * Preserves a `callbackUrl` query param so sign-ins triggered by the
 * admin guard redirect back to the originally-requested path.
 */

import { createFileRoute } from '@tanstack/react-router'

import { bylineAdminServices } from '@byline/host-tanstack-start/integrations/byline-admin-services'
import { BylineAdminServicesProvider, SignInForm } from '@byline/ui'

interface SignInSearch {
  callbackUrl?: string
}

export const Route = createFileRoute('/(byline)/sign-in')({
  validateSearch: (search: Record<string, unknown>): SignInSearch => {
    const callbackUrl = typeof search.callbackUrl === 'string' ? search.callbackUrl : undefined
    return { callbackUrl }
  },
  component: SignInPage,
})

function SignInPage() {
  const { callbackUrl } = Route.useSearch()
  return (
    <BylineAdminServicesProvider services={bylineAdminServices}>
      <main className="flex flex-col flex-1 items-center p-6">
        <div className="mt-[8vh] sm:mt-[14vh] w-full flex flex-col items-center">
          <SignInForm callbackUrl={callbackUrl} />
        </div>
      </main>
    </BylineAdminServicesProvider>
  )
}
