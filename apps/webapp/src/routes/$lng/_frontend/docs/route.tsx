/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, Outlet } from '@tanstack/react-router'

import { Container, Section } from '@byline/ui/react'

import { useInterfaceLocale } from '@/i18n/hooks/use-locale-navigation'
import { DocsContent } from '@/modules/docs/components/content'
import { DocsDrawer } from '@/modules/docs/components/docs-drawer'
import { getDocsNavFn } from '@/modules/docs/nav'
import { Breadcrumbs } from '@/ui/components/breadcrumbs'
import { useBreadcrumbs } from '@/ui/components/breadcrumbs/breadcrumbs-provider'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'

export const Route = createFileRoute('/$lng/_frontend/docs')({
  loader: async ({ context }) => {
    const lng = context.locale
    const result = await getDocsNavFn({ data: { lng } })
    return { nodes: result.nodes, lng }
  },
  component: DocsLayout,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function DocsLayout() {
  const { nodes } = Route.useLoaderData()
  const interfaceLocale = useInterfaceLocale()

  return (
    <div className="flex flex-1 w-full">
      <DocsDrawer nodes={nodes} lng={interfaceLocale} />
      <DocsContent>
        {/* mt-3 puts the breadcrumb on the same line as the drawer's search
            input and the "On this Page" rail — see the matching notes in
            docs-drawer.module.css and toc.module.css. Changing one of the three
            without the others breaks the alignment. */}
        <Section className="mt-3 mb-4">
          <Container>
            <DocsBreadcrumbs />
          </Container>
        </Section>
        <Outlet />
      </DocsContent>
    </div>
  )
}

// Reads the trail pushed by the active child route's <BreadcrumbsClient />.
// Renders empty (just the Home anchor) until the child's mount effect fires —
// matches the project's existing provider/consumer pattern.
function DocsBreadcrumbs() {
  const { breadCrumbSettings } = useBreadcrumbs()
  return <Breadcrumbs {...breadCrumbSettings} />
}
