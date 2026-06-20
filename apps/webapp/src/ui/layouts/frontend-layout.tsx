/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Reusable public frontend layout. The `$lng/_frontend/route.tsx` layout
 * renders this so chrome / providers / data threading stay in one place.
 */

import type { ReactNode } from 'react'
import { Outlet } from '@tanstack/react-router'

import { DocsProvider } from '@/modules/docs/components/docs-provider'
import { GradientBackground } from '@/modules/home/gradient-background'
import { AppBarFront } from '@/ui/components/app-bar-front'
import { BreadcrumbsProvider } from '@/ui/components/breadcrumbs/breadcrumbs-provider'
import { ContentAdminBar } from '@/ui/components/content-admin-bar'
import type { Locale } from '@/i18n/i18n-config'
import type { FrontendLayoutData } from '@/ui/layouts/frontend-layout-loader'

export interface FrontendLayoutProps extends FrontendLayoutData {
  locale: Locale
  /**
   * Optional body. The canonical layout (a file-based route) leaves this
   * undefined and lets the matched child route flow through `<Outlet />`.
   * Shim routes that render a single view inline (no child route) pass
   * the view directly as `children` — `<HomeView />`, for example.
   */
  children?: ReactNode
}

export function FrontendLayout({
  adminUser,
  adminPath,
  preview,
  locale,
  children,
}: FrontendLayoutProps) {
  return (
    <BreadcrumbsProvider>
      <DocsProvider>
        <GradientBackground />
        <ContentAdminBar user={adminUser} admin={adminPath} preview={preview} />
        <AppBarFront lng={locale} />
        <main id="main-content" className="flex flex-1 flex-col">
          {children ?? <Outlet />}
        </main>
      </DocsProvider>
    </BreadcrumbsProvider>
  )
}
