/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, Outlet } from '@tanstack/react-router'

import { Section } from '@byline/ui/react'

import { DocsContent } from '@/modules/docs/components/content'
import { DocsMenuDrawer } from '@/modules/docs/components/menu-drawer'
import { getDocsListFn } from '@/modules/docs/list'
import { Breadcrumbs } from '@/ui/components/breadcrumbs'
import { useBreadcrumbs } from '@/ui/components/breadcrumbs/breadcrumbs-provider'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'

export const Route = createFileRoute('/{-$lng}/_frontend/docs')({
  loader: async ({ context }) => {
    const lng = context.locale
    const result = await getDocsListFn({ data: { lng } })
    return { docs: result.docs, lng }
  },
  component: DocsLayout,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function DocsLayout() {
  const { docs, lng } = Route.useLoaderData()

  return (
    <>
      <Section className="mt-3 px-4">
        <DocsBreadcrumbs />
      </Section>
      <div className="flex flex-1 w-full">
        <DocsMenuDrawer docs={docs} lng={lng} />
        <DocsContent>
          <Outlet />
        </DocsContent>
      </div>
    </>
  )
}

// Reads the trail pushed by the active child route's <BreadcrumbsClient />.
// Renders empty (just the Home anchor) until the child's mount effect fires —
// matches the project's existing provider/consumer pattern.
function DocsBreadcrumbs() {
  const { breadCrumbSettings } = useBreadcrumbs()
  return <Breadcrumbs {...breadCrumbSettings} />
}
