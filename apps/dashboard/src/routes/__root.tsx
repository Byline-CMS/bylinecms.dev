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

/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import { ToastProvider, ToastViewport } from '@infonomic/uikit/react'

import { BreadcrumbsProvider } from '@/context/breadcrumbs/breadcrumbs-provider'
import { TranslationsProvider } from '@/i18n/client/translation-provider'
import { AppBar } from '@/ui/components/app-bar.tsx'

import '@/ui/styles/global.css'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { title: 'Byline CMS' },
    ],
    links: [
      { rel: 'icon', type: 'image/png', href: '/favicon-96x96.png', sizes: '96x96' },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'shortcut icon', href: '/favicon.ico' },
      { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <TranslationsProvider>
        <ToastProvider swipeDirection="right" duration={5000}>
          <BreadcrumbsProvider>
            <div className="layout flex flex-col w-full max-w-full min-h-screen h-full selection:text-white selection:bg-primary-400">
              <AppBar />
              <main className="flex flex-col flex-1 pt-[55px] w-full max-w-full">
                <Outlet />
              </main>
            </div>
            <TanStackRouterDevtools />
          </BreadcrumbsProvider>
          <ToastViewport className="toast-viewport" />
        </ToastProvider>
      </TranslationsProvider>
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html className="dark" lang="en">
      <head>
        <HeadContent />
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: 'var(--canvas-900)' }}>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
