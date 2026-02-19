/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import { ToastProvider, ToastViewport } from '@infonomic/uikit/react'

import { BreadcrumbsProvider } from '@/context/breadcrumbs/breadcrumbs-provider'
import { TranslationsProvider } from '@/i18n/client/translation-provider'

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
              <Outlet />
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
