/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import { createRootRoute, HeadContent, Outlet, Scripts, useLocation } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import { i18nConfig, isRoutableLocale } from '@/i18n/i18n-config'
import { getMeta } from '@/lib/meta'
import { RootError, RootNotFound } from '@/ui/components/route-error'
import { EarlyThemeDetector } from '@/ui/theme/early-theme-detector'
import { ThemeProvider } from '@/ui/theme/provider'
import { Theme } from '@/ui/theme/utils'

import '@/ui/styles/global.css'

export const Route = createRootRoute({
  head: () => {
    const { meta, links } = getMeta()
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
        { name: 'color-scheme', content: 'dark light' },
        ...meta,
      ],
      links: [
        {
          rel: 'preload',
          as: 'font',
          type: 'font/woff2',
          href: '/fonts/Inter/Inter-VariableFont_opsz_wght.woff2',
          crossOrigin: 'anonymous',
        },
        { rel: 'icon', type: 'image/png', href: '/favicon-96x96.png', sizes: '96x96' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'shortcut icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/site.webmanifest' },
        ...links,
      ],
    }
  },
  component: RootComponent,
  errorComponent: RootError,
  notFoundComponent: RootNotFound,
})

function RootComponent() {
  return (
    <RootDocument>
      <ThemeProvider force={Theme.DARK}>
        <Outlet />
        <TanStackRouterDevtools />
      </ThemeProvider>
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  // Derive <html lang> from the URL's leading locale segment so any
  // locale-prefixed URL — interface or content, including the literal
  // /<lng> home shims (which carry no {-$lng} param) — advertises the
  // correct language. Falls back to the default locale otherwise.
  const pathname = useLocation({ select: (loc) => loc.pathname })
  const firstSegment = pathname.split('/')[1] ?? ''
  const lang = isRoutableLocale(firstSegment) ? firstSegment : i18nConfig.defaultLocale

  return (
    <html className="dark byline-ui" lang={lang} suppressHydrationWarning>
      <head>
        <EarlyThemeDetector />
        <HeadContent />
      </head>
      <body>
        <div className="layout-container root flex min-h-screen flex-col w-full max-w-full h-full selection:text-white selection:bg-primary-400">
          {children}
        </div>
        <Scripts />
      </body>
    </html>
  )
}
