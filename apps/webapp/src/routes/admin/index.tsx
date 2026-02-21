/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, Link } from '@tanstack/react-router'

import { getClientConfig } from '@byline/core'
import { Card, Container, Section } from '@infonomic/uikit/react'

import { BreadcrumbsClient } from '@/context/breadcrumbs/breadcrumbs-client'

export const Route = createFileRoute('/admin/')({
  component: Index,
})

function Index() {
  const config = getClientConfig()
  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Admin', href: `/admin` },
        ]}
      />
      <Section className="py-6">
        <Container>
          <div className="grid grid-cols-auto-fit-320 gap-6">
            {config.collections.map((collection) => (
              <Card asChild key={collection.path} hover={true}>
                <Link
                  to="/admin/collections/$collection"
                  params={{ collection: collection.path }}
                  className="block"
                >
                  <Card.Header>
                    <Card.Title>{collection.labels.plural}</Card.Title>
                    <Card.Description>{`${collection.labels.plural} collection`}</Card.Description>
                  </Card.Header>
                  <Card.Content>
                    <p>{collection.labels.plural} collection description or stats here...</p>
                  </Card.Content>
                </Link>
              </Card>
            ))}
          </div>
        </Container>
      </Section>
    </>
  )
}
