/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Lazy companion to `_byline/route.tsx`. TanStack Router loads this on
 * demand when a `_byline/*` URL matches, so the Byline UI providers,
 * stylesheets, and the admin config side-effect import (which transitively
 * pulls in the Lexical editor module graph) only run when an admin route is
 * actually visited — public routes stay clean.
 *
 * The `byline/admin.config` import below registers the client config in the
 * *client component graph* — it runs whenever this lazy module loads (component
 * render / initial hydration), where the sibling `route.tsx` `beforeLoad` does
 * NOT help: on initial hydration TanStack Start reuses the dehydrated SSR result
 * and does not re-run `beforeLoad`, yet the admin layout component still calls
 * `getClientConfig()` at render. The two registration points are complementary —
 * `beforeLoad` (a dynamic import) covers the *loader* phase before any
 * `_byline/*` child loader; this import covers component render / hydration.
 * Both call `defineClientConfig` idempotently.
 *
 * If you also want to use the Byline UI components on your public site,
 * import the same stylesheets from your public layout route as well.
 */

import { createLazyFileRoute, Outlet } from '@tanstack/react-router'

import { BreadcrumbsProvider } from '@byline/host-tanstack-start/admin-shell/chrome/breadcrumbs/breadcrumbs-provider'
import { ToastProvider, ToastViewport } from '@byline/ui/react'

import '@byline/ui/reset.css'
import '@byline/ui/styles.css'

// Register the Byline client config (component-render / hydration entry point —
// see the file header). The sibling `route.tsx` `beforeLoad` covers the loader
// phase. Lexical's module graph only loads when a `_byline/*` URL matches.
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
