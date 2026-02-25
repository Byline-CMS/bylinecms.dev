/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, Link } from '@tanstack/react-router'

import { getClientConfig, getWorkflowStatuses } from '@byline/core'
import { Card, Container, Section } from '@infonomic/uikit/react'

import { BreadcrumbsClient } from '@/context/breadcrumbs/breadcrumbs-client'
import {
  type CollectionStatusCount,
  getCollectionStats,
} from '@/modules/admin/collections/data'

export const Route = createFileRoute('/admin/')({
  loader: async () => {
    const { collections } = getClientConfig()
    const statsMap: Record<string, CollectionStatusCount[]> = {}

    await Promise.all(
      collections
        .filter((c) => c.showStats === true)
        .map(async (c) => {
          try {
            statsMap[c.path] = await getCollectionStats(c.path)
          } catch {
            statsMap[c.path] = []
          }
        })
    )

    return { statsMap }
  },
  component: Index,
})

function Index() {
  const config = getClientConfig()
  const { statsMap } = Route.useLoaderData()

  return (
    <>
      <BreadcrumbsClient breadcrumbs={[{ label: 'Admin', href: `/admin` }]} />
      <Section className="py-6">
        <Container>
          <div className="grid grid-cols-auto-fit-320 gap-6">
            {config.collections.map((collection) => {
              const stats = statsMap[collection.path]
              const workflowStatuses = getWorkflowStatuses(collection)

              return (
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
                      {stats && stats.length > 0 ? (
                        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          {workflowStatuses.map((ws) => {
                            const entry = stats.find((s) => s.status === ws.name)
                            const count = entry?.count ?? 0
                            return (
                              <li key={ws.name} className="flex items-center gap-1">
                                <span className="text-muted-foreground">
                                  {ws.label ?? ws.name}:
                                </span>
                                <span className="font-medium tabular-nums">{count}</span>
                              </li>
                            )
                          })}
                        </ul>
                      ) : (
                        <p>{collection.labels.plural} collection</p>
                      )}
                    </Card.Content>
                  </Link>
                </Card>
              )
            })}
          </div>
        </Container>
      </Section>
    </>
  )
}

