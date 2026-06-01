/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Lazy companion to `_byline/route.tsx`. TanStack Router loads this on
 * demand when a `_byline/*` URL matches, so the Byline UI providers (Toast,
 * Breadcrumbs) and the admin/editor module graph only ship to admin pages —
 * public routes stay clean.
 *
 * The `byline/admin.config` side-effect import below registers the client
 * config in the *client component graph* — it runs whenever this lazy module
 * loads (component render / initial hydration), where the sibling `route.tsx`
 * `beforeLoad` does NOT help: on initial hydration TanStack Start reuses the
 * dehydrated SSR result and does not re-run `beforeLoad`, yet the admin layout
 * component still calls `getClientConfig()` at render. The two registration
 * points are complementary — `beforeLoad` (a dynamic import) covers the
 * *loader* phase before any `_byline/*` child loader (closing the dev race
 * where the loader outran this module); this import covers component render /
 * hydration. Both call `defineClientConfig` idempotently.
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
