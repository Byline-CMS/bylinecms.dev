/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, useLoaderData } from '@tanstack/react-router'

import {
  RouteError,
  RouteNotFound,
} from '@byline/host-tanstack-start/admin-shell/chrome/route-error'
import { Container, Section } from '@byline/ui/react'

import { buildLocalizedPath, getMeta } from '@/lib/meta'
import { DocsList } from '@/modules/docs/components/list'
import { BreadcrumbsClient } from '@/ui/components/breadcrumbs/breadcrumbs-client'

export const Route = createFileRoute('/{-$lng}/_frontend/docs/')({
  head: ({ params }) =>
    getMeta({
      title: 'Documentation',
      path: buildLocalizedPath(params.lng, 'docs'),
    }),
  component: RouteComponent,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function RouteComponent() {
  // Read the parent docs layout's loader data directly — single source of
  // truth, no re-fetch, no own loader needed on this index route.
  const { docs, lng } = useLoaderData({ from: '/{-$lng}/_frontend/docs' })

  return (
    <>
      <BreadcrumbsClient breadcrumbs={[{ label: 'Documentation', href: '/docs' }]} />
      <Section className="pb-12">
        <Container>
          {docs.length > 0 ? (
            <DocsList docs={docs} lng={lng} />
          ) : (
            <div className="prose mb-8">
              <h1 className="mb-2">Documentation</h1>
              <p className="muted">No documents have been published yet.</p>
            </div>
          )}
        </Container>
      </Section>
    </>
  )
}
