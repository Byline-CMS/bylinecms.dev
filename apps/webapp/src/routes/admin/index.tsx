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
import { type CollectionStatusCount, getCollectionStats } from '@/modules/admin/collections/data'

// ---------------------------------------------------------------------------
// Status colour palette
// All classes must be written as full strings so Tailwind's scanner
// includes them in the generated CSS bundle.
// ---------------------------------------------------------------------------
const STATUS_TILE_COLORS: Record<
  string,
  { border: string; label: string; number: string; bg: string }
> = {
  draft: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-t-2 border-amber-400 dark:border-amber-500',
    label: 'text-amber-600 dark:text-amber-400',
    number: 'text-amber-700 dark:text-amber-300',
  },
  published: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    border: 'border-t-2 border-emerald-500 dark:border-emerald-400',
    label: 'text-emerald-700 dark:text-emerald-400',
    number: 'text-emerald-700 dark:text-emerald-300',
  },
  archived: {
    bg: 'bg-sky-50 dark:bg-sky-900/20',
    border: 'border-t-2 border-sky-500 dark:border-sky-400',
    label: 'text-sky-700 dark:text-sky-400',
    number: 'text-sky-700 dark:text-sky-300',
  },
}

const CUSTOM_TILE_COLORS = {
  bg: 'bg-violet-50 dark:bg-violet-900/20',
  border: 'border-t-2 border-violet-500 dark:border-violet-400',
  label: 'text-violet-700 dark:text-violet-400',
  number: 'text-violet-700 dark:text-violet-300',
}

function statusTileColors(name: string) {
  return STATUS_TILE_COLORS[name] ?? CUSTOM_TILE_COLORS
}

// ---------------------------------------------------------------------------

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
        'flex flex-col items-center justify-center rounded-md px-2 py-2.5 gap-0.5',
        'transition-opacity hover:opacity-80',
        colors.bg,
        colors.border,
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
              const workflowStatuses = getWorkflowStatuses(collection)

              return (
                <Card key={collection.path}>
                  <Link
                    to="/admin/collections/$collection"
                    params={{ collection: collection.path }}
                    className="block hover:opacity-90"
                  >
                    <Card.Header>
                      <Card.Title>{collection.labels.plural}</Card.Title>
                      <Card.Description>{`${collection.labels.plural} collection`}</Card.Description>
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
