/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Pathless layout route for everything Byline-rendered (the admin shell
 * and the sign-in page). The `_byline` prefix doesn't contribute to URL
 * paths — `/_byline/admin/...` resolves to `/admin/...` and
 * `/_byline/sign-in` resolves to `/sign-in`.
 *
 * The single job of this layout is to import the Byline UI kit
 * stylesheets so they're scoped to (and only loaded on) Byline-rendered
 * pages. Front-end routes outside this layout don't get the byline
 * styles unless they import them explicitly.
 *
 * If you also want to use the Byline UI components on your public site,
 * import the same stylesheets from your front-end's pathless layout
 * (e.g. `_front-end/route.tsx` — see `_public/route.tsx` here for the
 * existing pattern).
 */

import { ToastProvider, ToastViewport } from '@byline/ui/react'

import { createFileRoute, Outlet } from '@tanstack/react-router'

import { BreadcrumbsProvider } from '@byline/host-tanstack-start/admin-shell/chrome/breadcrumbs/breadcrumbs-provider'

import '@byline/ui/reset.css'
import '@byline/ui/styles.css'

export const Route = createFileRoute('/_byline')({
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
