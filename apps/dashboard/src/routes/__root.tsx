/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { BreadcrumbsProvider } from '@/context/breadcrumbs/breadcrumbs-provider'
import { TranslationsProvider } from '@/i18n/client/translation-provider'
import { AppBar } from '@/ui/components/app-bar.tsx'

import '@/ui/styles/global.css'

export const Route = createRootRoute({
  component: () => {
    return (
      <TranslationsProvider>
        <BreadcrumbsProvider>
          <div className="layout flex flex-col w-full max-w-full min-h-screen h-full selection:text-white selection:bg-primary-400">
            <AppBar />
            <main className="flex flex-col flex-1 pt-[55px] w-full max-w-full">
              <Outlet />
            </main>
          </div>
          {/* <TanStackRouterDevtools /> */}
        </BreadcrumbsProvider>
      </TranslationsProvider>
    )
  },
})
