/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import {
  RouteError,
  RouteNotFound,
} from '@byline/host-tanstack-start/admin-shell/chrome/route-error'
import { Container, Section } from '@byline/ui/react'

import { PageDetail } from '@/modules/pages/components/detail'
import { getPageDetailFn } from '@/modules/pages/detail'
import { Breadcrumbs } from '@/ui/components/breadcrumbs'

export const Route = createFileRoute('/{-$lng}/_public/$slug')({
  loader: async ({ params }) => {
    const result = await getPageDetailFn({ data: { slug: params.slug } })
    if (result == null) throw notFound()
    return result
  },
  component: RouteComponent,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function RouteComponent() {
  const result = Route.useLoaderData()
  const title = result.fields.title ?? result.path ?? result.id

  return (
    <>
      <div
        id="byline-cms-meta"
        className="invisible max-h-0"
        aria-hidden
        data-collection="pages"
        data-id={result.id}
      />
      <Section>
        <Container className="mt-3">
          <Breadcrumbs
            breadcrumbs={[
              { label: title, href: `/${result.path}` },
            ]}
          />
        </Container>
      </Section>
      <Section>
        <Container>
          <PageDetail result={result} />
        </Container>
      </Section>
    </>
  )
}
