/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Lazy companion to `_byline/route.tsx`. TanStack Router loads this on
 * demand when a `_byline/*` URL matches, so:
 *
 * - The Byline UI providers (Toast, Breadcrumbs) only ship to admin pages.
 * - The `byline/admin.config` side-effect import (which transitively pulls
 *   in the Lexical editor module graph) only fires when an admin route is
 *   actually visited — public routes stay clean.
 *
 * If you also want to use the Byline UI components on your public site,
 * import the stylesheets from your front-end's pathless layout instead
 * (e.g. `_front-end/route.tsx` — see `_public/route.tsx` here for the
 * existing pattern).
 */

import { createLazyFileRoute, Outlet } from '@tanstack/react-router'

import { BreadcrumbsProvider } from '@byline/host-tanstack-start/admin-shell/chrome/breadcrumbs/breadcrumbs-provider'
import { ToastProvider, ToastViewport } from '@byline/ui/react'

import '../../../byline/admin.config'

export const Route = createLazyFileRoute('/_byline')({
  component: BylineLayout,
})

function BylineLayout() {
  return (
    <div className="byline-ui flex flex-col flex-1 w-full max-w-full h-full">
      <ToastProvider timeout={5000}>
        <BreadcrumbsProvider>
          <Outlet />
        </BreadcrumbsProvider>
        <ToastViewport position="bottom-right" />
      </ToastProvider>
    </div>
  )
}
