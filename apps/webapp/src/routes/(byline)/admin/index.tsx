/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, Link } from '@tanstack/react-router'

import type { WorkflowStatus } from '@byline/core'
import { getClientConfig, getWorkflowStatuses } from '@byline/core'
import { Card, Container, Section } from '@infonomic/uikit/react'

import { BreadcrumbsClient } from '@/context/breadcrumbs/breadcrumbs-client'
import { type CollectionStatusCount, getCollectionStats } from '@/modules/admin/collections'

// ---------------------------------------------------------------------------
// Status colour palette
// All classes must be written as full strings so Tailwind's scanner
// includes them in the generated CSS bundle.
// ---------------------------------------------------------------------------
const STATUS_TILE_COLORS: Record<
  string,
  { label: string; number: string; bg: string }
> = {
  draft: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    label: 'text-amber-600 dark:text-amber-400',
    number: 'text-amber-700 dark:text-amber-300',
  },
  published: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    label: 'text-emerald-700 dark:text-emerald-400',
    number: 'text-emerald-700 dark:text-emerald-300',
  },
  archived: {
    bg: 'bg-sky-50 dark:bg-sky-900/20',
    label: 'text-sky-700 dark:text-sky-400',
    number: 'text-sky-700 dark:text-sky-300',
  },
}

const CUSTOM_TILE_COLORS = {
  bg: 'bg-violet-50 dark:bg-violet-900/20',
  label: 'text-violet-700 dark:text-violet-400',
  number: 'text-violet-700 dark:text-violet-300',
}

function statusTileColors(name: string) {
  return STATUS_TILE_COLORS[name] ?? CUSTOM_TILE_COLORS
}

// ---------------------------------------------------------------------------

export const Route = createFileRoute('/(byline)/admin/')({
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

function StatTile({
  ws,
  count,
  collectionPath,
}: { ws: WorkflowStatus; count: number; collectionPath: string }) {
  const colors = statusTileColors(ws.name)
  return (
    <Link
      to="/admin/collections/$collection"
      params={{ collection: collectionPath }}
      search={{ status: ws.name }}
      className={[
        'flex flex-col items-center justify-center rounded px-2 pt-4 pb-2.5 gap-0.5',
        'transition-opacity hover:opacity-80',
        colors.bg,
      ].join(' ')}
    >
      <span
        className={[
          'text-[0.6rem] font-semibold uppercase tracking-widest leading-none',
          colors.label,
        ].join(' ')}
      >
        {ws.label ?? ws.name}
      </span>
      <span
        className={['text-2xl font-bold tabular-nums leading-none mt-1', colors.number].join(' ')}
      >
        {count}
      </span>
    </Link>
  )
}

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
              const total = stats?.reduce((sum, s) => sum + s.count, 0) ?? 0
              const workflowStatuses = getWorkflowStatuses(collection)

              return (
                <Card key={collection.path}>
                  <Link
                    to="/admin/collections/$collection"
                    params={{ collection: collection.path }}
                    className="block hover:opacity-90"
                  >
                    <Card.Header>
                      <div className="border-b border-gray-200 dark:border-gray-700 pb-3">
                        <Card.Title className="flex justify-between items-center mb-1">
                          <span className="text-[1.5rem]">{collection.labels.plural}</span>
                          <span className="text-[0.9rem] muted font-sans font-normal">{total} total</span>
                        </Card.Title>
                        <Card.Description className="muted">{`${collection.labels.plural} collection`}</Card.Description>
                      </div>
                    </Card.Header>
                  </Link>
                  <Card.Content>
                    {stats !== undefined ? (
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(4rem,1fr))] gap-2">
                        {workflowStatuses.map((ws) => {
                          const entry = stats.find((s) => s.status === ws.name)
                          return (
                            <StatTile
                              key={ws.name}
                              ws={ws}
                              count={entry?.count ?? 0}
                              collectionPath={collection.path}
                            />
                          )
                        })}
                      </div>
                    ) : (
                      <Link
                        to="/admin/collections/$collection"
                        params={{ collection: collection.path }}
                        className="block"
                      >
                        <p>{collection.labels.plural} collection</p>
                      </Link>
                    )}
                  </Card.Content>
                </Card>
              )
            })}
          </div>
        </Container>
      </Section>
    </>
  )
}
